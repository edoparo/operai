/**
 * specs/20261115-crm-offer-wizard T54 — the wizard journeys, through the REAL assembled shell and crm-ui against the
 * REAL crm-api, auth and (for the estimate override's timeline note) activities-api.
 *
 *   AC-1.1  a new offer on a welld_ch deal opens on the Template step: the entity's seeded wizard templates, grouped by
 *           language, with description and typical uses; the chosen template sets the offer's language
 *   AC-6.4  the deal page shows the draft (template, target), with Continue and a confirmed Discard
 *   AC-6.1  every change is kept without a save: reload, and a second browser context (another device), resume
 *           exactly where the person left off, on the step they were on
 *   AC-3.5  Generate is blocked while a value is missing (counts beside it, the issue that jumps to its field), a
 *           generation asked for by any other means is refused and creates no offer; once filled it generates, the
 *           draft is gone and the deal page confirms the offer
 *   AC-6.3  two contexts saving the same draft: the one saving from an older version is refused and told to reload,
 *           nothing the other saved is lost; a context that only moves between steps writes nothing and gets no conflict
 *   AC-9.1  the seeded Italian templates are what the Template step offers (the first journey starts from one)
 *
 *   AC-11.1 the preview shows the entity's letterhead behind the text, on the page; the failure band when the link
 *   AC-11.4 request fails, with the text, autosave and counts unaffected, and tried again on the next opening; the
 *   AC-11.5 page and the letterhead identical in the dark and the light theme (T67, reworked for A4 pages by T75;
 *           several pages, breaks, the none/pending/unusable states and the Drawer are crm-offer-wizard-pages.spec.ts)
 *   AC-12.3 the seeded SLA template prints the profile's legal name and its "Fornitore" row the name and address, in
 *   AC-12.10 the preview and, for a template using the issuer fields, in the generated PDF (read back through pdf.js)
 *
 * The edit, revision, legacy and template-editor journeys are in crm-offer-wizard-revise.spec.ts (T55; T67 adds the
 * letterhead on a revision there).
 *
 * ═══ PREREQUISITES (what must be running, with which env) ═══════════════════════════════════════════════════
 * The stack the other CRM journeys already need (activities-crm.spec.ts' header lists the activities-api, crm-api
 * and shell-build env: postgres/MinIO, auth :3001 with ENABLE_TEST_AUTH=true, crm-api :8084, activities-api :8087,
 * crm-ui and the shell served), PLUS this feature:
 *
 *  - crm-api runs THIS branch's code against a database that HAS its migration:
 *      cd crm-api && bun run db:deploy        (applies 20261115120000_offer_wizard to the database crm-api uses)
 *    Without it the offer routes, the wizard templates and the drafts do not work and every journey fails at setup
 *    with a 500 from the fixture call (which says so in its message). Do NOT point these at a database you have
 *    not agreed to migrate.
 *  - crm-api's file storage (`CRM_S3_*`, MinIO from `docker compose up -d minio minio-createbucket`) answers: the
 *    generate journeys write the offer PDF there. The welld_ch letterhead PROFILE is written by the fixtures when it
 *    is missing (an existing one is left alone); a letterhead PDF is not needed.
 *  - the entity has its seeded Italian wizard templates (the first read of the wizard format seeds them: AC-9.1).
 *
 *  run:  cd shell && pnpm e2e crm-offer-wizard.spec.ts
 *  against a `mise run dev` stack:
 *        E2E_CRM_REMOTE_PORT=5179 E2E_MEETINGS_REMOTE_PORT=5180 E2E_PROJECTS_REMOTE_PORT=5181 pnpm e2e crm-offer-wizard
 *
 * Offers take welld_ch's next numbers (NNNN/YYYY) on the database they run against; see crmOfferFixtures.ts.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  SUBJECT_LABEL,
  archiveTemplateViaApi,
  createDealPastEstimateGate,
  createDraftViaApi,
  createIssuerTemplateViaApi,
  createMinimalTemplateViaApi,
  discardDraftViaApi,
  ensureEntityProfile,
  ensureLetterhead,
  findSeededTemplate,
  findSeededTemplateNamed,
  getDraftViaApi,
  getEntityProfile,
  issuerAddressText,
  listOffersViaApi,
  newRunId,
  offerAdmin,
  offerPdfText,
  setFieldViaApi,
  signInContext,
  tryGenerateDraftViaApi,
  type DealRow,
  type ProfileRow,
  type SeededSession,
  type TemplateRow,
} from './helpers/crmOfferFixtures'

const runId = newRunId()

test.describe.configure({ mode: 'serial' })

async function contextFor(
  browser: Browser,
  session: SeededSession,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<BrowserContext> {
  const context = await browser.newContext(options)
  await signInContext(context, session)
  return context
}

const dealUrl = (deal: DealRow): string => `/crm/deals/${deal.id}`
const wizardUrl = (deal: DealRow, step?: string): string => `${dealUrl(deal)}/offer${step ? `?step=${step}` : ''}`

/** A wizard step's tab ("Client", "Scope", ...); its name also carries the issue count, so match the start. */
const stepTab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) })

const isDraftWrite = (response: { url: () => string; request: () => { method: () => string } }): boolean =>
  response.url().includes('/offer-draft') && response.request().method() === 'PUT'

/** Runs `act` and resolves once the autosave it causes has been answered (the debounce is 1 s). */
async function savedBy(page: Page, act: () => Promise<void>): Promise<number> {
  const [response] = await Promise.all([page.waitForResponse(isDraftWrite, { timeout: 20_000 }), act()])
  return response.status()
}

test.describe('specs/20261115-crm-offer-wizard T54: the offer wizard through the shell', () => {
  let admin: SeededSession
  let minimal: TemplateRow
  let seeded: TemplateRow
  let startDeal: DealRow
  let resumeDeal: DealRow
  let generateDeal: DealRow
  let conflictDeal: DealRow

  test.beforeAll(async () => {
    admin = await offerAdmin()
    await ensureEntityProfile(admin)
    seeded = await findSeededTemplate(admin)
    minimal = await createMinimalTemplateViaApi(admin, `E2E minimal ${runId}`)
    startDeal = await createDealPastEstimateGate(admin, 'start', runId)
    resumeDeal = await createDealPastEstimateGate(admin, 'resume', runId)
    generateDeal = await createDealPastEstimateGate(admin, 'generate', runId)
    conflictDeal = await createDealPastEstimateGate(admin, 'conflict', runId)
  })

  test.afterAll(async () => {
    if (minimal) await archiveTemplateViaApi(admin, minimal.id)
  })

  test('a new offer starts from a seeded template; the deal page shows the draft and Discard removes it (AC-1.1, AC-9.1, AC-6.4)', async ({
    browser,
  }) => {
    const context = await contextFor(browser, admin)
    const page = await context.newPage()

    await page.goto(dealUrl(startDeal))
    await expect(page.getByRole('heading', { name: startDeal.title })).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('crm-offer-new').click()
    await expect(page).toHaveURL(/\/crm\/deals\/[^/]+\/offer/)

    // The Template step: the entity's active wizard templates, grouped by language, each with what it is for.
    const step = page.getByTestId('crm-wizard-template-step')
    await expect(step).toBeVisible({ timeout: 30_000 })
    await expect(step.getByText('Italian templates')).toBeVisible()
    const card = page.getByTestId(`crm-wizard-template-${seeded.id}`)
    await expect(card).toContainText(seeded.name)
    if (seeded.description) await expect(card).toContainText(seeded.description)
    for (const use of (seeded.uses ?? []).slice(0, 3)) await expect(card).toContainText(use)

    // Choosing it creates the draft and opens the wizard on its first step; the template sets the language.
    await page.getByRole('button', { name: `Use template ${seeded.name}`, exact: true }).click()
    await expect(page.getByRole('tablist', { name: 'Offer steps' })).toBeVisible({ timeout: 15_000 })
    await expect(stepTab(page, 'Client')).toHaveAttribute('aria-selected', 'true')
    await expect
      .poll(async () => (await getDraftViaApi(admin, startDeal.id))?.template.id, { timeout: 15_000 })
      .toBe(seeded.id)
    expect((await getDraftViaApi(admin, startDeal.id))?.template.language).toBe('it')

    // Back on the deal: the draft row, with its template and target, and no second "New offer" beside it.
    await page.getByTestId('crm-offer-wizard-back').click()
    const row = page.getByTestId('crm-offer-draft-row')
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText(seeded.name)
    await expect(row).toContainText('New offer')
    await expect(page.getByTestId('crm-offer-new')).toHaveCount(0)

    // Discard asks first, then removes the draft (the deal and its offers are not affected).
    await page.getByTestId('crm-offer-draft-discard').click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByText('Discard this draft?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Discard draft' }).click()
    await expect(page.getByText('Draft discarded')).toBeVisible({ timeout: 15_000 })
    await expect(row).toHaveCount(0)
    expect(await getDraftViaApi(admin, startDeal.id)).toBeNull()
    await expect(page.getByTestId('crm-offer-new')).toBeVisible()

    await context.close()
  })

  test('a change is kept without saving: it survives a reload and a second browser context, on the same step (AC-6.1)', async ({
    browser,
  }) => {
    const context = await contextFor(browser, admin)
    const page = await context.newPage()

    await page.goto(wizardUrl(resumeDeal))
    await expect(page.getByTestId('crm-wizard-template-step')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: `Use template ${minimal.name}`, exact: true }).click()
    await expect(page.getByRole('tablist', { name: 'Offer steps' })).toBeVisible({ timeout: 15_000 })

    await stepTab(page, 'Scope').click()
    const subject = page.getByLabel(SUBJECT_LABEL)
    expect(await savedBy(page, () => subject.fill('Portale clienti'))).toBe(200)
    await expect(page.getByTestId('offer-wizard-save-status')).toContainText('All changes saved')

    // Reload: the draft comes back exactly as left.
    await page.reload()
    await expect(page.getByLabel(SUBJECT_LABEL)).toHaveValue('Portale clienti', { timeout: 30_000 })
    await expect(stepTab(page, 'Scope')).toHaveAttribute('aria-selected', 'true')

    // Another device: a fresh context, no browser state at all. The deal page offers the draft; Continue resumes it
    // on the step the first context was on (the step travels with the last content save).
    const other = await contextFor(browser, admin)
    const second = await other.newPage()
    await second.goto(dealUrl(resumeDeal))
    const row = second.getByTestId('crm-offer-draft-row')
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText(minimal.name)
    await second.getByTestId('crm-offer-draft-continue').click()
    await expect(second.getByLabel(SUBJECT_LABEL)).toHaveValue('Portale clienti', { timeout: 30_000 })
    await expect(stepTab(second, 'Scope')).toHaveAttribute('aria-selected', 'true')

    // Nothing of the draft is in the browser's storage (AC-6.7): the answer lives on the server only.
    const stored = await second.evaluate(
      () => JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage }),
    )
    expect(stored).not.toContain('Portale clienti')

    await other.close()
    await context.close()
  })

  test('Generate is blocked while a value is missing and generated once it is filled in (AC-3.5)', async ({
    browser,
  }) => {
    const context = await contextFor(browser, admin)
    const page = await context.newPage()

    await page.goto(wizardUrl(generateDeal))
    await expect(page.getByTestId('crm-wizard-template-step')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: `Use template ${minimal.name}`, exact: true }).click()
    await expect(page.getByRole('tablist', { name: 'Offer steps' })).toBeVisible({ timeout: 15_000 })

    // Preview: one value is missing, listed with its step; the generate action says so and does nothing.
    await stepTab(page, 'Preview').click()
    await expect(page.getByRole('heading', { name: 'Before you can generate' })).toBeVisible()
    const issue = page.getByRole('button', { name: `${SUBJECT_LABEL} — Scope` })
    await expect(issue).toBeVisible()
    const generate = page.getByTestId('offer-wizard-action-bar').getByRole('button', { name: 'Generate offer' })
    await expect(generate).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByTestId('offer-wizard-action-bar')).toContainText('1 missing · 0 to correct')
    await generate.click({ force: true }) // aria-disabled: the click is ignored
    await expect(page).toHaveURL(/\/offer/)
    expect(await listOffersViaApi(admin, generateDeal.id)).toHaveLength(0)

    // A generation asked for by any other means is refused too, and creates no offer.
    const draft = await getDraftViaApi(admin, generateDeal.id)
    expect(draft).not.toBeNull()
    const refused = await tryGenerateDraftViaApi(admin, generateDeal.id, draft!.version)
    expect(refused.status).toBe(422)
    expect(refused.body.code).toBe('offer_incomplete')
    expect(refused.body.missing?.map((missing) => missing.name)).toEqual(['OGGETTO'])
    expect(await listOffersViaApi(admin, generateDeal.id)).toHaveLength(0)

    // The issue takes the person to its field; filling it in clears the block.
    await issue.click()
    await expect(stepTab(page, 'Scope')).toHaveAttribute('aria-selected', 'true')
    const subject = page.getByLabel(SUBJECT_LABEL)
    await expect(subject).toBeFocused()
    expect(await savedBy(page, () => subject.fill('Portale clienti'))).toBe(200)

    await stepTab(page, 'Preview').click()
    await expect(page.getByText('Nothing is missing. You can generate the offer.')).toBeVisible()
    await expect(generate).not.toHaveAttribute('aria-disabled', 'true')
    await generate.click()

    // Generated: the deal page confirms the offer, lists it, and the draft is gone (AC-6.6).
    await expect(page).toHaveURL(new RegExp(`/crm/deals/${generateDeal.id}/?$`), { timeout: 60_000 })
    await expect(page.getByText(/Offer \S+ generated\./)).toBeVisible({ timeout: 30_000 })
    const table = page.getByTestId('crm-offers-table')
    await expect(table).toContainText(`Template: ${minimal.name}`)
    await expect(table).toContainText('Italian')
    await expect(page.getByTestId('crm-offer-draft-row')).toHaveCount(0)

    const offers = await listOffersViaApi(admin, generateDeal.id)
    expect(offers).toHaveLength(1)
    expect(offers[0]!.origin).toBe('wizard')
    expect(offers[0]!.sent).toBeNull()
    expect(await getDraftViaApi(admin, generateDeal.id)).toBeNull()

    await context.close()
  })

  test('two contexts saving the same draft: the older one is refused and told to reload; one that only moves between steps gets no conflict (AC-6.3)', async ({
    browser,
  }) => {
    const draft = await createDraftViaApi(admin, conflictDeal.id, minimal.id)
    const url = wizardUrl(conflictDeal, 'scope')

    const contextA = await contextFor(browser, admin)
    const contextB = await contextFor(browser, admin)
    const contextC = await contextFor(browser, admin)
    const [a, b, c] = await Promise.all([contextA.newPage(), contextB.newPage(), contextC.newPage()])

    // C only ever navigates: any write it sent would be a bug (a step change saves nothing by itself).
    const writesFromC: string[] = []
    c.on('request', (request) => {
      if (request.url().includes('/offer-draft') && request.method() !== 'GET') writesFromC.push(request.method())
    })

    for (const page of [a, b, c]) {
      await page.goto(url)
      await expect(page.getByLabel(SUBJECT_LABEL)).toBeVisible({ timeout: 30_000 })
    }

    // A saves first: the draft moves to a newer version.
    expect(await savedBy(a, () => a.getByLabel(SUBJECT_LABEL).fill('Versione A'))).toBe(200)
    const afterA = await getDraftViaApi(admin, conflictDeal.id)
    expect(afterA!.version).toBeGreaterThan(draft.version)
    expect(afterA!.answers.fields['OGGETTO']).toBe('Versione A')

    // B, still on the old version, saves a change: refused, told to reload, A's change is not lost.
    expect(await savedBy(b, () => b.getByLabel(SUBJECT_LABEL).fill('Versione B'))).toBe(409)
    const conflict = b.getByTestId('crm-offer-wizard-conflict')
    await expect(conflict).toBeVisible({ timeout: 15_000 })
    await expect(conflict).toContainText('Someone else changed this draft')
    expect((await getDraftViaApi(admin, conflictDeal.id))!.answers.fields['OGGETTO']).toBe('Versione A')
    await conflict.getByRole('button', { name: 'Reload draft' }).click()
    await expect(conflict).toHaveCount(0)
    await expect(b.getByLabel(SUBJECT_LABEL)).toHaveValue('Versione A')

    // C, on the same stale version, only moves between steps: no write, no conflict, the draft is as A left it.
    for (const name of ['Client', 'Costs', 'Scope', 'Preview']) await stepTab(c, name).click()
    await c.waitForTimeout(2_000) // longer than the autosave debounce (1 s): a stray save would have gone by now
    await expect(c.getByTestId('crm-offer-wizard-conflict')).toHaveCount(0)
    expect(writesFromC).toEqual([])
    expect((await getDraftViaApi(admin, conflictDeal.id))!.version).toBe(afterA!.version)

    await Promise.all([contextA.close(), contextB.close(), contextC.close()])
  })
})

// ═══ T67 — the letterhead behind the preview and the issuer from the entity profile ═══════════════════════════════

/** The wide layout (xl, 1280 px and up) shows the preview inline; below it the preview is a Drawer. */
const WIDE = { width: 1440, height: 900 }

const letterheadLinkPath = /\/entity-profiles\/welld_ch\/letterhead$/
const isLetterheadLinkRead = (request: { url: () => string; method: () => string }): boolean =>
  request.method() === 'GET' && letterheadLinkPath.test(new URL(request.url()).pathname)

const SHOWN_CAPTION = 'The letterhead is shown on every page. Page breaks are approximate: the PDF is the authority.'

/** `rgb(r, g, b)` / `rgba(r, g, b, a)` → [r, g, b]. */
function channels(color: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(color)
  if (!match) throw new Error(`not an rgb colour: ${color}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
const lightness = (color: string): number => {
  const [r, g, b] = channels(color)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** What the first page and the letterhead on it look like to the browser, for the dark/light comparison. */
async function paperLook(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector('[data-testid="crm-wizard-page"]') as HTMLElement
    const image = paper.querySelector('[data-testid="crm-wizard-letterhead"]') as HTMLElement
    const flow = document.querySelector('[data-testid="crm-wizard-flow"]') as HTMLElement
    const own = (el: HTMLElement) => {
      const style = getComputedStyle(el)
      return { filter: style.filter, opacity: style.opacity, blend: style.mixBlendMode, backdrop: style.backdropFilter }
    }
    const chain: ReturnType<typeof own>[] = []
    for (let el: HTMLElement | null = image; el && el !== paper.parentElement; el = el.parentElement)
      chain.push(own(el))
    return {
      body: getComputedStyle(document.body).backgroundColor,
      paper: getComputedStyle(paper).backgroundColor,
      paperInk: getComputedStyle(flow).color,
      imageTag: image.tagName,
      chain,
    }
  })
}

test.describe('specs/20261115-crm-offer-wizard T67: the letterhead behind the preview and the issuer from the profile', () => {
  let admin: SeededSession
  let profile: ProfileRow
  let issuerName: string
  let issuerTemplate: TemplateRow
  let minimal: TemplateRow
  let sla: TemplateRow
  const deals: DealRow[] = []

  /** A deal with a fresh draft from `template` (through the API: the draft is not what these journeys are about). */
  async function dealWithDraft(label: string, template: TemplateRow): Promise<DealRow> {
    const deal = await createDealPastEstimateGate(admin, label, runId)
    deals.push(deal)
    await createDraftViaApi(admin, deal.id, template.id)
    return deal
  }

  test.beforeAll(async () => {
    admin = await offerAdmin()
    await ensureEntityProfile(admin)
    await ensureLetterhead(admin)
    profile = await getEntityProfile(admin)
    issuerName = (profile.legalName ?? '').trim()
    expect(issuerName, 'welld_ch has a legal name').not.toBe('')
    expect(profile.letterhead, 'welld_ch has a letterhead').toBeTruthy()
    minimal = await createMinimalTemplateViaApi(admin, `E2E letterhead ${runId}`)
    issuerTemplate = await createIssuerTemplateViaApi(admin, `E2E issuer ${runId}`)
    sla = await findSeededTemplateNamed(admin, 'Manutenzione e SLA')
  })

  test.afterAll(async () => {
    if (!admin) return
    for (const deal of deals) await discardDraftViaApi(admin, deal.id)
    if (minimal) await archiveTemplateViaApi(admin, minimal.id)
    if (issuerTemplate) await archiveTemplateViaApi(admin, issuerTemplate.id)
  })

  test("the preview shows the entity's letterhead behind the text, fetched once per opening (AC-11.1, AC-11.8)", async ({
    browser,
  }) => {
    const deal = await dealWithDraft('letterhead-shown', minimal)
    const context = await contextFor(browser, admin, { viewport: WIDE })
    const page = await context.newPage()
    let linkReads = 0
    page.on('request', (request) => {
      if (isLetterheadLinkRead(request)) linkReads++
    })

    await page.goto(wizardUrl(deal, 'scope'))
    await expect(page.getByLabel(SUBJECT_LABEL)).toBeVisible({ timeout: 30_000 })

    const band = page.getByTestId('crm-wizard-letterhead-band')
    const stage = page.getByTestId('crm-wizard-stage')
    await expect(band).toHaveAttribute('data-state', 'shown', { timeout: 30_000 })
    await expect(band).toHaveText(SHOWN_CAPTION)

    // The letterhead is the background of the page: a decorative image, at the page's full width, in A4 proportions.
    // (The minimal offer fits one page; several pages and every page's letterhead are crm-offer-wizard-pages.spec.ts.)
    const paper = page.getByTestId('crm-wizard-preview').locator('article')
    const sheet = page.getByTestId('crm-wizard-page').first()
    const image = page.getByTestId('crm-wizard-letterhead').first()
    await expect(stage).toHaveAttribute('data-pages', '1')
    await expect(page.getByTestId('crm-wizard-letterhead')).toHaveCount(1)
    await expect(image).toHaveJSProperty('tagName', 'IMG')
    await expect(image).toHaveAttribute('aria-hidden', 'true')
    await expect(image).toHaveAttribute('alt', '')
    await expect(image).toHaveAttribute('src', /^blob:/)
    expect(await image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    expect(await image.evaluate((el) => getComputedStyle(el).userSelect)).toBe('none')
    const sheetBox = (await sheet.boundingBox())!
    const imageBox = (await image.boundingBox())!
    expect(Math.abs(imageBox.width - sheetBox.width)).toBeLessThan(3)
    expect(sheetBox.height / sheetBox.width).toBeCloseTo(297 / 210, 2)
    expect(imageBox.height / imageBox.width).toBeCloseTo(297 / 210, 1)

    // The text stays real text above it: found by the page, selectable, and what the pointer reaches is not the image.
    const salutation = paper.getByText('Dear client.')
    await expect(salutation).toBeVisible()
    expect(await salutation.evaluate((el) => getComputedStyle(el).userSelect)).not.toBe('none')
    const reached = await salutation.evaluate((el) => {
      const box = el.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + 4, box.top + box.height / 2)
      return hit?.closest('[data-testid="crm-wizard-letterhead"]') === null
    })
    expect(reached).toBe(true)

    // Typing, and moving between steps, never asks for the letterhead again (AC-11.8); the band stays as it is.
    expect(await savedBy(page, () => page.getByLabel(SUBJECT_LABEL).fill('Portale clienti'))).toBe(200)
    await expect(paper).toContainText('Portale clienti')
    for (const name of ['Costs', 'Preview', 'Scope']) await stepTab(page, name).click()
    await expect(band).toHaveAttribute('data-state', 'shown')
    expect(linkReads).toBe(1)

    await context.close()
  })

  test('when the letterhead link fails the band says so, the text and autosave carry on, and the next opening tries again (AC-11.4)', async ({
    browser,
  }) => {
    const deal = await dealWithDraft('letterhead-failed', minimal)
    const context = await contextFor(browser, admin, { viewport: WIDE })
    const page = await context.newPage()
    let linkReads = 0
    await page.route(letterheadLinkPath, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      linkReads++
      return route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ type: 'about:blank', title: 'Internal Server Error', status: 500 }),
      })
    })

    await page.goto(wizardUrl(deal, 'scope'))
    await expect(page.getByLabel(SUBJECT_LABEL)).toBeVisible({ timeout: 30_000 })

    // The band names the entity by its legal name; nothing is drawn behind the text, nothing pops up.
    const band = page.getByTestId('crm-wizard-letterhead-band')
    await expect(band).toHaveAttribute('data-state', 'failed', { timeout: 30_000 })
    await expect(band).toContainText(
      `The letterhead of ${issuerName} could not be shown here. It is still added in the PDF.`,
    )
    // Nothing is drawn behind the page: the A4 page is still there, without an image.
    await expect(page.getByTestId('crm-wizard-page')).toHaveCount(1)
    await expect(page.getByTestId('crm-wizard-letterhead')).toHaveCount(0)
    await expect(band).not.toHaveAttribute('role', 'alert')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    expect(linkReads).toBe(1) // not retried in a loop

    // The preview's text, the autosave, the counts and the generate action are unaffected.
    const paper = page.getByTestId('crm-wizard-preview').locator('article')
    await expect(paper).toContainText('Dear client.')
    expect(await savedBy(page, () => page.getByLabel(SUBJECT_LABEL).fill('Portale clienti'))).toBe(200)
    await expect(paper).toContainText('Portale clienti')
    await stepTab(page, 'Preview').click()
    await expect(page.getByText('Nothing is missing. You can generate the offer.')).toBeVisible()
    await expect(
      page.getByTestId('offer-wizard-action-bar').getByRole('button', { name: 'Generate offer' }),
    ).not.toHaveAttribute('aria-disabled', 'true')
    await expect(band).toHaveAttribute('data-state', 'failed')
    expect(linkReads).toBe(1)

    // Opened again with the link working: tried again, and shown.
    await page.unroute(letterheadLinkPath)
    await page.reload()
    await expect(page.getByTestId('crm-wizard-letterhead-band')).toHaveAttribute('data-state', 'shown', {
      timeout: 30_000,
    })
    await expect(page.getByTestId('crm-wizard-letterhead')).toHaveCount(1)
    await expect(page.getByTestId('crm-wizard-letterhead').first()).toHaveJSProperty('tagName', 'IMG')

    await context.close()
  })

  test('the dark theme keeps the paper and the letterhead light and unchanged (AC-11.5)', async ({ browser }) => {
    const deal = await dealWithDraft('letterhead-theme', minimal)
    const looks = {} as Record<'dark' | 'light', Awaited<ReturnType<typeof paperLook>>>
    const shots: Partial<Record<'dark' | 'light', Buffer>> = {}

    for (const scheme of ['dark', 'light'] as const) {
      const context = await contextFor(browser, admin, { viewport: WIDE, colorScheme: scheme })
      const page = await context.newPage()
      await page.goto(wizardUrl(deal, 'scope'))
      await expect(page.getByTestId('crm-wizard-letterhead-band')).toHaveAttribute('data-state', 'shown', {
        timeout: 30_000,
      })
      await expect(page.getByTestId('crm-wizard-letterhead').first()).toHaveJSProperty('tagName', 'IMG')
      await expect
        .poll(() =>
          page
            .getByTestId('crm-wizard-letterhead')
            .first()
            .evaluate((el) => (el as HTMLImageElement).complete),
        )
        .toBe(true)
      looks[scheme] = await paperLook(page)
      // The page itself, inside its edge and inside what the scroll region shows of it: the stage around it (the gap)
      // follows the theme, the page must not.
      const box = await page.evaluate(() => {
        const region = document.querySelector('[data-testid=crm-wizard-preview]') as HTMLElement
        const r = region.getBoundingClientRect()
        const p = document.querySelector('[data-testid=crm-wizard-page]')!.getBoundingClientRect()
        const top = Math.max(p.top, r.top) + 2
        const bottom = Math.min(p.bottom, r.bottom) - 2
        return { x: p.left + 2, y: top, width: p.width - 4, height: bottom - top }
      })
      shots[scheme] = await page.screenshot({ clip: box })
      await context.close()
    }

    // The two themes really differ around the paper (the suite's dark palette is on :root) ...
    expect(looks.dark.body).toBe('rgb(13, 13, 20)')
    expect(looks.light.body).not.toBe(looks.dark.body)
    expect(lightness(looks.light.body)).toBeGreaterThan(0.5)
    // ... and not on it: the paper is light in the dark theme, the same colour as in the light one.
    expect(lightness(looks.dark.paper)).toBeGreaterThan(0.9)
    expect(looks.dark.paper).toBe(looks.light.paper)
    expect(looks.dark.paperInk).toBe(looks.light.paperInk)
    // Nothing on the letterhead or between it and the paper inverts, dims, tints or blends it.
    for (const scheme of ['dark', 'light'] as const) {
      expect(looks[scheme].imageTag).toBe('IMG')
      for (const layer of looks[scheme].chain) {
        expect(layer).toEqual({ filter: 'none', opacity: '1', blend: 'normal', backdrop: 'none' })
      }
    }
    // The pixels of the page (letterhead and text) are the same in both.
    expect(Buffer.compare(shots.dark!, shots.light!) === 0, 'the paper looks the same in both themes').toBe(true)
  })

  test("the seeded SLA template prints the profile's legal name and its Fornitore row the name and address in the preview (AC-12.3, AC-12.10)", async ({
    browser,
  }) => {
    const deal = await dealWithDraft('issuer-preview', sla)
    const context = await contextFor(browser, admin, { viewport: WIDE })
    const page = await context.newPage()
    await page.goto(wizardUrl(deal, 'client'))
    const paper = page.getByTestId('crm-wizard-preview').locator('article')
    await expect(paper).toContainText('Il presente contratto viene stipulato tra', { timeout: 30_000 })

    // The opening sentence names the issuer from the profile; the parties table's row adds the address, comma-separated.
    await expect(paper).toContainText(
      `Il presente contratto viene stipulato tra ${issuerName}, di seguito denominata «Fornitore»`,
    )
    const address = issuerAddressText(profile)
    const supplier = address ? `${issuerName}, ${address}` : issuerName
    const row = paper.locator('tr', { hasText: 'Fornitore' }).filter({ hasText: supplier })
    await expect(row.first()).toBeVisible()
    await expect(row.first()).toContainText(supplier)

    // No literal from the earlier seeds survives (the SLA's short defined term «WellD» is not the legal name).
    const text = await paper.innerText()
    expect(text).not.toContain('WellD Sagl')
    expect(text).not.toContain('Via Pessina')
    expect(text).not.toContain('CP 1920')

    await context.close()
  })

  test("the issuer's name and address from the profile are printed alike in the preview and in the generated offer (AC-12.2, AC-12.9)", async ({
    browser,
  }) => {
    const deal = await createDealPastEstimateGate(admin, 'issuer-pdf', runId)
    deals.push(deal)
    const draft = await createDraftViaApi(admin, deal.id, issuerTemplate.id)
    await setFieldViaApi(admin, deal.id, draft, 'OGGETTO', 'Portale clienti')
    const address = issuerAddressText(profile)
    const supplierLine = `Supplier line: ${address ? `${issuerName}, ${address}` : issuerName}`

    const context = await contextFor(browser, admin, { viewport: WIDE })
    const page = await context.newPage()
    await page.goto(wizardUrl(deal, 'preview'))
    const paper = page.getByTestId('crm-wizard-preview').locator('article')
    await expect(paper).toContainText(supplierLine, { timeout: 30_000 })

    // Nothing is missing (the issuer's name and address are the CRM's to supply): generate from the Preview step.
    await expect(page.getByText('Nothing is missing. You can generate the offer.')).toBeVisible()
    await page.getByTestId('offer-wizard-action-bar').getByRole('button', { name: 'Generate offer' }).click()
    await expect(page).toHaveURL(new RegExp(`/crm/deals/${deal.id}/?$`), { timeout: 60_000 })
    await expect(page.getByText(/Offer \S+ generated\./)).toBeVisible({ timeout: 30_000 })

    // The generated offer's own text (its PDF, read back) prints the same line.
    const offers = await listOffersViaApi(admin, deal.id)
    expect(offers).toHaveLength(1)
    const printed = await offerPdfText(admin, deal.id, offers[0]!.id)
    expect(printed.replace(/\s+/g, ' ')).toContain(supplierLine)

    await context.close()
  })
})
