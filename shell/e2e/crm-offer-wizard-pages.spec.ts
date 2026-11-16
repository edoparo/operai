/**
 * specs/20261115-crm-offer-wizard T75 — the preview as real A4 pages, through the REAL assembled shell and crm-ui against
 * the REAL crm-api, auth and activities-api (OA-3, M-4).
 *
 *   AC-11.1  the letterhead is the background of EVERY page, decorative, behind real text (found, selectable)
 *   AC-11.2  A4 pages stacked with a gap of at least 16 px, the caption "shown on every page"
 *   AC-11.4  pending / failed / unusable (409 letterhead_unusable): nothing drawn, same pages, same breaks, soft failure;
 *            the unusable band and the reason Generate is blocked; a generation answered 409 is told and creates nothing
 *   AC-11.5  every page and its letterhead stay light and the same in the dark theme; the page edge follows the theme
 *   AC-11.6  the Drawer shows the same text on the same kind of pages and asks for the letterhead only once
 *   AC-11.10 the frame: no line, cell or word of the offer in any margin, in any gap or outside its page
 *   AC-11.11 what a break guarantees: no word split, no line cut, no table row split, a heading never last on a page in the
 *            wide pane, no widow or orphan, annexes at the top of a page, no blank page; the delegated readings
 *   AC-11.12 a sentence a break splits is found by the browser's search and copied whole; one labelled, scrollable
 *            region with no Tab stop on a page; the pages say nothing to assistive technology
 *
 * The measurements are the in-page script T74 used by hand (helpers/previewPages.ts), run in Chromium against a LONG offer
 * made through crm-api: the seeded "Progetto a corpo con SLA" (tables, two annexes) with every field answered at length,
 * one unbreakable word and a hand-edited section. The failure states are produced by intercepting the browser's requests;
 * the owner's entity profile is never written (the letterhead is made absent or unusable on the wire only).
 *
 * Prerequisites: those of crm-offer-wizard.spec.ts (crm-api on this branch's code with its migration applied, auth with
 * ENABLE_TEST_AUTH, file storage, the shell and crm-ui served).
 *
 * run:  cd shell && E2E_CRM_REMOTE_PORT=5179 E2E_MEETINGS_REMOTE_PORT=5180 E2E_PROJECTS_REMOTE_PORT=5181 \
 *         pnpm e2e crm-offer-wizard-pages.spec.ts
 *
 * Offers: only the journeys that never generate run on the long deal; the 409 journey generates nothing (the answer is
 * intercepted) and the "works again" step generates one offer of a minimal template, the spec's only number spent.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  SUBJECT_LABEL,
  archiveTemplateViaApi,
  createDealPastEstimateGate,
  createDraftViaApi,
  createLongDraftViaApi,
  createMinimalTemplateViaApi,
  discardDraftViaApi,
  ensureEntityProfile,
  ensureLetterhead,
  findSeededTemplateNamed,
  getEntityProfile,
  listOffersViaApi,
  newRunId,
  offerAdmin,
  setFieldViaApi,
  signInContext,
  type DealRow,
  type SeededSession,
  type TemplateRow,
} from './helpers/crmOfferFixtures'
import { flowText, measurePages, scrollToPage, searchAcrossBreaks } from './helpers/previewPages'

const runId = newRunId()

test.describe.configure({ mode: 'serial' })

/** The wide layout (xl, 1280 px and up) shows the preview inline; below it the preview is a Drawer. */
const WIDE = { width: 1440, height: 900 }
/** One Drawer width: below xl, the preview opens in a Drawer from the action bar's Preview button. */
const DRAWER = { width: 1024, height: 800 }

const letterheadLinkPath = /\/entity-profiles\/welld_ch\/letterhead$/
const isLetterheadLinkRead = (request: { url: () => string; method: () => string }): boolean =>
  request.method() === 'GET' && letterheadLinkPath.test(new URL(request.url()).pathname)

const SHOWN_CAPTION = 'The letterhead is shown on every page. Page breaks are approximate: the PDF is the authority.'

const dealUrl = (deal: DealRow): string => `/crm/deals/${deal.id}`
const wizardUrl = (deal: DealRow, step: string): string => `${dealUrl(deal)}/offer?step=${step}`

const stepTab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) })
const band = (page: Page) => page.getByTestId('crm-wizard-letterhead-band')
const stage = (page: Page) => page.getByTestId('crm-wizard-stage')
const pageBoxes = (page: Page) => page.getByTestId('crm-wizard-page')
const letterheadImages = (page: Page) => page.getByTestId('crm-wizard-letterhead')

async function contextFor(
  browser: Browser,
  session: SeededSession,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<BrowserContext> {
  const context = await browser.newContext(options)
  await signInContext(context, session)
  return context
}

/**
 * Waits until the pages are laid out and stay so: the layout counter of the stage is unchanged over 600 ms and the page
 * count is what the offer needs (AC-3.1: the pages are laid out again within a second of a change).
 */
async function layoutSettled(page: Page, minPages = 1): Promise<number> {
  await expect(stage(page)).toBeVisible({ timeout: 30_000 })
  let last = ''
  await expect
    .poll(
      async () => {
        const now = `${await stage(page).getAttribute('data-layout')}/${await stage(page).getAttribute('data-pages')}`
        const same = now === last
        last = now
        await page.waitForTimeout(600)
        return same && Number(await stage(page).getAttribute('data-pages')) >= minPages
      },
      { timeout: 30_000, intervals: [0] },
    )
    .toBe(true)
  return Number(await stage(page).getAttribute('data-pages'))
}

/**
 * A picture of `clip` taken only once the page has stopped changing under it (AC-11.5, eval H1). The first version took
 * one screenshot right after `scrollTop +=` and compared two such pictures byte for byte; under load it failed once in
 * about ten runs, because three things can still be in flight when `img.complete` is true and the layout counter is
 * quiet: the web fonts, the decode/raster of the 1600 px letterhead PNGs, and the scroll position itself. So: fonts ready,
 * every letterhead decoded, two frames, then two pictures in a row that are the same bytes (the render has settled) -
 * the last one is returned. A page that never settles fails here, naming that, instead of as a spurious theme difference.
 */
async function stableShot(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(
      Array.from(document.querySelectorAll<HTMLImageElement>('[data-testid=crm-wizard-letterhead]')).map((img) =>
        img.decode().catch(() => undefined),
      ),
    )
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
  })
  let previous: Buffer | undefined
  let current: Buffer | undefined
  await expect
    .poll(
      async () => {
        current = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
        const same = previous !== undefined && previous.equals(current)
        previous = current
        return same
      },
      { message: 'the preview page stops changing before it is compared', timeout: 20_000, intervals: [100, 250, 500] },
    )
    .toBe(true)
  return current!
}

/** The pictures are compared in blocks of this many pixels square, each block as its mean colour. */
const BLOCK_PX = 6
/**
 * A block whose mean colour differs by more than this in any channel is a visible difference. A glyph's anti-aliasing
 * (grayscale against LCD, a sub-pixel shift under load: found by the eval H1 loop, 1 run in 7 to 14, about 1 900 pixels of
 * the page's text, the two pictures visibly identical) moves a block's mean by a few levels at most; light paper against
 * dark paper, an inverted, dimmed or tinted letterhead moves it by tens or hundreds.
 */
const VISIBLE_BLOCK_DIFFERENCE = 12

/**
 * How many blocks of two PNG pictures differ visibly (see VISIBLE_BLOCK_DIFFERENCE), and the largest block difference,
 * decoded in a browser page - there is no image library in this package. Replaces the byte-exact comparison: byte
 * equality proved "the same pixels", which is more than "the same page in both themes" and failed on text anti-aliasing.
 */
async function pixelDifference(
  page: Page,
  a: Buffer,
  b: Buffer,
): Promise<{ sameSize: boolean; total: number; differing: number; worst: number; box: string }> {
  return page.evaluate(
    async ({ a64, b64, block, limit }) => {
      const load = async (b64png: string) => {
        const image = new Image()
        image.src = `data:image/png;base64,${b64png}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, canvas.width, canvas.height)
      }
      const [x, y] = await Promise.all([load(a64), load(b64)])
      if (x.width !== y.width || x.height !== y.height) {
        return { sameSize: false, total: 0, differing: 0, worst: 0, box: '' }
      }
      let differing = 0
      let worst = 0
      let total = 0
      let [x0, y0, x1, y1] = [x.width, x.height, -1, -1]
      for (let by = 0; by < x.height; by += block) {
        for (let bx = 0; bx < x.width; bx += block) {
          const sums = [0, 0, 0, 0, 0, 0]
          let n = 0
          for (let py = by; py < Math.min(by + block, x.height); py++) {
            for (let px = bx; px < Math.min(bx + block, x.width); px++) {
              const i = (py * x.width + px) * 4
              for (let c = 0; c < 3; c++) {
                sums[c] += x.data[i + c]!
                sums[c + 3] += y.data[i + c]!
              }
              n++
            }
          }
          const d = Math.max(...[0, 1, 2].map((c) => Math.abs(sums[c]! - sums[c + 3]!) / n))
          total++
          worst = Math.max(worst, d)
          if (d > limit) {
            differing++
            ;[x0, y0, x1, y1] = [Math.min(x0, bx), Math.min(y0, by), Math.max(x1, bx), Math.max(y1, by)]
          }
        }
      }
      return { sameSize: true, total, differing, worst, box: `x ${x0}-${x1}, y ${y0}-${y1}` }
    },
    { a64: a.toString('base64'), b64: b.toString('base64'), block: BLOCK_PX, limit: VISIBLE_BLOCK_DIFFERENCE },
  )
}

/** `rgb(r, g, b)` / `rgba(r, g, b, a)` -> [r, g, b]. */
function channels(color: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(color)
  if (!match) throw new Error(`not an rgb colour: ${color}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
const luminance = (color: string): number => {
  const [r, g, b] = channels(color).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** What each page and its letterhead look like to the browser (colours, and every layer between image and page). */
async function pagesLook(page: Page) {
  return page.evaluate(() => {
    const stageEl = document.querySelector('[data-testid="crm-wizard-stage"]') as HTMLElement
    const own = (el: HTMLElement) => {
      const style = getComputedStyle(el)
      return { filter: style.filter, opacity: style.opacity, blend: style.mixBlendMode, backdrop: style.backdropFilter }
    }
    const pages = Array.from(document.querySelectorAll('[data-testid="crm-wizard-page"]')) as HTMLElement[]
    return {
      body: getComputedStyle(document.body).backgroundColor,
      stage: getComputedStyle(stageEl).backgroundColor,
      pages: pages.map((pageEl) => {
        const style = getComputedStyle(pageEl)
        const image = pageEl.querySelector('[data-testid="crm-wizard-letterhead"]') as HTMLElement | null
        const chain: ReturnType<typeof own>[] = []
        for (let el: HTMLElement | null = image; el && el !== stageEl; el = el.parentElement) chain.push(own(el))
        return { paper: style.backgroundColor, edge: style.borderTopColor, edgeWidth: style.borderTopWidth, chain }
      }),
      ink: getComputedStyle(document.querySelector('[data-testid="crm-wizard-flow"]') as HTMLElement).color,
    }
  })
}

test.describe('specs/20261115-crm-offer-wizard T75: the preview as real A4 pages', () => {
  let admin: SeededSession
  let issuerName: string
  let sla: TemplateRow
  let minimal: TemplateRow
  let longDeal: DealRow
  const deals: DealRow[] = []

  /** A deal with a fresh draft of the minimal template and its subject answered: nothing is missing. */
  async function completeMinimalDeal(label: string): Promise<DealRow> {
    const deal = await createDealPastEstimateGate(admin, label, runId)
    deals.push(deal)
    const draft = await createDraftViaApi(admin, deal.id, minimal.id)
    await setFieldViaApi(admin, deal.id, draft, 'OGGETTO', 'Portale clienti')
    return deal
  }

  test.beforeAll(async () => {
    admin = await offerAdmin()
    await ensureEntityProfile(admin) // writes only when the entity has no profile (the fixtures' existing contract)
    await ensureLetterhead(admin) // ... and only when it has no letterhead; an existing one is used as it is
    const profile = await getEntityProfile(admin)
    issuerName = (profile.legalName ?? '').trim()
    expect(issuerName, 'welld_ch has a legal name').not.toBe('')
    expect(profile.letterhead, 'welld_ch has a letterhead').toBeTruthy()
    minimal = await createMinimalTemplateViaApi(admin, `E2E pages ${runId}`)
    sla = await findSeededTemplateNamed(admin, 'Progetto a corpo con SLA')
    longDeal = await createDealPastEstimateGate(admin, 'pages-long', runId)
    deals.push(longDeal)
    await createLongDraftViaApi(admin, longDeal.id, sla.id)
  })

  test.afterAll(async () => {
    if (!admin) return
    for (const deal of deals) await discardDraftViaApi(admin, deal.id)
    if (minimal) await archiveTemplateViaApi(admin, minimal.id)
  })

  test('the preview is real A4 pages with the letterhead on every one, behind real text, fetched once (AC-11.1, AC-11.2, AC-11.8)', async ({
    browser,
  }) => {
    const context = await contextFor(browser, admin, { viewport: WIDE })
    const page = await context.newPage()
    let linkReads = 0
    page.on('request', (request) => {
      if (isLetterheadLinkRead(request)) linkReads++
    })

    await page.goto(wizardUrl(longDeal, 'scope'))
    await expect(band(page)).toHaveAttribute('data-state', 'shown', { timeout: 30_000 })
    await expect(band(page)).toHaveText(SHOWN_CAPTION)
    const pages = await layoutSettled(page, 4)
    expect(await pageBoxes(page).count()).toBe(pages)

    // Real A4 pages: one width, A4 proportions, a gap of at least 16 px between neighbours, none overlapping.
    const boxes = await pageBoxes(page).evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }),
    )
    for (const box of boxes) {
      expect(Math.abs(box.width - boxes[0]!.width)).toBeLessThan(0.5)
      expect(box.height / box.width).toBeCloseTo(297 / 210, 2)
    }
    for (let i = 1; i < boxes.length; i++) {
      const gap = boxes[i]!.y - (boxes[i - 1]!.y + boxes[i - 1]!.height)
      expect(gap, `gap before page ${i + 1}`).toBeGreaterThanOrEqual(16)
    }

    // The same letterhead on EVERY page, whole, decorative and unselectable; one image per page, one source.
    await expect(letterheadImages(page)).toHaveCount(pages)
    const images = await letterheadImages(page).evaluateAll((els) =>
      els.map((el) => {
        const image = el as HTMLImageElement
        const parent = image.parentElement!.getBoundingClientRect()
        const own = image.getBoundingClientRect()
        return {
          tag: image.tagName,
          src: image.src,
          alt: image.getAttribute('alt'),
          hidden: image.getAttribute('aria-hidden'),
          natural: image.naturalWidth,
          select: getComputedStyle(image).userSelect,
          fills: Math.abs(own.width - parent.width) < 3 && Math.abs(own.height - parent.height) < 3,
        }
      }),
    )
    expect(images).toHaveLength(pages)
    for (const image of images) {
      expect(image).toMatchObject({ tag: 'IMG', alt: '', hidden: 'true', select: 'none', fills: true })
      expect(image.src).toMatch(/^blob:/)
      expect(image.natural).toBeGreaterThan(0)
      expect(image.src).toBe(images[0]!.src)
    }

    // The text stays real text above the pages: found by the page, selectable, and the pointer reaches it, not the image.
    const flow = page.getByTestId('crm-wizard-flow')
    await expect(flow).toContainText('Il presente contratto viene stipulato tra')
    const reached = await flow.evaluate((el) => {
      const first = el.querySelector('[data-flow=text]') as HTMLElement
      const box = first.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + 4, box.top + box.height / 2)
      return {
        selectable: getComputedStyle(first).userSelect !== 'none',
        notTheLetterhead: hit?.closest('[data-testid="crm-wizard-letterhead"]') === null,
        inFlow: !!hit && el.contains(hit),
      }
    })
    expect(reached).toEqual({ selectable: true, notTheLetterhead: true, inFlow: true })

    // The hand-edited section keeps its mark as real text on the pages (AC-11.1).
    await expect(flow).toContainText('CONDIZIONI MODIFICATE A MANO')
    await expect(flow).toContainText('Paragrafo 14, parte 3.')

    // Moving between steps never asks for the letterhead again; the band stays as it is.
    for (const name of ['Costs', 'Preview', 'Scope']) await stepTab(page, name).click()
    await expect(band(page)).toHaveAttribute('data-state', 'shown')
    expect(linkReads).toBe(1)

    await context.close()
  })

  test("each page prints its own N/M as the PDF does and covers the letterhead's own number (D-2, owner 2026-11-15)", async ({
    browser,
  }) => {
    const context = await contextFor(browser, admin, { viewport: WIDE })
    const page = await context.newPage()
    await page.goto(wizardUrl(longDeal, 'scope'))
    await expect(band(page)).toHaveAttribute('data-state', 'shown', { timeout: 30_000 })
    const pages = await layoutSettled(page, 4)
    await expect(letterheadImages(page)).toHaveCount(pages)
    await expect
      .poll(() => letterheadImages(page).evaluateAll((els) => els.every((el) => (el as HTMLImageElement).complete)))
      .toBe(true)

    // Every page: its own "N/M" inside the aria-hidden inert layer, right-aligned at the PDF's right end, its baseline
    // where the PDF's is (NUMBER_RIGHT_INSET 72 pt, NUMBER_BASELINE 35.5 pt, from the page's edges at the page's scale).
    const labels = await page.evaluate(() => {
      const layer = document.querySelector('[data-testid="crm-wizard-pages"]') as HTMLElement
      return Array.from(layer.querySelectorAll('[data-testid="crm-wizard-page"]')).map((box) => {
        const number = box.querySelector('[data-testid="crm-wizard-page-number"]') as HTMLElement
        const r = box.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(number)
        const text = range.getBoundingClientRect()
        const scale = r.width / 595.28
        return {
          text: number.textContent,
          inLayer: layer.contains(number) && layer.getAttribute('aria-hidden') === 'true' && layer.hasAttribute('inert'),
          rightGap: (r.right - text.right) / scale,
          size: parseFloat(getComputedStyle(number).fontSize) / scale,
          color: getComputedStyle(number).color,
        }
      })
    })
    expect(labels.map((l) => l.text)).toEqual(Array.from({ length: pages }, (_, i) => `${i + 1}/${pages}`))
    const paperSoft = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.className = 'text-paper-soft'
      document.body.appendChild(probe)
      const colour = getComputedStyle(probe).color
      probe.remove()
      return colour
    })
    for (const label of labels) {
      expect(label.inLayer).toBe(true)
      expect(label.size).toBeCloseTo(8.5, 1)
      expect(label.rightGap).toBeGreaterThan(71)
      expect(label.rightGap).toBeLessThan(74.5)
      expect(label.color).toBe(paperSoft)
    }

    // The letterhead's own "1/1" is covered: in the corner (outside our own number) every pixel is white,
    // on every page; and the control, the cover hidden, finds the letterhead's ink there, so the check can fail.
    const white = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.className = 'bg-white'
      document.body.appendChild(probe)
      const colour = getComputedStyle(probe).backgroundColor
      probe.remove()
      return colour
    })
    const [pr, pg, pb] = channels(white)
    const inkInCorner = async (index: number): Promise<number> => {
      await page.evaluate((i) => {
        const cover = document.querySelectorAll('[data-testid=crm-wizard-page-number-cover]')[i] as HTMLElement
        const region = document.querySelector('[data-testid=crm-wizard-preview]') as HTMLElement
        const r = cover.getBoundingClientRect()
        region.scrollTop += r.bottom - region.getBoundingClientRect().bottom + 60
      }, index)
      const geometry = await page.evaluate((i) => {
        const cover = document.querySelectorAll('[data-testid=crm-wizard-page-number-cover]')[i] as HTMLElement
        const c = cover.getBoundingClientRect()
        return { cover: { x: c.x, y: c.y, width: c.width, height: c.height } }
      }, index)
      const shot = await page.screenshot({ clip: geometry.cover })
      return page.evaluate(
        async ({ base64, target }) => {
          const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob()
          const bitmap = await createImageBitmap(blob)
          const canvas = document.createElement('canvas')
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          const context = canvas.getContext('2d')!
          context.drawImage(bitmap, 0, 0)
          const data = context.getImageData(0, 0, canvas.width, canvas.height).data
          let ink = 0
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                            const at = (y * canvas.width + x) * 4
              const off = Math.abs(data[at]! - target[0]) + Math.abs(data[at + 1]! - target[1]) + Math.abs(data[at + 2]! - target[2])
              if (off > 12) ink++
            }
          }
          return ink
        },
        { base64: shot.toString('base64'), target: [pr, pg, pb] },
      )
    }
    // our own number is hidden while the corner is read, so what is left is the letterhead's own number or the cover over it
    await page.addStyleTag({ content: '[data-testid=crm-wizard-page-number]{visibility:hidden !important}' })
    for (const index of [0, 1, pages - 1]) {
      expect(await inkInCorner(index), `page ${index + 1}: the corner holds nothing but white`).toBe(0)
    }
    await page.addStyleTag({ content: '[data-testid=crm-wizard-page-number-cover]{visibility:hidden !important}' })
    expect(await inkInCorner(0), 'control: without the cover the letterhead\'s own number shows').toBeGreaterThan(20)

    await context.close()
  })

  test('every line, cell and word is inside its page frame and a break never cuts one (AC-11.10, AC-11.11, AC-11.13)', async ({
    browser,
  }) => {
    const context = await contextFor(browser, admin, { viewport: WIDE })
    const page = await context.newPage()
    await page.goto(wizardUrl(longDeal, 'scope'))
    await expect(band(page)).toHaveAttribute('data-state', 'shown', { timeout: 30_000 })
    await layoutSettled(page, 4)

    const m = await measurePages(page, { headingsNotLast: true })
    test.info().annotations.push({
      type: 'measured',
      description: `${m.pages} pages, ${m.headings} headings, ${m.splitBlocks.length} paragraphs split by a break, over-tall rows ${m.overTallRows.length}`,
    })

    // The subjects of the checks exist: several pages, headings, and paragraphs a break really splits.
    expect(m.pages).toBeGreaterThanOrEqual(4)
    expect(m.headings).toBeGreaterThan(3)
    expect(m.splitBlocks.length).toBeGreaterThan(0)

    // AC-11.10: nothing in a margin, a gap or outside its page; no word cut; no row split; no heading last; no widow.
    expect(m.violations).toEqual([])
    // AC-11.11: no page without a line; the gap is the same between every pair.
    expect(m.emptyPages).toEqual([])
    for (const gap of m.gaps) expect(gap).toBeGreaterThanOrEqual(16)
    // AC-11.13: the text is never smaller than 10 CSS px and nothing scrolls sideways.
    expect(m.minFont).toBeGreaterThanOrEqual(10 - 0.01)
    expect(m.regionOverflow.scrollWidth).toBeLessThanOrEqual(m.regionOverflow.clientWidth)
    expect(m.flowOverflow.scrollWidth).toBeLessThanOrEqual(m.flowOverflow.clientWidth)

    await context.close()
  })

  test("a sentence a break splits is found by the browser's search and copied whole; the pages say nothing to assistive technology (AC-11.12)", async ({
    browser,
  }) => {
    const context = await contextFor(browser, admin, { viewport: WIDE })
    const page = await context.newPage()
    await page.goto(wizardUrl(longDeal, 'scope'))
    await expect(band(page)).toHaveAttribute('data-state', 'shown', { timeout: 30_000 })
    await layoutSettled(page, 4)

    // Find-in-page and a selection over a break read back exactly the text: nothing added, nothing repeated.
    const search = await searchAcrossBreaks(page, 4)
    expect(search.failures).toEqual([])
    expect(search.wholeFlowDiff).toBe('')
    expect(search.tried).toBeGreaterThanOrEqual(2)
    expect(search).toMatchObject({
      found: search.tried,
      copied: search.tried,
      straddling: search.tried,
      wholeFlowEqual: true,
      railsEmpty: true,
    })

    // The page layer is hidden and inert; the preview is the one labelled region and adds no landmark, heading or stop.
    const region = page.getByRole('region', { name: 'Document preview' })
    await expect(region).toHaveCount(1)
    await expect(region).toHaveAttribute('tabindex', '0')
    const structure = await region.evaluate((el) => {
      const layer = el.querySelector('[data-testid="crm-wizard-pages"]') as HTMLElement
      return {
        layerHidden: layer.getAttribute('aria-hidden'),
        layerInert: layer.hasAttribute('inert'),
        stops: el.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex],[contenteditable]').length,
        landmarks: el.querySelectorAll('main,nav,aside,header,footer,[role=region],[role=navigation],[role=main]')
          .length,
        live: el.querySelectorAll('[aria-live]:not(.visually-hidden)').length,
        labelledPages: el.querySelectorAll(
          '[data-testid="crm-wizard-page"][aria-label],[data-testid="crm-wizard-page"][role]',
        ).length,
      }
    })
    expect(structure).toEqual({
      layerHidden: 'true',
      layerInert: true,
      stops: 0,
      landmarks: 0,
      live: 0,
      labelledPages: 0,
    })
    const snapshot = await region.ariaSnapshot()
    expect(snapshot).not.toMatch(/\bpage \d+\b/i)
    expect(snapshot).not.toMatch(/- img/)

    // Keyboard: the region takes focus, scrolls, and Tab leaves it at once (no stop on a page or a gap).
    await region.focus()
    const before = await region.evaluate((el) => el.scrollTop)
    await page.keyboard.press('PageDown')
    await expect.poll(() => region.evaluate((el) => el.scrollTop)).toBeGreaterThan(before)
    await page.keyboard.press('Tab')
    expect(await region.evaluate((el) => el.contains(document.activeElement))).toBe(false)

    await context.close()
  })

  test('a letterhead that is pending, failed or absent leaves the pages and their breaks exactly as when it is shown (AC-11.3, AC-11.4, AC-11.10)', async ({
    browser,
  }) => {
    // Pending: the link is held until the journey lets it go, so the pages are seen without it, then with it.
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const context = await contextFor(browser, admin, { viewport: WIDE })
    const page = await context.newPage()
    await page.route(letterheadLinkPath, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await gate
      return route.fallback()
    })
    await page.goto(wizardUrl(longDeal, 'scope'))
    await expect(band(page)).toHaveAttribute('data-state', 'pending', { timeout: 30_000 })
    await expect(band(page)).toContainText(`The letterhead of ${issuerName} is added in the PDF.`)
    await expect(band(page)).toContainText('Page breaks are approximate: the PDF is the authority.')
    const pendingPages = await layoutSettled(page, 4)
    await expect(letterheadImages(page)).toHaveCount(0)
    const pending = await measurePages(page, { headingsNotLast: true })
    expect(pending.violations).toEqual([])
    expect(await page.getByTestId('crm-wizard-flow').innerText()).toContain('Il presente contratto viene stipulato tra')

    release()
    await expect(band(page)).toHaveAttribute('data-state', 'shown', { timeout: 30_000 })
    await expect(letterheadImages(page)).toHaveCount(pendingPages)
    const shown = await measurePages(page, { headingsNotLast: true })
    // The letterhead arriving changes nothing but what is drawn behind the text: no text moves, no page break changes.
    expect(shown.pages).toBe(pending.pages)
    expect(shown.lineTops).toEqual(pending.lineTops)
    await context.close()

    // Failed: the link answers 500. Same pages, nothing behind them, no dialog; the text is there.
    const failedContext = await contextFor(browser, admin, { viewport: WIDE })
    const failedPage = await failedContext.newPage()
    let linkReads = 0
    await failedPage.route(letterheadLinkPath, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      linkReads++
      return route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ type: 'about:blank', title: 'Internal Server Error', status: 500 }),
      })
    })
    await failedPage.goto(wizardUrl(longDeal, 'scope'))
    await expect(band(failedPage)).toHaveAttribute('data-state', 'failed', { timeout: 30_000 })
    await expect(band(failedPage)).toContainText(
      `The letterhead of ${issuerName} could not be shown here. It is still added in the PDF.`,
    )
    await layoutSettled(failedPage, 4)
    await expect(letterheadImages(failedPage)).toHaveCount(0)
    await expect(failedPage.getByRole('dialog')).toHaveCount(0)
    await expect(failedPage.getByRole('alertdialog')).toHaveCount(0)
    const failed = await measurePages(failedPage, { headingsNotLast: true })
    expect(failed.violations).toEqual([])
    expect(failed.pages).toBe(shown.pages)
    expect(failed.lineTops).toEqual(shown.lineTops)
    expect(linkReads).toBe(1) // not retried in a loop
    await failedContext.close()

    // None: the entity has no letterhead (the context says so; the profile is not touched). Same frame, band says so.
    const noneContext = await contextFor(browser, admin, { viewport: WIDE })
    const nonePage = await noneContext.newPage()
    let noneLinkReads = 0
    nonePage.on('request', (request) => {
      if (isLetterheadLinkRead(request)) noneLinkReads++
    })
    await nonePage.route(/\/offer-wizard\/context$/, async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as Record<string, unknown>
      return route.fulfill({ response, json: { ...body, letterhead: false } })
    })
    await nonePage.goto(wizardUrl(longDeal, 'scope'))
    await expect(band(nonePage)).toHaveAttribute('data-state', 'none', { timeout: 30_000 })
    await expect(band(nonePage)).toContainText(
      `No letterhead is set for ${issuerName}: the PDF uses a plain header with the entity's name and address.`,
    )
    await layoutSettled(nonePage, 4)
    await expect(letterheadImages(nonePage)).toHaveCount(0)
    const none = await measurePages(nonePage, { headingsNotLast: true })
    expect(none.violations).toEqual([])
    expect(none.pages).toBe(shown.pages)
    expect(none.lineTops).toEqual(shown.lineTops)
    expect(noneLinkReads).toBe(0)
    await noneContext.close()
  })

  test('an unusable letterhead (409) is told in its own band, the pages keep their frame, and Generate is blocked with that reason (AC-11.4)', async ({
    browser,
  }) => {
    const deal = await completeMinimalDeal('pages-unusable')
    const reason = `The letterhead of ${issuerName} can no longer be used. Upload it again in CRM Settings.`
    const context = await contextFor(browser, admin, { viewport: WIDE })
    const page = await context.newPage()
    let linkReads = 0
    let generateRequests = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/offer-draft\/generate$/.test(new URL(request.url()).pathname))
        generateRequests++
    })
    await page.route(letterheadLinkPath, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      linkReads++
      return route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          code: 'letterhead_unusable',
          detail: 'The stored letterhead of this entity can no longer be used. Upload it again in CRM Settings.',
          entity: 'welld_ch',
          reason: 'decoded_too_large',
        }),
      })
    })

    await page.goto(wizardUrl(deal, 'preview'))
    await expect(band(page)).toHaveAttribute('data-state', 'unusable', { timeout: 30_000 })
    await expect(band(page)).toHaveText(`${reason} Offers for this entity cannot be generated until then.`)
    // Nothing is drawn behind the pages; they are still A4 pages with the frame; no dialog, no alert.
    await layoutSettled(page)
    await expect(letterheadImages(page)).toHaveCount(0)
    expect(await pageBoxes(page).count()).toBeGreaterThanOrEqual(1)
    const measured = await measurePages(page, { headingsNotLast: true })
    expect(measured.violations).toEqual([])
    expect(measured.pages).toBeGreaterThanOrEqual(1)
    await expect(band(page)).not.toHaveAttribute('role', 'alert')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    expect(linkReads).toBe(1)

    // The preview's text and autosave carry on.
    await expect(page.getByTestId('crm-wizard-flow')).toContainText('Portale clienti')

    // Generate is blocked with that reason, said in words and as the button's description; a click does nothing.
    const generate = page.getByTestId('offer-wizard-action-bar').getByRole('button', { name: 'Generate offer' })
    await expect(generate).toHaveAttribute('aria-disabled', 'true')
    await expect(generate).toHaveAccessibleDescription(new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    await expect(page.getByRole('status').filter({ hasText: reason })).toBeVisible()
    await generate.click({ force: true }) // aria-disabled, not disabled: reachable to hear why, the click is ignored
    await page.waitForTimeout(1_000)
    expect(generateRequests).toBe(0)
    expect(await listOffersViaApi(admin, deal.id)).toHaveLength(0)

    // The text still saves while the letterhead is unusable (AC-11.4: nothing else changes).
    await stepTab(page, 'Scope').click()
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/offer-draft') && r.request().method() === 'PUT', {
        timeout: 20_000,
      }),
      page.getByLabel(SUBJECT_LABEL).fill('Portale clienti due'),
    ])
    expect(saved.status()).toBe(200)
    await expect(page.getByTestId('crm-wizard-flow')).toContainText('Portale clienti due')

    // Uploaded again (the link works) and the wizard opened again: the letterhead is back and Generate works.
    await page.unroute(letterheadLinkPath)
    await page.goto(wizardUrl(deal, 'preview'))
    await expect(band(page)).toHaveAttribute('data-state', 'shown', { timeout: 30_000 })
    await expect(page.getByText('Nothing is missing. You can generate the offer.')).toBeVisible()
    await expect(
      page.getByTestId('offer-wizard-action-bar').getByRole('button', { name: 'Generate offer' }),
    ).not.toHaveAttribute('aria-disabled', 'true')

    await context.close()
  })

  test('a generation answered 409 letterhead_unusable is told, creates no offer and does not leave the wizard (AC-11.4)', async ({
    browser,
  }) => {
    const deal = await completeMinimalDeal('pages-unusable-generate')
    const reason = `The letterhead of ${issuerName} can no longer be used. Upload it again in CRM Settings.`
    const context = await contextFor(browser, admin, { viewport: WIDE })
    const page = await context.newPage()
    let generateRequests = 0
    // The preview showed the letterhead (the link works): only the generation is refused.
    await page.route(/\/offer-draft\/generate$/, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      generateRequests++
      return route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          code: 'letterhead_unusable',
          detail: 'The stored letterhead of this entity can no longer be used. Upload it again in CRM Settings.',
          entity: 'welld_ch',
          reason: 'decoded_too_large',
        }),
      })
    })

    await page.goto(wizardUrl(deal, 'preview'))
    await expect(band(page)).toHaveAttribute('data-state', 'shown', { timeout: 30_000 })
    await expect(page.getByText('Nothing is missing. You can generate the offer.')).toBeVisible()
    await page.getByTestId('offer-wizard-action-bar').getByRole('button', { name: 'Generate offer' }).click()

    await expect(page.getByText(reason)).toBeVisible({ timeout: 20_000 })
    expect(generateRequests).toBe(1)
    await expect(page).toHaveURL(new RegExp(`/crm/deals/${deal.id}/offer`))
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await listOffersViaApi(admin, deal.id)).toHaveLength(0)
    await context.close()
  })

  test('the dark theme keeps every page and its letterhead light and the same; the page edge and gap follow the theme (AC-11.5)', async ({
    browser,
  }) => {
    type Look = Awaited<ReturnType<typeof pagesLook>>
    const looks = {} as Record<'dark' | 'light', Look>
    const shots = {} as Record<'dark' | 'light', Buffer[]>

    for (const scheme of ['dark', 'light'] as const) {
      const context = await contextFor(browser, admin, { viewport: WIDE, colorScheme: scheme })
      const page = await context.newPage()
      await page.goto(wizardUrl(longDeal, 'scope'))
      await expect(band(page)).toHaveAttribute('data-state', 'shown', { timeout: 30_000 })
      const pages = await layoutSettled(page, 3)
      await expect(letterheadImages(page)).toHaveCount(pages)
      await expect
        .poll(() => letterheadImages(page).evaluateAll((els) => els.every((el) => (el as HTMLImageElement).complete)))
        .toBe(true)
      looks[scheme] = await pagesLook(page)

      // The pixels of pages 1 and 2, letterhead and text on them, inside the page's edge.
      shots[scheme] = []
      for (const index of [0, 1]) {
        await scrollToPage(page, index)
        const box = await page.evaluate((i) => {
          const region = document.querySelector('[data-testid=crm-wizard-preview]') as HTMLElement
          const r = region.getBoundingClientRect()
          const p = document.querySelectorAll('[data-testid=crm-wizard-page]')[i]!.getBoundingClientRect()
          const top = Math.max(p.top, r.top) + 2
          const bottom = Math.min(p.bottom, r.bottom) - 2
          return { x: p.left + 2, y: top, width: p.width - 4, height: bottom - top }
        }, index)
        shots[scheme].push(await stableShot(page, box))
      }
      await context.close()
    }

    // The suite's two themes really differ around the pages (the stage and the body follow the theme) ...
    expect(looks.dark.body).toBe('rgb(13, 13, 20)')
    expect(looks.light.body).not.toBe(looks.dark.body)
    expect(looks.dark.stage).not.toBe(looks.light.stage)
    // ... and not on them: every page is the same light paper with the same ink in both.
    expect(looks.dark.pages.length).toBe(looks.light.pages.length)
    expect(looks.dark.ink).toBe(looks.light.ink)
    for (const scheme of ['dark', 'light'] as const) {
      for (const pageLook of looks[scheme].pages) {
        expect(luminance(pageLook.paper), `${scheme}: paper is light`).toBeGreaterThan(0.8)
        expect(pageLook.paper).toBe(looks.light.pages[0]!.paper)
        // The edge stays distinguishable from the paper in both themes (non-text contrast floor 3:1) and from the gap.
        expect(pageLook.edgeWidth).toBe('1px')
        expect(contrast(pageLook.edge, pageLook.paper), `${scheme}: edge against paper`).toBeGreaterThanOrEqual(3)
        expect(pageLook.paper).not.toBe(looks[scheme].stage)
        // Nothing between a page's letterhead and the page inverts, dims, tints or blends it.
        expect(pageLook.chain.length).toBeGreaterThan(0)
        for (const layer of pageLook.chain) {
          expect(layer).toEqual({ filter: 'none', opacity: '1', blend: 'normal', backdrop: 'none' })
        }
      }
    }
    const comparer = await browser.newContext()
    const comparerPage = await comparer.newPage()
    for (let i = 0; i < shots.dark.length; i++) {
      const diff = await pixelDifference(comparerPage, shots.dark[i]!, shots.light[i]!)
      expect(diff.sameSize, `page ${i + 1}: both themes' pictures have the same size`).toBe(true)
      expect(
        diff.differing,
        `page ${i + 1} looks the same in both themes (${diff.differing} of ${diff.total} blocks differ visibly, within ${diff.box}; worst ${diff.worst.toFixed(1)})`,
      ).toBe(0)
    }
    await comparer.close()
  })

  test('in a Drawer the same pages and text are shown at the Drawer width, the letterhead fetched once (AC-11.6, AC-11.10, AC-11.13)', async ({
    browser,
  }) => {
    // The wide pane's text first: the Drawer must hold the same text in the same order (AC-11.6).
    const wideContext = await contextFor(browser, admin, { viewport: WIDE })
    const widePage = await wideContext.newPage()
    await widePage.goto(wizardUrl(longDeal, 'scope'))
    await expect(band(widePage)).toHaveAttribute('data-state', 'shown', { timeout: 30_000 })
    await layoutSettled(widePage, 4)
    const wideText = await flowText(widePage)
    await wideContext.close()

    const context = await contextFor(browser, admin, { viewport: DRAWER })
    const page = await context.newPage()
    let linkReads = 0
    page.on('request', (request) => {
      if (isLetterheadLinkRead(request)) linkReads++
    })
    await page.goto(wizardUrl(longDeal, 'scope'))
    await expect(page.getByTestId('crm-wizard-preview')).toHaveCount(0) // below xl the preview is not inline
    const openPreview = page
      .getByTestId('offer-wizard-action-bar')
      .getByRole('button', { name: 'Preview', exact: true })
    await openPreview.click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await expect(band(page)).toHaveAttribute('data-state', 'shown', { timeout: 30_000 })
    await expect(band(page)).toHaveText(SHOWN_CAPTION)
    const pages = await layoutSettled(page, 4)
    await expect(letterheadImages(page)).toHaveCount(pages)

    // Same text in the same order on A4 pages with the frame; the heading rule is the wide pane's (Drawer: relaxed, R7).
    expect(await flowText(page)).toBe(wideText)
    const m = await measurePages(page, { headingsNotLast: false })
    test.info().annotations.push({
      type: 'measured',
      description: `${m.pages} pages at ${Math.round(m.pageWidth)} px, over-tall rows ${m.overTallRows.length}, words wider than their cell ${m.wideWords.length}`,
    })
    expect(m.violations).toEqual([])
    expect(m.emptyPages).toEqual([])
    expect(m.pageHeight / m.pageWidth).toBeCloseTo(297 / 210, 2)
    expect(m.minFont).toBeGreaterThanOrEqual(10 - 0.01)
    expect(m.regionOverflow.scrollWidth).toBeLessThanOrEqual(m.regionOverflow.clientWidth)
    const search = await searchAcrossBreaks(page, 3)
    expect(search.failures).toEqual([])
    expect(search.tried).toBeGreaterThanOrEqual(1)

    // Closing and opening the Drawer again neither fetches the letterhead again nor changes what is shown.
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await openPreview.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(band(page)).toHaveAttribute('data-state', 'shown')
    await layoutSettled(page, 4)
    await expect(letterheadImages(page)).toHaveCount(pages)
    expect(await flowText(page)).toBe(wideText)
    expect(linkReads).toBe(1)

    await context.close()
  })
  test('<main> never scrolls at xl: on every step of a long offer and a minimal one, at three widths (D20, D21)', async ({
    browser,
  }) => {
    test.setTimeout(240_000)
    const minimalDeal = await completeMinimalDeal('pages-main-scroll')
    const mainScroll = (page: Page) =>
      page.evaluate(() => {
        const main = document.querySelector('main') as HTMLElement
        return { scrollHeight: main.scrollHeight, clientHeight: main.clientHeight, scrollTop: main.scrollTop }
      })
    const viewports = [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 1920, height: 1080 },
    ]
    const offenders: string[] = []
    for (const [label, deal] of [
      ['long', longDeal],
      ['minimal', minimalDeal],
    ] as const) {
      for (const viewport of viewports) {
        const context = await contextFor(browser, admin, { viewport })
        const page = await context.newPage()
        await page.goto(wizardUrl(deal, 'template'))
        await expect(page.getByTestId('offer-wizard-form')).toBeVisible({ timeout: 30_000 })
        // the template's own steps: a template without costs or annexes has no such tab
        const tabs = page.getByRole('tab')
        const count = await tabs.count()
        expect(count).toBeGreaterThanOrEqual(4)
        for (let i = 0; i < count; i++) {
          const tab = tabs.nth(i)
          const step = ((await tab.textContent()) ?? `#${i}`).trim()
          await tab.click()
          await expect(tab).toHaveAttribute('aria-selected', 'true')
          await page.waitForTimeout(150)
          const m = await mainScroll(page)
          if (m.scrollHeight > m.clientHeight)
            offenders.push(
              `${label} ${viewport.width}x${viewport.height} ${step}: +${m.scrollHeight - m.clientHeight} px`,
            )
        }
        await context.close()
      }
    }
    expect(offenders, 'steps where <main> has something to scroll').toEqual([])
  })

  test('on the long offer the Preview step issue click and Tab never move <main>, and focus stays visible (D21)', async ({
    browser,
  }) => {
    const context = await contextFor(browser, admin, { viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    await page.goto(wizardUrl(longDeal, 'preview'))
    await expect(stage(page)).toBeVisible({ timeout: 30_000 })
    const mainTop = () => page.evaluate(() => (document.querySelector('main') as HTMLElement).scrollTop)
    const issue = page
      .getByRole('group', { name: /^(Missing|To correct) \(\d+\)$/ })
      .getByRole('button')
      .first()
    await expect(issue, 'the long draft has an issue to click').toBeVisible()
    {
      await issue.click()
      await page.waitForTimeout(300)
      expect(await mainTop(), 'the issue click scrolled <main>').toBe(0)
      const focus = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement
        const column = document.querySelector('[data-testid="offer-wizard-form"]') as HTMLElement
        const a = el.getBoundingClientRect()
        const c = column.getBoundingClientRect()
        return { inColumn: column.contains(el), visible: a.top >= c.top - 1 && a.bottom <= c.bottom + 1 }
      })
      expect(focus).toEqual({ inColumn: true, visible: true })
    }

    await stepTab(page, 'Costs').click()
    const column = page.getByTestId('offer-wizard-form')
    await column.evaluate((el) => (el.scrollTop = 0))
    await page.getByRole('heading', { name: 'Costs', level: 3 }).focus()
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      const seen = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement
        const main = document.querySelector('main') as HTMLElement
        const column = document.querySelector('[data-testid="offer-wizard-form"]') as HTMLElement
        const a = el.getBoundingClientRect()
        const c = column.getBoundingClientRect()
        const inColumn = column.contains(el)
        return {
          mainTop: main.scrollTop,
          inColumn,
          visible: !inColumn || (a.bottom > c.top - 1 && a.top < c.bottom + 1),
          what: el.tagName + ' ' + (el.getAttribute('aria-label') ?? el.textContent ?? '').slice(0, 30),
        }
      })
      expect(seen.mainTop, `Tab ${i + 1} (${seen.what}) scrolled <main>`).toBe(0)
      expect(seen.visible, `Tab ${i + 1} (${seen.what}) is out of the form column`).toBe(true)
    }
    await context.close()
  })
  test('at 320 px the text of every page starts on its frame, not a pixel above it after a hundred pages (D24)', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const context = await contextFor(browser, admin, { viewport: { width: 320, height: 700 } })
    const page = await context.newPage()
    await page.goto(wizardUrl(longDeal, 'scope'))
    await page.getByTestId('offer-wizard-action-bar').getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(band(page)).toHaveAttribute('data-state', 'shown', { timeout: 30_000 })
    const pages = await layoutSettled(page, 100)

    // A browser keeps a float's height in 1/64 px and drops the rest: with the rail's planned heights the text of page N
    // sat N/64 px above its page's frame (1.06 px by page 111 of 136, beyond the 1 px of the frame check). The lowest
    // line of each page is measured against the frame top; the tolerance is one 1/64 px step, not the frame check's 1 px.
    const firstLines = await page.evaluate(() => {
      const pageEls = Array.from(document.querySelectorAll('[data-testid=crm-wizard-page]')) as HTMLElement[]
      const flow = document.querySelector('[data-testid=crm-wizard-flow]') as HTMLElement
      const frameTop = (120 * pageEls[0]!.getBoundingClientRect().width) / 595.28
      const boxes = pageEls.map((el) => el.getBoundingClientRect())
      const first: number[] = boxes.map(() => Number.POSITIVE_INFINITY)
      const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue
        if (node.parentElement?.closest('.visually-hidden')) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const q of Array.from(range.getClientRects())) {
          if (q.width < 0.5 || q.height < 1) continue
          const at = boxes.findIndex((b) => q.top + q.height / 2 >= b.top && q.top + q.height / 2 <= b.bottom)
          if (at >= 0) first[at] = Math.min(first[at]!, q.top - boxes[at]!.top - frameTop)
        }
      }
      return first
    })
    expect(firstLines).toHaveLength(pages)
    const lines = firstLines.filter(Number.isFinite)
    expect(lines.length).toBeGreaterThanOrEqual(100)
    // never above the frame by more than a 1/64 px step and its own rounding, on the first page or the last
    expect(Math.min(...lines)).toBeGreaterThanOrEqual(-0.07)
    await context.close()
  })
})
