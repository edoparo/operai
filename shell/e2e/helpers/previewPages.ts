/**
 * Browser-side measurements of the offer wizard's paginated preview (specs/20261115-crm-offer-wizard AC-11.10,
 * AC-11.11, AC-11.12; T75). Ported from the in-page script T74 used to check the pages in Chromium by hand, so the
 * same checks are now a regression: jsdom has no layout, only a real browser can say where a line really falls.
 *
 * The functions here run INSIDE the page (`page.evaluate`): each is self-contained, reads the DOM through the test ids
 * of crm-ui's DocumentPreview and returns plain data for the spec to assert. Nothing is written to the page.
 *
 * What the preview exposes (DocumentPreview.tsx): `crm-wizard-stage` (with `data-pages` and `data-layout`), one
 * `crm-wizard-page` per A4 page in an inert, aria-hidden layer behind `crm-wizard-flow` (the ONE continuous text flow
 * drawn over the pages), and `data-flow` / `data-flow-keep` / `data-flow-break` marks on the flow's items.
 */
import type { Page } from '@playwright/test'

/** The page frame of the PDF as proportions of an A4 page of 595.28 x 841.89 pt (AC-11.10). */
export const FRAME_PT = { left: 71, right: 71, top: 120, bottom: 110, width: 595.28 } as const

export interface PageViolation {
  kind: string
  [detail: string]: unknown
}

export interface PagesMeasurement {
  pages: number
  pageWidth: number
  pageHeight: number
  gaps: number[]
  violations: PageViolation[]
  /** Rows taller than a page body that were cut between two lines, as the spec allows. */
  overTallRows: string[]
  /** Words wider than their box, wrapped anywhere: a page break at such a line is the line's, not a cut word. */
  wideWords: string[]
  headings: number
  /** The smallest computed font size of any text drawn in the flow, in CSS px (AC-11.13). */
  minFont: number
  /** Text blocks of more than one line that a break splits, and how many lines fall on each page. */
  splitBlocks: { text: string; perPage: Record<string, number> }[]
  /** Every page holds at least one line (AC-11.11, "no page is blank"), except that the last may be an annex's gap. */
  emptyPages: number[]
  /** The region's and the flow's horizontal overflow (AC-11.13: none). */
  regionOverflow: { scrollWidth: number; clientWidth: number }
  flowOverflow: { scrollWidth: number; clientWidth: number }
  /** First-line top of every line, relative to the stage, rounded to 0.1 px: where each break falls. */
  lineTops: number[]
}

/**
 * Measures every line and table cell of the flow against the page frames.
 * `headingsNotLast` is asserted only where the spec promises it (the wide pane; narrow Drawers may relax it, R7).
 */
export async function measurePages(page: Page, options: { headingsNotLast: boolean }): Promise<PagesMeasurement> {
  return page.evaluate(
    ({ frame, headingsNotLast }) => {
      const flow = document.querySelector('[data-testid=crm-wizard-flow]') as HTMLElement
      const stage = document.querySelector('[data-testid=crm-wizard-stage]') as HTMLElement
      const region = document.querySelector('[data-testid=crm-wizard-preview]') as HTMLElement
      const pageEls = Array.from(document.querySelectorAll('[data-testid=crm-wizard-page]')) as HTMLElement[]
      const pages = pageEls.map((el) => el.getBoundingClientRect())
      const W = pages[0]!.width
      const H = pages[0]!.height
      const s = W / frame.width
      const F = { l: frame.left * s, r: frame.right * s, t: frame.top * s, b: frame.bottom * s }
      const violations: PageViolation[] = []
      const overTallRows: string[] = []
      const wideWords: string[] = []
      const pageOf = (y: number): number => pages.findIndex((p) => y >= p.top - 0.5 && y <= p.bottom + 0.5)
      const hidden = (el: Element | null): boolean => !!el?.closest('.visually-hidden')
      const stageTop = stage.getBoundingClientRect().top

      // 1. every line of text is inside ITS page's frame, none in a margin or a gap (AC-11.10)
      const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT)
      const linesOnPage = new Array<number>(pages.length).fill(0)
      const tops = new Set<number>()
      let minFont = Number.POSITIVE_INFINITY
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue
        const el = node.parentElement as HTMLElement
        if (hidden(el)) continue
        minFont = Math.min(minFont, parseFloat(getComputedStyle(el).fontSize))
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const q of Array.from(range.getClientRects())) {
          if (q.width < 0.5 || q.height < 1) continue
          const pi = pageOf((q.top + q.bottom) / 2)
          if (pi < 0) {
            violations.push({ kind: 'in-gap', text: node.textContent.slice(0, 30), top: q.top - stageTop })
            continue
          }
          const P = pages[pi]!
          const inside =
            q.left >= P.left + F.l - 1 &&
            q.right <= P.right - F.r + 1 &&
            q.top >= P.top + F.t - 1 &&
            q.bottom <= P.bottom - F.b + 1
          if (!inside) {
            violations.push({
              kind: 'outside-frame',
              page: pi,
              text: node.textContent.slice(0, 30),
              left: q.left - P.left,
              right: P.right - q.right,
              top: q.top - P.top,
              bottom: P.bottom - q.bottom,
            })
          }
          linesOnPage[pi] = (linesOnPage[pi] ?? 0) + 1
          tops.add(Math.round((q.top - stageTop) * 10) / 10)
        }
      }

      // 2. a word is never split by a break: its first and last glyph are on the same page (AC-11.11)
      const words = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT)
      for (let node = words.nextNode(); node; node = words.nextNode()) {
        if (hidden(node.parentElement)) continue
        const text = node.textContent ?? ''
        const re = /\S+/g
        for (let m = re.exec(text); m; m = re.exec(text)) {
          const a = document.createRange()
          a.setStart(node, m.index)
          a.setEnd(node, m.index + 1)
          const z = document.createRange()
          z.setStart(node, m.index + m[0].length - 1)
          z.setEnd(node, m.index + m[0].length)
          const ra = a.getBoundingClientRect()
          const rz = z.getBoundingClientRect()
          if (!ra.height || !rz.height) continue
          const pa = pageOf((ra.top + ra.bottom) / 2)
          const pz = pageOf((rz.top + rz.bottom) / 2)
          if (pa === pz) continue
          // A word wider than the box it is in wraps anywhere (AC-11.10: never clipped); where that line falls on a
          // page boundary is the line's doing, not a break cutting a word that fits. Only a word that fits is a defect.
          const owner = node.parentElement!
          const box = (owner.closest('td,th,li,p,[data-flow]') ?? owner) as HTMLElement
          const boxStyle = getComputedStyle(box)
          const room =
            box.getBoundingClientRect().width - parseFloat(boxStyle.paddingLeft) - parseFloat(boxStyle.paddingRight)
          const ruler = document.createElement('canvas').getContext('2d')!
          const font = getComputedStyle(owner)
          ruler.font = `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`
          if (ruler.measureText(m[0]).width > room - 0.5) wideWords.push(m[0].slice(0, 30))
          else violations.push({ kind: 'word-split', word: m[0].slice(0, 30), from: pa, to: pz })
        }
      }

      // 3. table rows: cells inside the frame, a row is on one page unless taller than a page body (AC-11.10, 11.11)
      const body = H - F.t - F.b
      for (const tr of Array.from(flow.querySelectorAll('tr[data-flow=row]'))) {
        const cells = Array.from(tr.children) as HTMLElement[]
        const spanned = new Set<number>()
        let tallest = 0
        for (const cell of cells) {
          const r = cell.getBoundingClientRect()
          const p1 = pageOf(r.top + 1)
          const p2 = pageOf(r.bottom - 1)
          spanned.add(p1)
          spanned.add(p2)
          if (p1 < 0 || p2 < 0) {
            violations.push({ kind: 'cell-in-gap', text: cell.textContent?.slice(0, 20) })
            continue
          }
          const P1 = pages[p1]!
          const P2 = pages[p2]!
          if (r.left < P1.left + F.l - 1 || r.right > P1.right - F.r + 1) {
            violations.push({ kind: 'cell-outside-sideways', text: cell.textContent?.slice(0, 20) })
          }
          if (r.top < P1.top + F.t - 1 || r.bottom > P2.bottom - F.b + 1) {
            violations.push({ kind: 'cell-outside-vertically', text: cell.textContent?.slice(0, 20) })
          }
          // the height of the cell's own lines, whatever a break added to its box
          const range = document.createRange()
          range.selectNodeContents(cell)
          const lineTops = new Set(
            Array.from(range.getClientRects())
              .filter((q) => q.height > 1)
              .map((q) => Math.round(q.top)),
          )
          const lineHeight = parseFloat(getComputedStyle(cell).lineHeight) || 12
          tallest = Math.max(tallest, lineTops.size * lineHeight)
        }
        if (spanned.size > 1) {
          if (tallest > body) overTallRows.push(tr.textContent?.slice(0, 25) ?? '')
          else violations.push({ kind: 'row-split', text: tr.textContent?.slice(0, 30), pages: [...spanned] })
        }
      }

      // 4. a heading is never the last thing on a page; an annex starts at the top of a page (AC-11.11)
      const items = Array.from(
        flow.querySelectorAll('[data-flow=text],[data-flow=table],[data-flow=unit]'),
      ) as HTMLElement[]
      const lineRects = (el: HTMLElement): DOMRect[] => {
        if (el.tagName === 'TABLE' || el.dataset['flow'] === 'unit') {
          const c = el.querySelector('td,th,p')
          return c ? [c.getBoundingClientRect()] : []
        }
        const r = document.createRange()
        r.selectNodeContents(el)
        return Array.from(r.getClientRects())
          .filter((q) => q.height > 1)
          .sort((a, b) => a.top - b.top)
      }
      const firstPage = (el: HTMLElement): number => {
        const q = lineRects(el)[0]
        return q ? pageOf(q.top + q.height / 2) : -1
      }
      const lastPage = (el: HTMLElement): number => {
        const l = lineRects(el)
        const q = l[l.length - 1]
        return q ? pageOf(q.top + q.height / 2) : -1
      }
      let headings = 0
      items.forEach((el, i) => {
        if (el.dataset['flowKeep'] === 'next') {
          headings++
          const next = items[i + 1]
          if (headingsNotLast && next && lastPage(el) !== firstPage(next)) {
            violations.push({ kind: 'heading-last-on-page', text: el.textContent?.slice(0, 40) })
          }
        }
        if (el.dataset['flowBreak'] === 'before') {
          const q = lineRects(el)[0]
          if (q) {
            const P = pages[pageOf(q.top + q.height / 2)]
            if (P && Math.abs(q.top - (P.top + F.t)) > 2) {
              violations.push({
                kind: 'annex-not-at-frame-top',
                text: el.textContent?.slice(0, 30),
                delta: q.top - P.top - F.t,
              })
            }
          }
        }
      })

      // 5. a paragraph of several lines is never left with one line alone at either end of a break (AC-11.11)
      const splitBlocks: { text: string; perPage: Record<string, number> }[] = []
      for (const el of items.filter((e) => e.dataset['flow'] === 'text')) {
        const range = document.createRange()
        range.selectNodeContents(el)
        const lineTops = [
          ...new Set(
            Array.from(range.getClientRects())
              .filter((q) => q.height > 1)
              .map((q) => Math.round(q.top)),
          ),
        ]
        if (lineTops.length < 2) continue
        const perPage: Record<string, number> = {}
        for (const t of lineTops) {
          const pi = pageOf(t + 3)
          perPage[pi] = (perPage[pi] ?? 0) + 1
        }
        if (Object.keys(perPage).length > 1) {
          splitBlocks.push({ text: el.textContent?.slice(0, 30) ?? '', perPage })
          if (Object.values(perPage).some((n) => n === 1)) {
            violations.push({ kind: 'widow-or-orphan', text: el.textContent?.slice(0, 30), perPage })
          }
        }
      }

      const gaps = pages.slice(1).map((p, i) => p.top - pages[i]!.bottom)
      return {
        pages: pages.length,
        pageWidth: W,
        pageHeight: H,
        gaps,
        violations: violations.slice(0, 20),
        overTallRows,
        wideWords,
        headings,
        minFont,
        splitBlocks,
        emptyPages: linesOnPage.flatMap((n, i) => (n === 0 ? [i] : [])),
        regionOverflow: { scrollWidth: region.scrollWidth, clientWidth: region.clientWidth },
        flowOverflow: { scrollWidth: flow.scrollWidth, clientWidth: flow.clientWidth },
        lineTops: [...tops].sort((a, b) => a - b),
      }
    },
    { frame: FRAME_PT, headingsNotLast: options.headingsNotLast },
  )
}

export interface BreakSearch {
  /** How many sentences that a page break splits were tried. */
  tried: number
  /** Of those, the browser's search found, selected and read back exactly. */
  found: number
  /** Of those, a range over the text nodes read back (what a copy gives) exactly the sentence. */
  copied: number
  /** Of those, the selection really starts on one page and ends on a later one. */
  straddling: number
  failures: { sentence: string; found: boolean; selected: string; copied: string; pages: number[] }[]
  /** Selecting the whole flow reads back as the flow's own text, with nothing added by a break. */
  wholeFlowEqual: boolean
  /** The pages' layer and the empty rails the flow carries add no text to a selection. */
  railsEmpty: boolean
  wholeFlowDiff: string
}

/**
 * Finds up to `limit` places where a text node continues on the next page, takes the 60 characters around each break
 * and checks them the way a person meets a break: the browser's find-in-page (`window.find`) and a selection
 * (what Ctrl+C copies) must give back exactly the sentence (AC-11.12).
 */
export async function searchAcrossBreaks(page: Page, limit: number): Promise<BreakSearch> {
  return page.evaluate((max) => {
    const flow = document.querySelector('[data-testid=crm-wizard-flow]') as HTMLElement
    // window.find scrolls the region: the pages' rects are read again whenever the view may have moved
    const read = (): DOMRect[] =>
      Array.from(document.querySelectorAll('[data-testid=crm-wizard-page]')).map((p) => p.getBoundingClientRect())
    let pages = read()
    const pageOf = (y: number): number => pages.findIndex((p) => y >= p.top - 0.5 && y <= p.bottom + 0.5)
    const selection = getSelection()!
    const out: BreakSearch = {
      tried: 0,
      found: 0,
      copied: 0,
      straddling: 0,
      failures: [],
      wholeFlowEqual: false,
      railsEmpty: false,
      wholeFlowDiff: '',
    }
    let everything = ''
    const reader = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT)
    for (let n = reader.nextNode(); n; n = reader.nextNode()) everything += n.textContent ?? ''
    const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node && out.tried < max; node = walker.nextNode()) {
      pages = read()
      const text = node.textContent ?? ''
      if (text.length < 80 || node.parentElement?.closest('.visually-hidden')) continue
      let previous = -1
      let at = -1
      for (let i = 0; i < text.length; i++) {
        if (text[i] === ' ') continue
        const r = document.createRange()
        r.setStart(node, i)
        r.setEnd(node, i + 1)
        const q = r.getBoundingClientRect()
        if (!q.height) continue
        const p = pageOf((q.top + q.bottom) / 2)
        if (previous !== -1 && p > previous) {
          at = i
          break
        }
        previous = p
      }
      if (at < 0) continue
      // 60 characters around the break, grown until that stretch is the only one of its kind in the offer
      let reach = 30
      let from = Math.max(0, at - reach)
      let to = Math.min(text.length, at + reach)
      while (everything.split(text.slice(from, to)).length > 2 && reach < 200) {
        reach += 10
        from = Math.max(0, at - reach)
        to = Math.min(text.length, at + reach)
      }
      const sentence = text.slice(from, to)
      if (everything.split(sentence).length > 2) continue
      out.tried++

      selection.removeAllRanges()
      const found = (window as unknown as { find: (...args: unknown[]) => boolean }).find(
        sentence,
        true,
        false,
        false,
        false,
        false,
        false,
      )
      const selected = selection.toString()
      selection.removeAllRanges()
      const copy = document.createRange()
      copy.setStart(node, from)
      copy.setEnd(node, to)
      selection.addRange(copy)
      const copied = selection.toString()
      // the sentence really crosses a break: its first and its last glyph are on different pages
      pages = read()
      const firstAt = from + (text.slice(from, to).length - text.slice(from, to).trimStart().length)
      const lastAt = from + text.slice(from, to).trimEnd().length - 1
      const first = document.createRange()
      first.setStart(node, firstAt)
      first.setEnd(node, firstAt + 1)
      const last = document.createRange()
      last.setStart(node, lastAt)
      last.setEnd(node, lastAt + 1)
      const on = [first, last].map((glyph) => {
        const q = glyph.getBoundingClientRect()
        return pageOf((q.top + q.bottom) / 2)
      })
      const straddling = on[0]! >= 0 && on[0]! < on[1]!
      selection.removeAllRanges()

      if (found && selected === sentence) out.found++
      if (copied === sentence) out.copied++
      if (straddling) out.straddling++
      if (!(found && selected === sentence && copied === sentence && straddling)) {
        out.failures.push({ sentence, found, selected, copied, pages: on })
      }
    }

    // the whole flow selected reads back as its own text nodes, whitespace aside (a break adds no character)
    const norm = (value: string): string => value.replace(/\s+/g, '')
    selection.removeAllRanges()
    const all = document.createRange()
    all.selectNodeContents(flow)
    selection.addRange(all)
    const selected = selection.toString()
    selection.removeAllRanges()
    let concatenated = ''
    const w2 = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT)
    for (let n = w2.nextNode(); n; n = w2.nextNode()) {
      concatenated += n.textContent ?? ''
    }
    out.wholeFlowEqual = norm(selected) === norm(concatenated)
    if (!out.wholeFlowEqual) {
      const a = norm(selected)
      const b = norm(concatenated)
      let i = 0
      while (i < a.length && a[i] === b[i]) i++
      out.wholeFlowDiff = `at ${i} of ${a.length}/${b.length}: selection «${a.slice(Math.max(0, i - 40), i + 60)}» nodes «${b.slice(Math.max(0, i - 40), i + 60)}»`
    }
    out.railsEmpty = Array.from(flow.children)
      .filter((child) => child.getAttribute('aria-hidden') === 'true')
      .every((child) => child.textContent === '')
    return out
  }, limit)
}

/** The flow's text as a reader gets it: whitespace collapsed, what is hidden from the page left out. */
export async function flowText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const flow = document.querySelector('[data-testid=crm-wizard-flow]') as HTMLElement
    let text = ''
    const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) text += `${node.textContent ?? ''} `
    return text.replace(/\s+/g, ' ').trim()
  })
}

/** Scrolls the preview's region so that page `index` starts at its top edge (a stable view for a pixel comparison). */
export async function scrollToPage(page: Page, index: number): Promise<void> {
  await page.evaluate((i) => {
    const region = document.querySelector('[data-testid=crm-wizard-preview]') as HTMLElement
    const pageEl = document.querySelectorAll('[data-testid=crm-wizard-page]')[i] as HTMLElement
    region.scrollTop += pageEl.getBoundingClientRect().top - region.getBoundingClientRect().top - 8
  }, index)
}
