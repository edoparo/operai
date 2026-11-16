/**
 * @vitest-environment jsdom
 *
 * The paginated preview's DOM contract (specs/20261115-crm-offer-wizard T74; AC-11.1, AC-11.10, AC-11.11, AC-11.12,
 * AC-11.13; DD-65, DD-69, DD-70): the rail of floats, the table row shifts and cell rails, the clip of a painted
 * section, the flow invariant, and when the pages are laid out again. jsdom has no layout: the collector is injected
 * (`PaginationEnv`) and returns the unpaged boxes a browser would have measured; the lines, frames, breaks and the
 * find/selection across a break are measured in Chromium (the T74 report, the e2e of T75).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import DocumentPreview from './DocumentPreview'
import { FlowBuilder } from './paper/flowBuilder'
import { pageGeometry } from './paper/geometry'
import { placeBreaks } from './paper/placement'
import { realize } from './paper/realize'
import type { CollectedFlow } from './paper/collectFlowItems'
import { PaginationEnv, type PaginationEnvValue } from './paper/usePagination'
import { initialAnswers, sampleContext, type WizardContext } from '../../lib/offerEngine/answers'
import { parseTemplate } from '../../lib/offerEngine/syntax'

const SOURCE = [
  '@@salutation Spettabile',
  '@@acceptance Il Cliente',
  '',
  'Apertura.',
  '',
  '## UNO',
  '@@step scope',
  'Testo uno.',
  '',
  '- punto',
  '- altro punto',
  '',
  '| A | B |',
  '| --- | --- |',
  '| x | y |',
  '',
  '## COSTI',
  '@@step costs',
  '@@costs position unit',
  '@@line a one_off | A | unit=100 | qty=1',
  '@@line b one_off | B | unit=200 | qty=1',
  '@@total **T**',
  '@@end',
  '',
  '@@annex SLA Servizio',
  '',
  'Introduzione.',
].join('\n')
const { ast } = parseTemplate(SOURCE)
const context: WizardContext = { ...sampleContext('en'), estimate: null }
const answers = initialAnswers(ast, context)

const flow = () => screen.getByTestId('crm-wizard-flow')
const geometry = pageGeometry(488, 16)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
})

const env = (collected: CollectedFlow | (() => CollectedFlow), over: Partial<PaginationEnvValue> = {}) =>
  ({
    width: 488,
    rootFontPx: 16,
    collect: typeof collected === 'function' ? collected : () => collected,
    ...over,
  }) satisfies PaginationEnvValue

const show = (value: PaginationEnvValue, tree = ast, ctx = context, a = answers) =>
  render(
    <PaginationEnv.Provider value={value}>
      <DocumentPreview ast={tree} answers={a} context={ctx} />
    </PaginationEnv.Provider>,
  )

/** The unpaged boxes of 100 lines: placed and realised the way the hook does it, so the test can read the rail it must draw. */
function lines(count: number): CollectedFlow & { rail: { run: number; dead: number }[] } {
  const builder = new FlowBuilder(13.5)
  builder.text(count)
  const breaks = placeBreaks(builder.items, geometry.body)
  const layout = realize(builder.items, breaks, geometry)
  return { items: builder.items, keys: new Map(), painted: [], rail: [...layout.rail] }
}

describe('the rail (DD-65): empty floats at the start of the flow, one pair per break', () => {
  it('draws z (width 0, height run) and F (width 100 %, height dead) per break, aria-hidden and empty, before the document', () => {
    const collected = lines(100)
    expect(collected.rail).toHaveLength(2)
    show(env(collected))
    const rail = Array.from(flow().children).slice(0, 4) as HTMLElement[]
    for (const [index, element] of rail.entries()) {
      expect(element.tagName).toBe('DIV')
      expect(element.getAttribute('aria-hidden')).toBe('true')
      expect(element.childNodes).toHaveLength(0)
      expect(element.style.float).toBe('left')
      expect(element.style.clear).toBe('left')
      const step = collected.rail[Math.floor(index / 2)]!
      const height = parseFloat(element.style.height)
      expect(Math.abs(height * 64 - Math.round(height * 64))).toBeLessThan(1e-9)
      if (index % 2 === 0) {
        expect(element.style.width).toBe('0px')
        // the dead zone starts 0.05 px later than planned (the render's rounding allowance), and ends where planned;
        // every height is a whole 1/64 px, the browser's own unit (QE D24), so up to 1/64 px off the plan on top of it
        expect(Math.abs(parseFloat(element.style.height) - step.run)).toBeLessThanOrEqual(0.05 + 1 / 64 + 1e-9)
      } else {
        expect(element.style.width).toBe('100%')
        expect(Math.abs(parseFloat(element.style.height) - step.dead)).toBeLessThanOrEqual(0.05 + 2 / 64 + 1e-9)
      }
    }
    // the document follows the rail
    expect(rail.at(-1)!.nextElementSibling!.getAttribute('data-flow')).toBe('text')
  })

  it('pagination adds nothing else: take the rail away and the flow is the unpaged one, text, structure and attributes', () => {
    const unpaged = render(<DocumentPreview ast={ast} answers={answers} context={context} />)
    const plain = flow().innerHTML
    unpaged.unmount()
    show(env(lines(100)))
    const paged = flow().cloneNode(true) as HTMLElement
    for (const child of Array.from(paged.children).slice(0, 4)) child.remove()
    expect(paged.innerHTML).toBe(plain)
    expect(flow().textContent).toBe(paged.textContent)
  })

  it('one page and no rail when the layout has no break', () => {
    show(env(lines(5)))
    expect(screen.getAllByTestId('crm-wizard-page')).toHaveLength(1)
    expect(flow().firstElementChild!.getAttribute('data-flow')).toBe('text')
  })

  it('an unmeasured pane paginates nothing: one page, the flow as written', () => {
    render(<DocumentPreview ast={ast} answers={answers} context={context} />)
    expect(screen.getAllByTestId('crm-wizard-page')).toHaveLength(1)
    expect(screen.getByTestId('crm-wizard-stage').getAttribute('data-layout')).toBe('0')
  })
})

describe('the flow (DD-70): positioned in the frame of the first page, in the text size and spacing of the geometry', () => {
  it('sits at the page frame: left, top and width from the geometry', () => {
    show(env(lines(5)))
    expect(parseFloat(flow().style.left)).toBeCloseTo(geometry.left + geometry.frame.left, 3)
    expect(parseFloat(flow().style.top)).toBeCloseTo(geometry.inset + geometry.frame.top, 3)
    expect(parseFloat(flow().style.width)).toBeCloseTo(geometry.width - geometry.frame.left - geometry.frame.right, 3)
  })

  it('every text item has an explicit line height in px and no padding or border (its lines are exact)', () => {
    show(env(lines(5)))
    const items = flow().querySelectorAll<HTMLElement>('[data-flow="text"]')
    expect(items.length).toBeGreaterThan(5)
    for (const item of items) {
      expect(item.style.lineHeight).toMatch(/^[\d.]+px$/)
      expect(item.style.padding).toBe('')
      expect(item.style.border).toBe('')
      expect(item.className).not.toMatch(/(^| )(p|px|py|pt|pb|border)(-|$| )/)
    }
  })

  it('the type never goes under 10 px, at 16 px root, and doubles with a doubled root (AC-11.13)', () => {
    const sizes = (root: number) => {
      const view = show(env(lines(5), { rootFontPx: root }))
      const out = Array.from(flow().querySelectorAll<HTMLElement>('[data-flow="text"]')).map((el) =>
        parseFloat(el.style.fontSize),
      )
      view.unmount()
      return out
    }
    expect(Math.min(...sizes(16))).toBeGreaterThanOrEqual(10)
    expect(Math.min(...sizes(32))).toBeGreaterThanOrEqual(20)
  })
})

describe('the flow invariant (DD-70): nothing but a table and a cell makes a block formatting context or paints a block', () => {
  const FORBIDDEN_CLASS =
    /(^|\s)(overflow[-\w]*|flex|inline-flex|grid|inline-grid|flow-root|inline-block|table-cell|float-\w+)(\s|$)/
  it('no overflow, flex, grid, flow-root or inline-block inside the flow; no block paints but a cell, the hand-edited section and the acceptance lines', () => {
    const edited = { ...answers, handEdits: {} }
    show(env(lines(5)), ast, context, edited)
    for (const el of flow().querySelectorAll<HTMLElement>('*')) {
      expect(el.className, el.outerHTML.slice(0, 80)).not.toMatch(FORBIDDEN_CLASS)
      expect(el.style.overflow).toBe('')
      expect(el.style.display).toBe('')
      const paints = /(^|\s)(border|bg-)[\w-]*/.test(el.className)
      if (!paints) continue
      const tag = el.tagName
      const inline = tag === 'MARK' || tag === 'SPAN'
      const cell = tag === 'TD' || tag === 'TH'
      const handEdited = tag === 'SECTION' && el.hasAttribute('data-flow-paint')
      const acceptanceLine = tag === 'P' && el.parentElement?.getAttribute('data-flow') === 'unit'
      expect(inline || cell || handEdited || acceptanceLine, el.outerHTML.slice(0, 100)).toBe(true)
    }
    // the table wrappers that scrolled are gone
    expect(flow().querySelector('.overflow-x-auto')).toBeNull()
  })

  it('this file’s source of the preview names no scroller, flex or grid for the flow', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(__dirname, 'DocumentPreview.tsx'), 'utf8')
    expect(source).not.toMatch(/overflow-x-auto|mt-8 border-t|grid-cols|max-w-3xl/)
  })
})

describe('tables (DD-70): a break between rows is a shift, inside an over-tall row a rail in each cell', () => {
  const table = (kind: 'between' | 'inside') => {
    const builder = new FlowBuilder(13.5)
    const rows =
      kind === 'between' ? { heights: [30, ...Array.from({ length: 30 }, () => 30)] } : { heights: [30, 700] }
    let top = 0
    const list = rows.heights.map((height, index) => {
      const row = { top, height, head: index === 0, lineHeight: 13.5, pad: 4 }
      top += height
      return row
    })
    void builder
    return { kind: 'table' as const, id: 1, breakBefore: false, keepNext: false, rows: list }
  }

  it('shifts exactly the rows the layout names, marks the first of them with its own top rule and keeps room under the table', () => {
    // the cost table of the template has 4 rows (header, two lines, a total): rows 1 and 2 of half a page each break before row 2
    const half = geometry.body / 2 + 5
    const item = {
      kind: 'table' as const,
      id: 1,
      breakBefore: false,
      keepNext: false,
      rows: [
        { top: 0, height: 30, head: true, lineHeight: 13.5, pad: 4 },
        { top: 30, height: half, head: false, lineHeight: 13.5, pad: 4 },
        { top: 30 + half, height: half, head: false, lineHeight: 13.5, pad: 4 },
        { top: 30 + 2 * half, height: half, head: false, lineHeight: 13.5, pad: 4 },
      ],
    }
    const realized = realize([item], placeBreaks([item], geometry.body), geometry)
    expect([...realized.rowShift.keys()]).toEqual(['1:2', '1:3'])
    expect([...realized.rowFirstOnPage]).toEqual(['1:2', '1:3'])
    show(env({ items: [item], keys: new Map([[1, 't:s1/cost']]), painted: [] }))
    const element = flow().querySelector<HTMLElement>('table[data-flow-key="t:s1/cost"]')!
    const rows = Array.from(element.querySelectorAll<HTMLElement>('tr'))
    expect(rows).toHaveLength(4)
    rows.forEach((row, index) => {
      const shift = realized.rowShift.get(`1:${index}`)
      for (const cell of Array.from(row.children) as HTMLElement[]) {
        expect(cell.style.transform).toBe(shift ? `translateY(${shift}px)` : '')
        expect(cell.className.split(' ').includes('border-t-transparent')).toBe(
          !(index === 0 || realized.rowFirstOnPage.has(`1:${index}`)),
        )
      }
    })
    // the room under the table is padding: a margin would collapse with the next block's own and lose a pixel
    expect(element.style.marginBottom).toBe(`${geometry.spacing.costTableAfter}px`)
    expect(parseFloat(element.style.paddingBottom)).toBeCloseTo(realized.tableExtra.get('1') ?? 0, 3)
    expect(element.style.borderCollapse).toBe('separate')
  })

  it('a row taller than a page has an empty float pair at the start of each of its cells and is clipped in the gaps', () => {
    const item = table('inside')
    const breaks = placeBreaks([item], geometry.body)
    const realized = realize([item], breaks, geometry)
    expect(realized.cellRail.get('1:1')?.length).toBeGreaterThan(0)
    show(env({ items: [item], keys: new Map([[1, 't:s1/cost']]), painted: [] }))
    const row = Array.from(flow().querySelectorAll<HTMLElement>('table[data-flow-key="t:s1/cost"] tr'))[1]!
    expect(row.children.length).toBeGreaterThan(1)
    for (const cell of Array.from(row.children) as HTMLElement[]) {
      const [z, f] = [cell.children[0] as HTMLElement, cell.children[1] as HTMLElement]
      expect(z.getAttribute('aria-hidden')).toBe('true')
      expect(z.style.width).toBe('0px')
      expect(f.style.width).toBe('100%')
      expect(f.style.clear).toBe('left')
      expect(cell.style.clipPath).toContain('path(')
    }
  })
})

describe('a table too wide for the frame (AC-11.10): words stay whole until they cannot', () => {
  const wide = (calls: { n: number }) =>
    env(() => {
      calls.n += 1
      const item = {
        kind: 'table' as const,
        id: 1,
        breakBefore: false,
        keepNext: false,
        rows: [{ top: 0, height: 30, head: true, lineHeight: 13.5, pad: 4 }],
      }
      return { items: [item], keys: new Map([[1, 't:s1/cost']]), painted: [], overflowing: ['t:s1/cost'] }
    })

  it('measures a second time with that table breaking anywhere, then lays out once', () => {
    const calls = { n: 0 }
    show(wide(calls))
    const table = flow().querySelector<HTMLElement>('table[data-flow-key="t:s1/cost"]')!
    expect(table.className).toContain('wrap-anywhere')
    expect(calls.n).toBe(2)
    expect(screen.getByTestId('crm-wizard-stage').getAttribute('data-layout')).toBe('1')
    // a table that fits keeps its words whole
    const other = flow().querySelector<HTMLElement>('table:not([data-flow-key="t:s1/cost"])')
    expect(other === null || other.className.includes('wrap-break-word')).toBe(true)
  })

  it('a table that fits is never measured twice and keeps its words whole', () => {
    const calls = { n: 0 }
    show(env(() => (calls.n++, { items: [], keys: new Map(), painted: [], overflowing: [] })))
    expect(calls.n).toBe(1)
    expect(flow().querySelector('table')!.className).toContain('wrap-break-word')
    expect(flow().querySelector('table')!.className).not.toContain('wrap-anywhere')
  })
})

describe('a painted section (DD-70): cut where a break would draw its rule in a gap', () => {
  it('a hand-edited section carries its key and the clip of the layout', () => {
    const key = resolveKey()
    const edited = {
      ...answers,
      handEdits: { [key]: { heading: 'Titolo mio', body: 'Testo mio.', sourceHeading: 'x' } },
    }
    const painted = [{ key: 'h:s0', top: 10, height: 1200 }]
    const builder = new FlowBuilder(13.5)
    builder.text(100)
    show(env({ items: builder.items, keys: new Map(), painted }), ast, context, edited)
    const section = flow().querySelector<HTMLElement>('section[data-flow-paint]')!
    expect(section.getAttribute('data-flow-key')).toBe('h:s0')
    expect(section.className).toContain('border-l-2')
    // there is a dead band inside its box only where the layout says so
    const realized = realize(builder.items, placeBreaks(builder.items, geometry.body), geometry, painted)
    expect(realized.clip.get('h:s0')?.length).toBeGreaterThan(0)
    expect(section.style.clipPath).toContain('path(')
  })
  function resolveKey(): string {
    // the first section of the template, whichever key the engine gives it
    const probe = render(<DocumentPreview ast={ast} answers={answers} context={context} />)
    const key = probe.container.querySelector('[data-section]')!.getAttribute('data-section')!
    probe.unmount()
    return key
  }
})

describe('when the pages are laid out again (AC-3.1, AC-11.11, DD-69)', () => {
  it('the layout version follows the settled resolution, 250 ms after a change, and nothing else', () => {
    vi.useFakeTimers()
    const value = env(lines(100))
    const view = render(
      <PaginationEnv.Provider value={value}>
        <DocumentPreview ast={ast} answers={answers} context={context} />
      </PaginationEnv.Provider>,
    )
    const version = () => Number(screen.getByTestId('crm-wizard-stage').getAttribute('data-layout'))
    const first = version()
    expect(first).toBe(1)
    // the same inputs again: no layout
    view.rerender(
      <PaginationEnv.Provider value={value}>
        <DocumentPreview ast={ast} answers={answers} context={context} />
      </PaginationEnv.Provider>,
    )
    expect(version()).toBe(first)
    const changed = { ...context, issuerLegalName: 'Altra' }
    view.rerender(
      <PaginationEnv.Provider value={value}>
        <DocumentPreview ast={ast} answers={answers} context={changed} />
      </PaginationEnv.Provider>,
    )
    expect(version()).toBe(first)
    act(() => void vi.advanceTimersByTime(249))
    expect(version()).toBe(first)
    act(() => void vi.advanceTimersByTime(1))
    expect(version()).toBe(first + 1)
  })

  it('a different width or root font size is a new layout, and the geometry follows it', () => {
    const view = show(env(lines(100), { width: 488 }))
    const pagesAt = () => screen.getAllByTestId('crm-wizard-page').map((page) => parseFloat(page.style.width))
    expect(pagesAt()[0]).toBeCloseTo(geometry.width, 3)
    view.unmount()
    show(env(lines(100), { width: 794 + 100 }))
    expect(pagesAt()[0]).toBe(794)
  })
})

describe('what a reader or a tool meets (AC-11.12)', () => {
  it('the region is the one stop: no landmark, heading, list or live region is added per page', () => {
    show(env(lines(100)))
    const region = screen.getByTestId('crm-wizard-preview')
    expect(region.querySelectorAll('[tabindex]')).toHaveLength(0)
    const layer = screen.getByTestId('crm-wizard-pages')
    expect(layer.querySelectorAll('[role],h1,h2,h3,h4,h5,h6,ul,ol,table,[aria-live]')).toHaveLength(0)
    // the layer's only text is each page's own number, "N/M" (D-2); inert and aria-hidden, so never read or selected
    const layerPages = Array.from(layer.querySelectorAll('[data-testid="crm-wizard-page"]'))
    expect(layerPages.map((page) => page.textContent)).toEqual(layerPages.map((_, i) => `${i + 1}/${layerPages.length}`))
    expect(layer.hasAttribute('inert')).toBe(true)
    expect(region.querySelectorAll('[aria-live],[role="status"],[role="alert"]')).toHaveLength(0)
    // exactly the elements the unpaged flow has are headings and lists
    const count = (selector: string) => flow().querySelectorAll(selector).length
    expect(count('[aria-hidden="true"]:not(span):not(div)')).toBe(0)
  })
})

describe('the width of the pane (DD-69): a change lays the pages out again, an echo of our own layout does not loop', () => {
  let width = 488
  let observers: ((entries: unknown[]) => void)[] = []
  beforeEach(() => {
    width = 488
    observers = []
    vi.useFakeTimers()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: (entries: unknown[]) => void) {
          observers.push(callback)
        }
        observe() {}
        disconnect() {}
      },
    )
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  })
  afterEach(() => vi.restoreAllMocks())

  const resizeTo = (next: number) => {
    width = next
    act(() => {
      for (const callback of observers) callback([])
      vi.advanceTimersByTime(20) // the frame the observer waits for
    })
  }
  const version = () => Number(screen.getByTestId('crm-wizard-stage').getAttribute('data-layout'))
  const pageWidth = () => parseFloat(screen.getAllByTestId('crm-wizard-page')[0]!.style.width)

  it('measures the pane before the first paint and follows a later change', () => {
    show({ collect: () => lines(100) })
    expect(version()).toBe(1)
    expect(pageWidth()).toBeCloseTo(pageGeometry(488, 16).width, 3)
    act(() => void vi.advanceTimersByTime(500))
    resizeTo(700)
    expect(version()).toBe(2)
    expect(pageWidth()).toBeCloseTo(pageGeometry(700, 16).width, 3)
  })

  it('stops following a width that keeps changing right after each of our own layouts (at most two echoes)', () => {
    show({ collect: () => lines(100) })
    act(() => void vi.advanceTimersByTime(500))
    resizeTo(600) // an ordinary change: not an echo
    resizeTo(620) // 1st echo
    resizeTo(640) // 2nd echo
    const settled = version()
    resizeTo(660) // a 3rd, right after our layout: held
    expect(version()).toBe(settled)
    expect(pageWidth()).toBeCloseTo(pageGeometry(640, 16).width, 3)
    // a change that comes later is the person's, and is followed
    act(() => void vi.advanceTimersByTime(500))
    resizeTo(700)
    expect(version()).toBe(settled + 1)
    expect(pageWidth()).toBeCloseTo(pageGeometry(700, 16).width, 3)
  })
})
