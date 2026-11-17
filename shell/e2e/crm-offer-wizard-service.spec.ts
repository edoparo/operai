/**
 * specs/20261116-letterhead-service T34 — the CRM offer wizard on the LETTERHEAD SERVICE path, through the REAL assembled
 * shell and crm-ui against the REAL crm-api (`LETTERHEAD_SERVICE_ENABLED=true`), `auth` and letterhead-api. Nothing is
 * intercepted in the browser; the one thing that is made to fail, the hop from crm-api to the service, goes through a
 * relay this spec runs itself (fixtures/crmOfferService.ts).
 *
 *   AC-10.3  the preview shows the PAGES the service returns (page count, "N / M" on each page as the PDF's own, each
 *            page's text as its text alternative), not the HTML pagination and the letterhead drawn in the browser; and
 *            what is generated is those pages: the stored PDF has the preview's page count and the text of each page
 *   AC-10.4  a missing field is drawn on the page in the highlighted style with its label, and filled it is not; the
 *            previous pages stay until the new ones arrive, and the preview is never blank (the 2 s p95 is
 *            letterhead-api/perf/preview-edits.ts: a timing needs 40 samples, not one)
 *   AC-10.5  each page's text is the figure's text alternative; no per-page copy affordance is offered
 *   AC-10.6  the service unreachable on Generate: nothing is created, no offer number is used, the draft is as it was
 *   AC-10.7  the service stopped in the middle of a session: the last pages stay, a polite notice says the preview could
 *            not be updated, typing, saving and moving between steps go on, no dialog; with no earlier pages the
 *            notice carries the sentence and the placeholder is empty; Try again works once the service is back
 *   AC-10.8  no active letterhead for the entity: the preview and Generate say so, a person with access to Letterheads
 *            gets the link to the configurator, anyone else is told to ask an administrator and sees no link; no PDF
 *   AC-10.14 "Try the wizard" in the template editor draws the service's pages for the template AS TYPED, with the sample
 *            answers, in every case (T53): a saved template asks `POST /offer-templates/{id}/try-preview`, a template never
 *            saved asks `POST /offer-templates/try-preview` (no id); no approximate preview, no note; nothing is stored. A
 *            person with `deal:financials` and no `deal:manage` gets the pages too, and can write nothing (T54)
 *
 * The old path (switch off) is crm-offer-wizard*.spec.ts; with the switch on those journeys are not meaningful (their
 * letterhead is the PDF upload, which answers 410 `letterhead_upload_retired` then): run them on a stack without it.
 *
 * ═══ PREREQUISITES (what must be running, with which env) ═══════════════════════════════════════════════════
 * The stack of crm-offer-wizard.spec.ts (postgres, object storage, `auth` :3001 with ENABLE_TEST_AUTH=true and its seed,
 * activities-api :8087 for the estimate override's timeline note, crm-api :8084 with its migrations, the shell, crm-ui and
 * letterheads-ui served) with THIS feature wired on top of it:
 *
 *  - letterhead-api (a container, or `mise run dev:letterhead`) on its OWN database and bucket, reading THIS `auth`'s JWKS
 *    and `GET /authz/resolve`, ALLOWED_ORIGINS holding the shell's origin (playwright.config.ts item 8; the origin the
 *    spec reaches it at is E2E_LETTERHEADS_API_URL, default http://localhost:8088).
 *  - `auth`: the `crm-api` entry of SERVICE_CLIENTS holds the scope `letterhead:render` (and `activities.write`, for the
 *    override), and SERVICE_AUDIENCE equals letterhead-api's.
 *  - crm-api: LETTERHEAD_SERVICE_ENABLED=true; SERVICE_CLIENT_ID / SERVICE_CLIENT_SECRET (the `crm-api` entry above);
 *    LETTERHEAD_API_URL = the RELAY, http://localhost:18240 (E2E_LETTERHEAD_RELAY_PORT): the spec listens there and
 *    forwards every byte to E2E_LETTERHEADS_API_URL, so with the relay up nothing differs from a direct call. The first
 *    journey checks that crm-api really goes through it and says so if it does not.
 *  - the shell's build is told letterhead-api's origin (VITE_LETTERHEADS_API_URL), as for letterheads.spec.ts.
 *
 * What a run leaves behind: offers (and their numbers) of welld_ch, one version of welld_ch's letterhead when it had none
 * (versions are never deleted: AC-4.3), the entity profile of welld_it when it had none, four @operai.test users. The
 * templates the run made are archived; its drafts are discarded.
 *
 * The "no letterhead" journey needs an entity the service has no active letterhead for, and there is no way to remove
 * one: it uses welld_it and runs only while the service has none for it (a fresh service database). It SKIPS, naming
 * why, once welld_it has one (letterheads.spec.ts saves one). This spec never saves welld_it's.
 *
 *  run:  cd shell && pnpm exec playwright test crm-offer-wizard-service --trace off
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  SUBJECT_LABEL,
  archiveTemplateViaApi,
  createDraftViaApi,
  crmCall,
  discardDraftViaApi,
  getDraftViaApi,
  listOffersViaApi,
  newRunId,
  offerAdmin,
  setFieldViaApi,
  signInContext,
  type SeededSession,
} from './helpers/crmOfferFixtures'
import {
  LONG_TEMPLATE_SOURCE,
  ServiceRelay,
  createDealOf,
  createTemplateOf,
  ensureProfileOf,
  ensureServiceLetterhead,
  missingFieldPixels,
  offerPdfPages,
  setUpSeller,
  setUpTemplateReader,
  squash,
  type EntityDeal,
  type TemplateRow,
} from './fixtures/crmOfferService'
import { activeVersion } from './fixtures/letterheads'
import { MINIMAL_TEMPLATE_SOURCE } from './helpers/crmOfferFixtures'

const runId = newRunId()

test.describe.configure({ mode: 'serial' })

/** The wide layout (xl, 1280 px and up) shows the preview inline, beside the form. */
const WIDE = { width: 1440, height: 900 }

const PREVIEW = 'crm-wizard-service-preview'

const wizardUrl = (deal: EntityDeal, step: string): string => `/crm/deals/${deal.id}/offer?step=${step}`
const stepTab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) })
const preview = (page: Page) => page.getByTestId(PREVIEW)
const pageImages = (page: Page) => preview(page).getByRole('img', { name: /^Page \d+ of \d+$/ })
const generateButton = (page: Page) =>
  page.getByTestId('offer-wizard-action-bar').getByRole('button', { name: 'Generate offer' })

async function contextFor(browser: Browser, session: SeededSession): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: WIDE })
  await signInContext(context, session)
  return context
}

/** The text of each page of the preview, in order: the figure's visually hidden caption (its text alternative). */
async function previewTexts(page: Page): Promise<string[]> {
  return preview(page).locator('figure figcaption').allTextContents()
}

/** Waits until the preview has drawn pages and is not updating any more. */
async function readyPreview(page: Page, timeout = 30_000): Promise<void> {
  await expect(preview(page)).toHaveAttribute('data-state', 'ready', { timeout })
  await expect(pageImages(page).first()).toBeVisible()
}

/** Counts, from now on, the times the preview region held no page at all (a blank pane). */
async function watchForBlank(page: Page): Promise<void> {
  await page.evaluate((testId) => {
    const region = document.querySelector(`[data-testid="${testId}"]`)
    if (!region) throw new Error('no preview region to watch')
    const w = window as unknown as { __blankSeen: number }
    w.__blankSeen = 0
    const check = () => {
      if (!region.querySelector('figure img')) w.__blankSeen += 1
    }
    new MutationObserver(check).observe(region, { subtree: true, childList: true, attributes: true })
  }, PREVIEW)
}
const blankSeen = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __blankSeen: number }).__blankSeen)

const isDraftWrite = (response: { url: () => string; request: () => { method: () => string } }): boolean =>
  response.url().includes('/offer-draft') && response.request().method() === 'PUT'

/** Runs `act` and resolves once the autosave it causes has been answered (the wizard's debounce is 1 s). */
async function savedBy(page: Page, act: () => Promise<void>): Promise<number> {
  const [response] = await Promise.all([page.waitForResponse(isDraftWrite, { timeout: 20_000 }), act()])
  return response.status()
}

/** Every name an entity's templates hold, archived ones too, of both formats (what a create would find taken). */
async function templateNamesOf(session: SeededSession, entity: 'welld_ch' | 'welld_it'): Promise<string[]> {
  const listed = await crmCall<{ items: TemplateRow[] }>(
    session,
    'GET',
    `/offer-templates?entity=${entity}&includeArchived=true&formats=sections,wizard`,
  )
  expect(listed.status, 'GET /offer-templates').toBe(200)
  return listed.body.items.map((row) => row.name)
}

/** The sequence part of an offer reference "NNNN/YYYY". */
const sequenceOf = (reference: string): number => Number(reference.split('/')[0])

test.describe('specs/20261116-letterhead-service T34: the CRM offer wizard on the letterhead service', () => {
  const relay = new ServiceRelay()
  let admin: SeededSession
  let seller: SeededSession
  let reader: SeededSession
  let minimal: TemplateRow
  let long: TemplateRow
  let minimalIt: TemplateRow
  const deals: EntityDeal[] = []
  const unconfigured = { value: false }
  let generatedNumber = 0

  async function dealWith(entity: 'welld_ch' | 'welld_it', label: string, template: TemplateRow): Promise<EntityDeal> {
    const deal = await createDealOf(admin, entity, label, runId)
    deals.push(deal)
    await createDraftViaApi(admin, deal.id, template.id)
    return deal
  }

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    await relay.up()
    admin = await offerAdmin()
    seller = await setUpSeller(admin)
    reader = await setUpTemplateReader(admin)
    await ensureServiceLetterhead(admin, 'welld_ch')
    await ensureProfileOf(admin, 'welld_ch')
    await ensureProfileOf(admin, 'welld_it')
    unconfigured.value = (await activeVersion(admin, 'welld_it')) === null
    minimal = await createTemplateOf(admin, 'welld_ch', `E2E service minimal ${runId}`, MINIMAL_TEMPLATE_SOURCE)
    long = await createTemplateOf(admin, 'welld_ch', `E2E service long ${runId}`, LONG_TEMPLATE_SOURCE)
    minimalIt = await createTemplateOf(admin, 'welld_it', `E2E service minimal IT ${runId}`, MINIMAL_TEMPLATE_SOURCE)
  })

  test.afterAll(async () => {
    await relay.down()
    if (!admin) return
    for (const deal of deals) await discardDraftViaApi(admin, deal.id)
    for (const template of [minimal, long, minimalIt]) if (template) await archiveTemplateViaApi(admin, template.id)
  })

  test("the preview is the service's pages: their count, \"N / M\" on each, the text of each as its alternative; nothing is drawn in the browser (AC-10.3, AC-10.5)", async ({
    browser,
  }) => {
    const deal = await dealWith('welld_ch', 'pages', long)
    await setFieldViaApi(admin, deal.id, (await getDraftViaApi(admin, deal.id))!, 'OGGETTO', 'Portale clienti')

    const context = await contextFor(browser, admin)
    const page = await context.newPage()
    const previewCalls: { url: string; body: { answers?: { fields?: Record<string, unknown> } } }[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/offer-draft/preview')) {
        previewCalls.push({ url: request.url(), body: request.postDataJSON() })
      }
    })
    await page.goto(wizardUrl(deal, 'scope'))
    await readyPreview(page)

    // The crm-api -> service hop goes through the relay (else the "service stopped" journeys below prove nothing).
    expect(relay.forwarded, 'crm-api calls the service through the relay: set its LETTERHEAD_API_URL to it').toBeGreaterThan(0)

    // The pages: one image per page with "Page N of M", the count in the status row, several of them (a long offer).
    const count = await pageImages(page).count()
    expect(count).toBeGreaterThanOrEqual(3)
    for (let n = 1; n <= count; n += 1) {
      await expect(preview(page).getByRole('img', { name: `Page ${n} of ${count}` })).toBeVisible()
    }
    await expect(preview(page)).toContainText(`${count} pages`)

    // "N / M" is on each page, and is the PDF's own: the letterhead's footer text (`{page} / {pages}`), as the service
    // drew it, so it is in each page's text and nowhere else.
    const texts = await previewTexts(page)
    expect(texts).toHaveLength(count)
    texts.forEach((text, index) => {
      expect(text, `page ${index + 1} says its own number`).toContain(`${index + 1} / ${count}`)
      expect(text.trim().length, `page ${index + 1} has its text as its alternative`).toBeGreaterThan(40)
    })
    // The figure the screen reader meets is the page and its text, in that order (AC-10.5).
    const first = preview(page).locator('figure').first()
    await expect(first.locator('img')).toHaveAttribute('alt', `Page 1 of ${count}`)
    await expect(first.locator('figcaption')).toContainText('Dear client.')
    // Not offered: a way to select and copy the page's text out of the picture.
    expect(await first.locator('img').getAttribute('draggable')).toBe('false')
    expect(await first.locator('img').evaluate((img) => getComputedStyle(img).userSelect)).toBe('none')

    // Nothing of the old path: no HTML pagination, no letterhead band or picture drawn behind the text by the browser.
    for (const old of ['crm-wizard-page', 'crm-wizard-flow', 'crm-wizard-letterhead-band', 'crm-wizard-letterhead']) {
      await expect(page.getByTestId(old), `${old} is not drawn on the service path`).toHaveCount(0)
    }

    // What was asked is the UNSAVED draft body, of this deal (the same body the save sends).
    expect(previewCalls.length).toBeGreaterThan(0)
    expect(previewCalls[0]!.url).toContain(`/deals/${deal.id}/offer-draft/preview`)
    expect(previewCalls[0]!.body.answers?.fields?.['OGGETTO']).toBe('Portale clienti')

    await context.close()
  })

  test('a missing field is drawn on the page, highlighted, with its label; filled in, it is not; the pages never go blank (AC-10.4)', async ({
    browser,
  }) => {
    const deal = await dealWith('welld_ch', 'missing', minimal)
    const context = await contextFor(browser, admin)
    const page = await context.newPage()
    await page.goto(wizardUrl(deal, 'scope'))
    await readyPreview(page)

    // The page has the field's label where its value goes, and is drawn in the highlight: the pixels, not just the words.
    expect((await previewTexts(page))[0]).toContain(SUBJECT_LABEL)
    const highlighted = await missingFieldPixels(page, PREVIEW)
    expect(highlighted, 'the missing field is drawn highlighted on the page').toBeGreaterThan(40)
    // The wizard adds nothing on top of the page: its own count and the Preview step's list are the way to the field.
    await expect(page.getByText('1 missing').first()).toBeVisible()
    await stepTab(page, 'Preview').click()
    await expect(page.getByRole('button', { name: `${SUBJECT_LABEL} — Scope` })).toBeVisible()
    await stepTab(page, 'Scope').click()

    // Typing the value: the preview follows WITHOUT a save, keeps the old pages while it asks, and is never blank.
    await watchForBlank(page)
    const subject = page.getByLabel(SUBJECT_LABEL)
    const typed = Date.now()
    const saved = savedBy(page, () => subject.fill('Portale clienti'))
    await expect(preview(page).locator('figure figcaption').first()).toContainText('Portale clienti', { timeout: 15_000 })
    const shownAfterMs = Date.now() - typed
    await readyPreview(page)
    expect((await previewTexts(page))[0]).not.toContain(SUBJECT_LABEL)
    expect(await missingFieldPixels(page, PREVIEW), 'filled in, nothing is drawn highlighted').toBe(0)
    expect(await blankSeen(page), 'the pane was never without a page while it updated').toBe(0)

    // The change was shown from the unsaved draft (before the autosave's 1 s debounce has even fired): the saved one
    // catches up on its own afterwards. (One sample of the 2 s of AC-10.4, noted; the p95 is the perf script's.)
    test.info().annotations.push({ type: 'preview-after-edit-ms', description: String(shownAfterMs) })
    expect(await saved).toBe(200)
    expect((await getDraftViaApi(admin, deal.id))!.answers.fields['OGGETTO']).toBe('Portale clienti')

    await context.close()
  })

  test('the service stops in the middle of a session: the last pages stay, a polite notice, typing and saving go on, no dialog; back up, Try again (AC-10.7)', async ({
    browser,
  }) => {
    const deal = await dealWith('welld_ch', 'stopped', minimal)
    const context = await contextFor(browser, admin)
    const page = await context.newPage()
    let dialogs = 0
    page.on('dialog', async (dialog) => {
      dialogs += 1
      await dialog.dismiss()
    })
    await page.goto(wizardUrl(deal, 'scope'))
    await readyPreview(page)
    const before = await previewTexts(page)
    const beforeSources = await preview(page).locator('figure img').evaluateAll((images) => images.map((i) => (i as HTMLImageElement).src))
    expect(before[0]).toContain(SUBJECT_LABEL)

    await relay.down()
    try {
      // Typing goes on: the answer is in the field, the preview asks again, and cannot be made.
      const subject = page.getByLabel(SUBJECT_LABEL)
      await subject.click()
      const typedAndSaved = savedBy(page, () => subject.pressSequentially('Portale clienti', { delay: 20 }))
      await expect(subject).toHaveValue('Portale clienti')

      const notice = page.getByTestId('crm-wizard-service-preview-failed')
      await expect(notice).toBeVisible({ timeout: 30_000 })
      await expect(notice).toContainText('The preview could not be updated')
      await expect(notice).toContainText('The pages shown are from your last successful preview')
      await expect(preview(page)).toHaveAttribute('data-state', 'failed')
      await expect(preview(page).getByTestId('page-preview-status')).toContainText('Could not update')

      // Polite, not a dialog and not an alarm: no dialog of any kind, nothing announced as an alert in the pane.
      expect(dialogs).toBe(0)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('alertdialog')).toHaveCount(0)
      await expect(preview(page).getByRole('alert')).toHaveCount(0)
      expect(await notice.evaluate((el) => (el.getAttribute('aria-live') ?? el.querySelector('[aria-live]')?.getAttribute('aria-live')))).toBe('polite')

      // The last pages stay, unchanged: the same pictures, the same text.
      await expect(pageImages(page).first()).toBeVisible()
      expect(await previewTexts(page)).toEqual(before)
      expect(await preview(page).locator('figure img').evaluateAll((images) => images.map((i) => (i as HTMLImageElement).src))).toEqual(beforeSources)

      // Nothing else is blocked: the draft is saved, the steps change, Next works.
      expect(await typedAndSaved).toBe(200)
      expect((await getDraftViaApi(admin, deal.id))!.answers.fields['OGGETTO']).toBe('Portale clienti')
      await stepTab(page, 'Costs').click()
      await expect(stepTab(page, 'Costs')).toHaveAttribute('aria-selected', 'true')
      await stepTab(page, 'Scope').click()
      await expect(page.getByLabel(SUBJECT_LABEL)).toHaveValue('Portale clienti')
      await expect(pageImages(page).first()).toBeVisible()
      // The notice is still there after the step changes, and Try again asks again while the service is still down.
      await notice.getByRole('button', { name: 'Try again' }).click()
      await expect(notice).toBeVisible({ timeout: 30_000 })
      await expect(preview(page)).toHaveAttribute('data-state', 'failed', { timeout: 30_000 })
    } finally {
      await relay.up()
    }

    // The service is back: Try again draws the pages of what was typed, and the notice goes.
    await page.getByTestId('crm-wizard-service-preview-failed').getByRole('button', { name: 'Try again' }).click()
    await readyPreview(page)
    await expect(page.getByTestId('crm-wizard-service-preview-failed')).toHaveCount(0)
    expect((await previewTexts(page))[0]).toContain('Portale clienti')
    expect(dialogs).toBe(0)
    await context.close()
  })

  test('the service is down when the preview is first asked: no pages yet, the notice says so, the placeholder is empty, and Try again works (AC-10.7)', async ({
    browser,
  }) => {
    const deal = await dealWith('welld_ch', 'never-up', minimal)
    const context = await contextFor(browser, admin)
    const page = await context.newPage()

    await relay.down()
    try {
      await page.goto(wizardUrl(deal, 'scope'))
      await expect(page.getByLabel(SUBJECT_LABEL)).toBeVisible({ timeout: 30_000 })
      const notice = page.getByTestId('crm-wizard-service-preview-failed')
      await expect(notice).toBeVisible({ timeout: 30_000 })
      // No pages to keep: the sentence that is true here, an A4 placeholder with no text, and still not a blank pane.
      await expect(notice).toContainText('There is no preview yet. You can keep working; the draft is still saved.')
      await expect(notice).not.toContainText('last successful preview')
      await expect(pageImages(page)).toHaveCount(0)
      await expect(page.getByTestId('page-preview-placeholder')).toBeVisible()
      await expect(page.getByTestId('page-preview-placeholder')).toHaveAttribute('aria-hidden', 'true')
      await expect(page.getByRole('dialog')).toHaveCount(0)

      // The wizard works all the same.
      const subject = page.getByLabel(SUBJECT_LABEL)
      expect(await savedBy(page, () => subject.fill('Senza servizio'))).toBe(200)
      expect((await getDraftViaApi(admin, deal.id))!.answers.fields['OGGETTO']).toBe('Senza servizio')
    } finally {
      await relay.up()
    }

    await page.getByTestId('crm-wizard-service-preview-failed').getByRole('button', { name: 'Try again' }).click()
    await readyPreview(page)
    expect((await previewTexts(page))[0]).toContain('Senza servizio')
    await expect(page.getByTestId('crm-wizard-service-preview-failed')).toHaveCount(0)
    await context.close()
  })

  test('Generate goes through the service: the stored PDF has the preview\'s pages, their count and their text (AC-10.3)', async ({
    browser,
  }) => {
    const deal = await dealWith('welld_ch', 'generate', long)
    const context = await contextFor(browser, admin)
    const page = await context.newPage()
    await page.goto(wizardUrl(deal, 'scope'))
    await readyPreview(page)

    // Blocked while a value is missing (the wizard's rule); filled in, the preview follows, and Generate is offered.
    const saved = savedBy(page, () => page.getByLabel(SUBJECT_LABEL).fill('Portale clienti'))
    await expect(preview(page).locator('figure figcaption').first()).toContainText('Portale clienti', { timeout: 15_000 })
    expect(await saved).toBe(200)
    await readyPreview(page)
    await stepTab(page, 'Preview').click()
    await expect(page.getByText('Nothing is missing. You can generate the offer.')).toBeVisible()
    await readyPreview(page)
    const shownCount = await pageImages(page).count()
    const shown = await previewTexts(page)
    expect(shownCount).toBeGreaterThanOrEqual(3)

    await generateButton(page).click()
    await expect(page).toHaveURL(new RegExp(`/crm/deals/${deal.id}/?$`), { timeout: 90_000 })
    await expect(page.getByText(/Offer \S+ generated\./)).toBeVisible({ timeout: 30_000 })

    const offers = await listOffersViaApi(admin, deal.id)
    expect(offers).toHaveLength(1)
    const offer = offers[0]!
    expect(offer.origin).toBe('wizard')
    expect(await getDraftViaApi(admin, deal.id)).toBeNull()
    generatedNumber = sequenceOf(offer.reference)

    // The stored PDF IS the pages that were shown: the same count, and the text of each page. The one thing the preview
    // cannot know is the reference the offer gets when it is generated (it shows the pending mark), so it is put in.
    const stored = await offerPdfPages(admin, deal.id, offer.id)
    expect(stored.length, 'the stored PDF has as many pages as the preview showed').toBe(shownCount)
    const expected = shown.map((text) => squash(text.replace('NNNN/AAAA', offer.reference)))
    stored.forEach((text, index) => {
      expect(squash(text), `page ${index + 1} of the stored PDF reads as the page of the preview`).toBe(expected[index])
      expect(text, `page ${index + 1} of the PDF has its own number`).toContain(`${index + 1} / ${shownCount}`)
    })
    expect(stored.join(' ')).not.toContain(SUBJECT_LABEL) // a missing field is never in a generated PDF

    await context.close()
  })

  test('Generate with the service unreachable creates nothing and uses no offer number; the draft is as it was; Retry once it is back (AC-10.6)', async ({
    browser,
  }) => {
    const deal = await dealWith('welld_ch', 'generate-down', minimal)
    const filled = await setFieldViaApi(admin, deal.id, (await getDraftViaApi(admin, deal.id))!, 'OGGETTO', 'Portale clienti')
    const context = await contextFor(browser, admin)
    const page = await context.newPage()
    await page.goto(wizardUrl(deal, 'preview'))
    await readyPreview(page)
    await expect(page.getByText('Nothing is missing. You can generate the offer.')).toBeVisible()

    await relay.down()
    try {
      await generateButton(page).click()
      const failure = page.getByTestId('crm-offer-wizard-failure')
      await expect(failure).toBeVisible({ timeout: 60_000 })
      await expect(failure).toContainText('The layout service is not available')
      await expect(failure).toContainText('Nothing was created: no offer number was used and the draft is unchanged.')
      expect(await listOffersViaApi(admin, deal.id)).toHaveLength(0)
      const after = (await getDraftViaApi(admin, deal.id))!
      expect(after.version).toBe(filled.version)
      expect(after.answers.fields['OGGETTO']).toBe('Portale clienti')
      await expect(page).toHaveURL(/\/offer/)
    } finally {
      await relay.up()
    }

    // Back up: the failure's own Retry generates, and the offer takes the NEXT number: the failed try used none.
    await page.getByTestId('crm-offer-wizard-failure').getByRole('button', { name: 'Retry' }).click()
    await expect(page).toHaveURL(new RegExp(`/crm/deals/${deal.id}/?$`), { timeout: 90_000 })
    const offers = await listOffersViaApi(admin, deal.id)
    expect(offers).toHaveLength(1)
    if (generatedNumber > 0) expect(sequenceOf(offers[0]!.reference)).toBe(generatedNumber + 1)
    await context.close()
  })

  test('an entity with no active letterhead: the preview and Generate say so; the link to Letterheads only for a holder of access; no PDF (AC-10.8)', async ({
    browser,
  }) => {
    test.skip(
      !unconfigured.value,
      'the service already has an active letterhead for welld_it (versions are never deleted): this journey needs a service database in which welld_it has none',
    )
    const deal = await dealWith('welld_it', 'no-letterhead', minimalIt)
    const draft = (await getDraftViaApi(admin, deal.id))!
    await setFieldViaApi(admin, deal.id, draft, 'OGGETTO', 'Portale clienti')

    // A holder of access to Letterheads (the administrator): the notice, the empty placeholder, and the link.
    const adminContext = await contextFor(browser, admin)
    const adminPage = await adminContext.newPage()
    await adminPage.goto(wizardUrl(deal, 'scope'))
    const notice = adminPage.getByTestId('crm-wizard-letterhead-not-configured')
    await expect(notice).toBeVisible({ timeout: 30_000 })
    await expect(notice).toContainText('No letterhead is set for wellD IT')
    await expect(notice).toContainText('The preview and the PDF need one.')
    await expect(pageImages(adminPage)).toHaveCount(0)
    await expect(adminPage.getByTestId('page-preview-placeholder')).toBeVisible()
    await expect(adminPage.getByRole('dialog')).toHaveCount(0)
    const link = notice.getByRole('link', { name: 'Open Letterheads' })
    await expect(link).toHaveAttribute('href', '/letterheads?entity=welld_it')

    // Generate is refused with the same words and the same rule: nothing is created, no PDF.
    await stepTab(adminPage, 'Preview').click()
    await expect(adminPage.getByText('Nothing is missing. You can generate the offer.')).toBeVisible()
    await generateButton(adminPage).click()
    const refused = adminPage.getByTestId('crm-offer-wizard-failure').or(adminPage.getByRole('alert').filter({ hasText: 'No offer was created' }))
    await expect(refused.first()).toBeVisible({ timeout: 60_000 })
    await expect(adminPage.getByText('No offer was created').first()).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Open Letterheads' }).first()).toBeVisible()
    expect(await listOffersViaApi(admin, deal.id)).toHaveLength(0)
    expect((await getDraftViaApi(admin, deal.id))!.answers.fields['OGGETTO']).toBe('Portale clienti')

    // The link goes to the configurator, on that entity.
    await stepTab(adminPage, 'Scope').click()
    await adminPage.getByTestId('crm-wizard-letterhead-not-configured').getByRole('link', { name: 'Open Letterheads' }).click()
    await expect(adminPage).toHaveURL(/\/letterheads\?entity=welld_it/, { timeout: 30_000 })
    await expect(adminPage.getByRole('heading', { name: 'Letterheads', level: 1 })).toBeVisible({ timeout: 30_000 })
    await adminContext.close()

    // A seller of that entity who has no access to Letterheads: the same notice, told to ask an administrator, no link.
    const sellerContext = await contextFor(browser, seller)
    const sellerPage = await sellerContext.newPage()
    await sellerPage.goto(wizardUrl(deal, 'scope'))
    const sellerNotice = sellerPage.getByTestId('crm-wizard-letterhead-not-configured')
    await expect(sellerNotice).toBeVisible({ timeout: 30_000 })
    await expect(sellerNotice).toContainText('No letterhead is set for wellD IT')
    await expect(sellerNotice).toContainText('Ask an administrator to set it up in Letterheads.')
    await expect(sellerPage.getByRole('link', { name: 'Open Letterheads' })).toHaveCount(0)
    await expect(sellerPage.getByRole('dialog')).toHaveCount(0)
    await sellerContext.close()
  })

  test('Try the wizard in the template editor draws the service\'s pages for the text as typed, for a saved template and for one never saved (the id-less route), with no approximate preview and no note (AC-10.14)', async ({
    browser,
  }) => {
    const context = await contextFor(browser, admin)
    const page = await context.newPage()
    const tries: { url: string; body: { content?: { source?: string }; entity?: string } }[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/try-preview')) {
        tries.push({ url: request.url(), body: request.postDataJSON() })
      }
    })

    // The saved template, tried as saved: the service's pages, the sample answers, no deal.
    await page.goto(`/crm/settings/templates/${minimal.id}`)
    await expect(page.getByTestId('crm-template-page')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('tab', { name: 'Try the wizard' }).click()
    await expect(page.getByTestId('crm-template-try-banner')).toContainText('Nothing is saved')
    await readyPreview(page)
    expect(tries.length).toBeGreaterThan(0)
    expect(tries[0]!.url).toContain(`/offer-templates/${minimal.id}/try-preview`)
    expect(tries[0]!.body.entity).toBe('welld_ch')
    const count = await pageImages(page).count()
    expect(count).toBeGreaterThanOrEqual(1)
    const texts = await previewTexts(page)
    expect(texts[0]).toContain('Dear client.')
    expect(texts[0]).toContain(`1 / ${count}`)
    await expect(page.getByTestId('crm-template-try-preview-note')).toHaveCount(0)
    for (const old of ['crm-wizard-page', 'crm-wizard-letterhead-band']) await expect(page.getByTestId(old)).toHaveCount(0)

    // The text edited and NOT saved: the pages follow the text as typed (what the service is asked is the typed text).
    await page.getByRole('tab', { name: 'Edit', exact: true }).click()
    const marker = `Prova del testo digitato ${runId}`
    await page.getByTestId('crm-template-text').fill(MINIMAL_TEMPLATE_SOURCE.replace('Dear client.', marker))
    await expect(page.getByText('No problems')).toBeVisible({ timeout: 15_000 })
    tries.length = 0
    await page.getByRole('tab', { name: 'Try the wizard' }).click()
    await expect(preview(page).locator('figure figcaption').first()).toContainText(marker, { timeout: 30_000 })
    await readyPreview(page)
    expect(tries.at(-1)!.body.content?.source).toContain(marker)
    const stored = await crmCall<{ source: string }>(admin, 'GET', `/offer-templates/${minimal.id}`)
    expect(stored.body.source, 'what was typed was not saved').not.toContain(marker)

    // A template that was never saved has no id: the service is asked at the id-less route, with the text as typed and the
    // entity it will belong to, and draws the pages as for a saved one. No approximate preview, no note, nothing stored.
    tries.length = 0
    const neverSavedName = `E2E never saved ${runId}`
    const neverSaved = `Testo mai salvato ${runId}`
    await page.goto('/crm/settings/templates/new/welld_ch')
    await expect(page.getByTestId('crm-template-page')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('crm-template-name').getByRole('textbox').fill(neverSavedName)
    await page.getByTestId('crm-template-text').fill(MINIMAL_TEMPLATE_SOURCE.replace('Dear client.', neverSaved))
    await expect(page.getByText('No problems')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('tab', { name: 'Try the wizard' }).click()
    await expect(preview(page).locator('figure figcaption').first()).toContainText(neverSaved, { timeout: 30_000 })
    await readyPreview(page)
    expect(tries.length).toBeGreaterThan(0)
    for (const tried of tries) expect(new URL(tried.url).pathname, 'the id-less route, not a saved template\'s').toBe('/offer-templates/try-preview')
    expect(tries.at(-1)!.body.entity).toBe('welld_ch')
    expect(tries.at(-1)!.body.content?.source).toContain(neverSaved)
    const unsavedCount = await pageImages(page).count()
    expect(unsavedCount).toBeGreaterThanOrEqual(1)
    const unsavedTexts = await previewTexts(page)
    expect(unsavedTexts[0]).toContain(neverSaved)
    expect(unsavedTexts[0], 'the PDF\'s own "N / M"').toContain(`1 / ${unsavedCount}`)
    await expect(page.getByTestId('crm-template-try-preview-note')).toHaveCount(0)
    for (const old of ['crm-wizard-page', 'crm-wizard-letterhead-band']) await expect(page.getByTestId(old)).toHaveCount(0)
    // nothing was stored by asking: the name is still free and no template carries the text
    expect(await templateNamesOf(admin, 'welld_ch')).not.toContain(neverSavedName)

    await context.close()
  })

  test('a person who reads templates (deal:financials, no deal:manage) tries the wizard and gets the service\'s pages, and can write nothing (AC-10.14)', async ({
    browser,
  }) => {
    const context = await contextFor(browser, reader)
    const page = await context.newPage()
    const tries: { url: string; status: number; body: { content?: { source?: string }; entity?: string } }[] = []
    page.on('response', (response) => {
      const request = response.request()
      if (request.method() === 'POST' && request.url().includes('/try-preview')) {
        tries.push({ url: request.url(), status: response.status(), body: request.postDataJSON() })
      }
    })
    const pathOf = (url: string): string => new URL(url).pathname

    // The editor opens read-only: the banner says so and nothing offers to save.
    await page.goto(`/crm/settings/templates/${minimal.id}`)
    await expect(page.getByTestId('crm-template-page')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('You can read this template but not change it')).toBeVisible()
    await expect(page.getByTestId('crm-template-save')).toHaveCount(0)

    // Try the wizard, on a saved template: the service's pages through the id route, which the read guard lets through.
    await page.getByRole('tab', { name: 'Try the wizard' }).click()
    await readyPreview(page)
    expect(tries.length).toBeGreaterThan(0)
    expect(pathOf(tries[0]!.url)).toBe(`/offer-templates/${minimal.id}/try-preview`)
    expect(tries.map((tried) => tried.status)).toEqual(tries.map(() => 200))
    const count = await pageImages(page).count()
    expect(count).toBeGreaterThanOrEqual(1)
    const texts = await previewTexts(page)
    expect(texts[0]).toContain('Dear client.')
    expect(texts[0]).toContain(`1 / ${count}`)
    await expect(page.getByTestId('crm-template-try-preview-note')).toHaveCount(0)
    await expect(page.getByTestId('crm-wizard-service-preview-failed')).toHaveCount(0)
    for (const old of ['crm-wizard-page', 'crm-wizard-letterhead-band']) await expect(page.getByTestId(old)).toHaveCount(0)

    // A template never saved: the same, through the id-less route. The editor offers a reader no way to type one (the text is
    // read-only, a blank template has errors), so the request is the editor's own, as sent for the saved template above, with
    // a name no template holds. The read guard lets it through, and it stores nothing.
    const sent = tries[0]!.body as { content: Record<string, unknown> }
    const unsavedBody = { ...sent, content: { ...sent.content, name: `E2E reader never saved ${runId}` } }
    const asked = await crmCall<{ pages: unknown[] }>(reader, 'POST', '/offer-templates/try-preview', unsavedBody)
    expect(asked.status).toBe(200)
    expect(asked.body.pages.length).toBeGreaterThanOrEqual(1)
    expect(await templateNamesOf(admin, 'welld_ch')).not.toContain(`E2E reader never saved ${runId}`)
    const stored = await crmCall<TemplateRow>(reader, 'GET', `/offer-templates/${minimal.id}`)
    expect(stored.status).toBe(200)
    const writes = [
      await crmCall(reader, 'POST', '/offer-templates', { entity: 'welld_ch', name: `E2E reader write ${runId}`, language: 'it', description: '', uses: [], source: MINIMAL_TEMPLATE_SOURCE }),
      await crmCall(reader, 'PUT', `/offer-templates/${minimal.id}`, { entity: 'welld_ch', name: stored.body.name, language: 'it', description: '', uses: [], source: MINIMAL_TEMPLATE_SOURCE }, { 'If-Match': `"${stored.body.version}"` }),
      await crmCall(reader, 'POST', `/offer-templates/${minimal.id}/archive`, undefined, { 'If-Match': `"${stored.body.version}"` }),
      await crmCall(reader, 'POST', `/offer-templates/${minimal.id}/duplicate`),
    ]
    expect(writes.map((write) => write.status), 'create, replace, archive, duplicate: all refused').toEqual([403, 403, 403, 403])
    const after = await crmCall<TemplateRow>(admin, 'GET', `/offer-templates/${minimal.id}`)
    expect(after.body.version, 'the template is as it was').toBe(stored.body.version)
    expect(await templateNamesOf(admin, 'welld_ch')).not.toContain(`E2E reader write ${runId}`)

    await context.close()
  })
})
