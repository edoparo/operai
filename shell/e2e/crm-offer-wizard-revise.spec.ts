/**
 * specs/20261115-crm-offer-wizard T55 — editing, revising, the legacy dialog and the template editor, through the REAL
 * assembled shell and crm-ui against the REAL crm-api, auth and activities-api.
 *
 *   AC-7.1  Edit on an unsent wizard offer opens the wizard on that offer's answers; generating replaces the offer
 *           under the SAME reference (one row, same id)
 *   AC-7.2  New revision on a sent wizard offer opens the wizard on its answers and generates the next `rN`; the sent
 *           offer stays as it was
 *   AC-7.3  an offer made with a classic template, in a language with no wizard template (welld_ch, English), still
 *           opens the classic dialog
 *   AC-8.1  a person who manages the entity's deals creates a wizard template in Settings (name, description, text),
 *           with the problems and what the wizard will ask shown live
 *   AC-11.1 the revision's wizard shows the entity's letterhead behind its preview, as a new offer's does (T67)
 *   AC-8.5  "Try the wizard" runs the wizard on the text as typed, saved or not, with sample answers, no deal, no draft,
 *           no write, no Generate
 *
 * The journeys of the wizard itself are in crm-offer-wizard.spec.ts (T54); this file shares its fixtures
 * (helpers/crmOfferFixtures.ts) and its PREREQUISITES, listed at the top of that spec: crm-api on this branch's code
 * with its migration applied (`cd crm-api && bun run db:deploy`), activities-api, file storage, the shell and crm-ui
 * served.
 *
 * run:  cd shell && pnpm e2e crm-offer-wizard-revise.spec.ts   (and crm-offer-wizard.spec.ts must still pass)
 *
 * The legacy journey needs welld_ch's ENGLISH classic template to be active, i.e. no English wizard template: it
 * says so and skips when someone has created one (the wizard would then open, which is the other half of AC-7.3,
 * covered by crm-ui's component tests).
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  CRM_API_URL,
  MINIMAL_TEMPLATE_SOURCE,
  SUBJECT_LABEL,
  archiveTemplateViaApi,
  archiveTemplatesNamedViaApi,
  createDealPastEstimateGate,
  createMinimalTemplateViaApi,
  ensureEntityProfile,
  ensureLetterhead,
  findClassicEnglishTemplate,
  generateClassicOfferViaApi,
  generateWizardOfferViaApi,
  getDraftViaApi,
  hasEnglishWizardTemplate,
  liveOffersViaApi,
  listTemplatesViaApi,
  markOfferSentViaApi,
  newRunId,
  offerAdmin,
  signInContext,
  type DealRow,
  type SeededSession,
  type TemplateRow,
} from './helpers/crmOfferFixtures'

const runId = newRunId()

test.describe.configure({ mode: 'serial' })

async function contextFor(browser: Browser, session: SeededSession): Promise<BrowserContext> {
  const context = await browser.newContext()
  await signInContext(context, session)
  return context
}

const dealUrl = (deal: DealRow): string => `/crm/deals/${deal.id}`

const stepTab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) })

const isDraftWrite = (response: { url: () => string; request: () => { method: () => string } }): boolean =>
  response.url().includes('/offer-draft') && response.request().method() === 'PUT'

async function savedBy(page: Page, act: () => Promise<void>): Promise<number> {
  const [response] = await Promise.all([page.waitForResponse(isDraftWrite, { timeout: 20_000 }), act()])
  return response.status()
}

/** Opens a deal and waits for its page, as a person landing on it. */
async function openDeal(page: Page, deal: DealRow): Promise<void> {
  await page.goto(dealUrl(deal))
  await expect(page.getByRole('heading', { name: deal.title })).toBeVisible({ timeout: 30_000 })
}

test.describe('specs/20261115-crm-offer-wizard T55: edit, revise, legacy and the template editor', () => {
  let admin: SeededSession
  let minimal: TemplateRow
  const editorName = `E2E editor ${runId}`

  test.beforeAll(async () => {
    admin = await offerAdmin()
    await ensureEntityProfile(admin)
    await ensureLetterhead(admin) // an existing one is used as it is; see crm-offer-wizard.spec.ts
    minimal = await createMinimalTemplateViaApi(admin, `E2E revise ${runId}`)
  })

  test.afterAll(async () => {
    if (minimal) await archiveTemplateViaApi(admin, minimal.id)
    if (admin) await archiveTemplatesNamedViaApi(admin, editorName)
  })

  test('Edit on an unsent wizard offer opens its answers and generating replaces it under the same reference (AC-7.1)', async ({
    browser,
  }) => {
    const deal = await createDealPastEstimateGate(admin, 'edit', runId)
    const offer = await generateWizardOfferViaApi(admin, deal.id, minimal.id, 'Prima versione')

    const context = await contextFor(browser, admin)
    const page = await context.newPage()
    await openDeal(page, deal)
    await expect(page.getByTestId('crm-offers-table')).toContainText(offer.reference, { timeout: 30_000 })
    await expect(page.getByTestId('crm-offers-table')).toContainText(`Template: ${minimal.name}`)

    // Edit starts a draft on the offer (target: edit) and opens the wizard on it.
    await page.getByTestId(`crm-offer-edit-${offer.id}`).click()
    await expect(page).toHaveURL(/\/crm\/deals\/[^/]+\/offer/, { timeout: 30_000 })
    await expect(page.getByTestId('crm-offer-wizard-target')).toContainText(offer.reference, { timeout: 30_000 })
    await expect(page.getByRole('tablist', { name: 'Offer steps' })).toBeVisible()

    // Its answers are there, not the template's blanks.
    await stepTab(page, 'Scope').click()
    const subject = page.getByLabel(SUBJECT_LABEL)
    await expect(subject).toHaveValue('Prima versione')
    expect(await savedBy(page, () => subject.fill('Seconda versione'))).toBe(200)

    await stepTab(page, 'Preview').click()
    await expect(page.getByText('Nothing is missing. You can generate the offer.')).toBeVisible()
    await page.getByTestId('offer-wizard-action-bar').getByRole('button', { name: 'Generate offer' }).click()

    // Generated in place: the deal page confirms the SAME reference and still lists ONE offer.
    await expect(page).toHaveURL(new RegExp(`/crm/deals/${deal.id}/?$`), { timeout: 60_000 })
    await expect(page.getByText(`Offer ${offer.reference} generated.`)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('crm-offers-table').locator('tbody tr')).toHaveCount(1)

    const offers = await liveOffersViaApi(admin, deal.id)
    expect(offers).toHaveLength(1)
    expect(offers[0]!.id).toBe(offer.id)
    expect(offers[0]!.reference).toBe(offer.reference)
    expect(offers[0]!.sent).toBeNull()
    expect(await getDraftViaApi(admin, deal.id)).toBeNull()

    await context.close()
  })

  test('New revision on a sent wizard offer opens its answers and generates the next revision, the sent one untouched (AC-7.2)', async ({
    browser,
  }) => {
    const deal = await createDealPastEstimateGate(admin, 'revise', runId)
    const first = await generateWizardOfferViaApi(admin, deal.id, minimal.id, 'Prima versione')
    await markOfferSentViaApi(admin, deal.id, first.id)
    const sentBefore = (await liveOffersViaApi(admin, deal.id)).find((offer) => offer.id === first.id)
    expect(sentBefore?.sent).not.toBeNull()

    const context = await contextFor(browser, admin)
    const page = await context.newPage()
    await openDeal(page, deal)
    await expect(page.getByTestId('crm-offers-table')).toContainText(first.reference, { timeout: 30_000 })

    const revise = page.getByTestId('crm-offer-generate')
    await expect(revise).toHaveText('New revision')
    await revise.click()
    await expect(page).toHaveURL(/\/crm\/deals\/[^/]+\/offer/, { timeout: 30_000 })

    // The banner names the sent offer and the reference the generation will create.
    const nextReference = `${first.reference}r1`
    const banner = page.getByTestId('crm-offer-wizard-target')
    await expect(banner).toContainText(first.reference, { timeout: 30_000 })
    await expect(banner).toContainText(nextReference)

    await stepTab(page, 'Scope').click()
    await expect(page.getByLabel(SUBJECT_LABEL)).toHaveValue('Prima versione')

    await stepTab(page, 'Preview').click()
    await expect(page.getByText('Nothing is missing. You can generate the offer.')).toBeVisible()
    await page.getByTestId('offer-wizard-action-bar').getByRole('button', { name: 'Generate offer' }).click()

    await expect(page).toHaveURL(new RegExp(`/crm/deals/${deal.id}/?$`), { timeout: 60_000 })
    await expect(page.getByText(`Offer ${nextReference} generated.`)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('crm-offers-table')).toContainText(nextReference)

    // Two live versions: the new revision, and the sent offer exactly as it was.
    const offers = await liveOffersViaApi(admin, deal.id)
    expect(offers.map((offer) => offer.reference)).toEqual([nextReference, first.reference])
    const sentAfter = offers.find((offer) => offer.id === first.id)
    expect(sentAfter?.sent).toEqual(sentBefore?.sent)
    expect(sentAfter?.version).toBe(sentBefore?.version)
    expect(offers.find((offer) => offer.reference === nextReference)?.sent).toBeNull()
    expect(await getDraftViaApi(admin, deal.id)).toBeNull()

    await context.close()
  })

  test("a new revision's wizard shows the entity's letterhead behind its preview (AC-11.1, AC-11.9)", async ({
    browser,
  }) => {
    const deal = await createDealPastEstimateGate(admin, 'revise-letterhead', runId)
    const first = await generateWizardOfferViaApi(admin, deal.id, minimal.id, 'Prima versione')
    await markOfferSentViaApi(admin, deal.id, first.id)

    // 1440 px: the preview is the wide layout's inline pane, not the Drawer.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await signInContext(context, admin)
    const page = await context.newPage()
    await openDeal(page, deal)
    await expect(page.getByTestId('crm-offers-table')).toContainText(first.reference, { timeout: 30_000 })
    await page.getByTestId('crm-offer-generate').click()
    await expect(page.getByTestId('crm-offer-wizard-target')).toContainText(`${first.reference}r1`, {
      timeout: 30_000,
    })

    // The revision opens on the sent offer's answers, and its preview has the letterhead behind the text.
    const band = page.getByTestId('crm-wizard-letterhead-band')
    await expect(band).toHaveAttribute('data-state', 'shown', { timeout: 30_000 })
    await expect(band).toContainText('The letterhead is shown on every page.')
    await expect(page.getByTestId('crm-wizard-letterhead').first()).toHaveJSProperty('tagName', 'IMG')
    await expect(page.getByTestId('crm-wizard-letterhead')).toHaveCount(
      Number(await page.getByTestId('crm-wizard-stage').getAttribute('data-pages')),
    )
    await expect(page.getByTestId('crm-wizard-preview').locator('article')).toContainText('Prima versione')

    // Leaving without generating discards nothing of the sent offer; the revision's draft is removed.
    await page.getByTestId('crm-offer-wizard-back').click()
    await expect(page.getByTestId('crm-offer-draft-row')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('crm-offer-draft-discard').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard draft' }).click()
    await expect(page.getByTestId('crm-offer-draft-row')).toHaveCount(0, { timeout: 15_000 })
    expect(await getDraftViaApi(admin, deal.id)).toBeNull()

    await context.close()
  })

  test('a classic offer in a language with no wizard template still opens the classic dialog (AC-7.3)', async ({
    browser,
  }) => {
    test.skip(
      await hasEnglishWizardTemplate(admin),
      'welld_ch has an active English wizard template: Edit opens the wizard',
    )
    const classic = await findClassicEnglishTemplate(admin)
    test.skip(classic === null, 'welld_ch has no active classic English template to make a legacy offer from')

    const deal = await createDealPastEstimateGate(admin, 'legacy', runId)
    const offer = await generateClassicOfferViaApi(admin, deal.id, classic!)
    expect(offer.origin).toBe('sections')

    const context = await contextFor(browser, admin)
    const page = await context.newPage()
    await openDeal(page, deal)
    await expect(page.getByTestId('crm-offers-table')).toContainText(offer.reference, { timeout: 30_000 })
    await expect(page.getByTestId(`crm-offer-origin-${offer.id}`)).toHaveText('Classic template')

    // Edit: no wizard for the offer's language, so the previous dialog, on the deal page.
    await page.getByTestId(`crm-offer-edit-${offer.id}`).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(`Edit offer ${offer.reference}`, { timeout: 30_000 })
    await expect(page).toHaveURL(new RegExp(`/crm/deals/${deal.id}/?$`))
    expect(await getDraftViaApi(admin, deal.id)).toBeNull() // no wizard draft was started for it

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await context.close()
  })

  test('a wizard template is created in Settings and tried with sample answers on the text as typed, writing nothing (AC-8.1, AC-8.5)', async ({
    browser,
  }) => {
    const context = await contextFor(browser, admin)
    const page = await context.newPage()

    // From Settings, as a person would: the entity's templates card has "New template".
    await page.goto('/crm/settings')
    await page.getByTestId('crm-template-new-welld_ch').click()
    await expect(page).toHaveURL(/\/crm\/settings\/templates\/new\/welld_ch/, { timeout: 30_000 })
    await expect(page.getByTestId('crm-template-page')).toBeVisible()

    await page.getByTestId('crm-template-name').getByRole('textbox').fill(editorName)
    await page.getByTestId('crm-template-description').getByRole('textbox').fill('Created by the e2e journeys')
    await page.getByTestId('crm-template-text').fill(MINIMAL_TEMPLATE_SOURCE)

    // The text is read as it is typed: no problems, and the outline says what the wizard will ask.
    await expect(page.getByText('No problems')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('crm-template-outline')).toContainText(SUBJECT_LABEL)

    // Nothing is saved yet.
    expect((await listTemplatesViaApi(admin, 'sections,wizard', true)).map((row) => row.name)).not.toContain(editorName)

    // Try the wizard: the real wizard on the unsaved text, with sample answers and no way to generate.
    const writes: string[] = []
    let trying = false
    page.on('request', (request) => {
      if (!trying || !request.url().startsWith(CRM_API_URL)) return
      const path = new URL(request.url()).pathname
      if (request.method() !== 'GET' || path.includes('/offer-draft') || path.includes('/offer-wizard'))
        writes.push(`${request.method()} ${path}`)
    })
    trying = true
    await page.getByRole('tab', { name: 'Try the wizard' }).click()
    await expect(page.getByTestId('crm-template-try-banner')).toContainText('Nothing is saved')
    await stepTab(page, 'Scope').click()
    await expect(page.getByLabel(SUBJECT_LABEL)).toHaveValue(/.+/) // a sample answer
    await stepTab(page, 'Preview').click()
    await expect(
      page.getByTestId('offer-wizard-action-bar').getByRole('button', { name: 'Generate offer' }),
    ).toHaveCount(0)

    // Edit the text (still unsaved) and try again: the view follows the text as typed.
    await page.getByRole('tab', { name: 'Edit', exact: true }).click()
    await page.getByTestId('crm-template-text').fill(MINIMAL_TEMPLATE_SOURCE.replace(SUBJECT_LABEL, 'Subject line'))
    await page.getByRole('tab', { name: 'Try the wizard' }).click()
    await stepTab(page, 'Scope').click()
    await expect(page.getByLabel('Subject line')).toBeVisible()
    trying = false
    expect(writes).toEqual([])
    expect((await listTemplatesViaApi(admin, 'sections,wizard', true)).map((row) => row.name)).not.toContain(editorName)

    // Save it: back on Edit, the template is created and its own page opens.
    await page.getByRole('tab', { name: 'Edit', exact: true }).click()
    await page.getByTestId('crm-template-save').click()
    await expect(page).toHaveURL(/\/crm\/settings\/templates\/(?!new)[^/]+$/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: `Template ${editorName}` })).toBeVisible()

    const saved = (await listTemplatesViaApi(admin, 'wizard')).find((row) => row.name === editorName)
    expect(saved).toBeDefined()
    expect(saved).toMatchObject({
      format: 'wizard',
      language: 'it',
      archived: false,
      description: 'Created by the e2e journeys',
    })

    await context.close()
  })
})
