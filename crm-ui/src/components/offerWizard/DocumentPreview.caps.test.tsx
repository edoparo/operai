/**
 * @vitest-environment jsdom
 *
 * Security L-9 (specs/20261115-crm-offer-wizard): the paginated preview has a page ceiling and a time budget. Past
 * either, the flow is shown on one continuous sheet with a polite notice, and no text is lost. jsdom has no layout:
 * the collector and the clock are injected (`PaginationEnv`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import DocumentPreview from './DocumentPreview'
import { FlowBuilder } from './paper/flowBuilder'
import { pageGeometry } from './paper/geometry'
import { placeBreaks } from './paper/placement'
import { MAX_PAGES, MEASURE_BUDGET_MS, PaginationEnv, type PaginationEnvValue } from './paper/usePagination'
import type { CollectedFlow } from './paper/collectFlowItems'
import { initialAnswers, sampleContext, type WizardContext } from '../../lib/offerEngine/answers'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import { offerWizard } from '../../strings/offerWizard'
import { strings } from '../../strings'

const { ast } = parseTemplate(
  [
    '@@salutation Spettabile',
    '@@acceptance Il Cliente',
    '',
    'Apertura.',
    '',
    '## UNO',
    '@@step scope',
    'Testo uno.',
  ].join('\n'),
)
const context: WizardContext = { ...sampleContext('en'), estimate: null }
const answers = initialAnswers(ast, context)
const geometry = pageGeometry(488, 16)
const t = strings.offerWizard

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function lines(count: number): CollectedFlow {
  const builder = new FlowBuilder(13.5)
  builder.text(count)
  return { items: builder.items, keys: new Map(), painted: [] }
}
/** The pages `count` lines fill, as the hook places them. */
const pagesOf = (count: number): number => placeBreaks(lines(count).items, geometry.body).length + 1

const show = (value: PaginationEnvValue) =>
  render(
    <PaginationEnv.Provider value={{ width: 488, rootFontPx: 16, ...value }}>
      <DocumentPreview ast={ast} answers={answers} context={context} />
    </PaginationEnv.Provider>,
  )
const stage = () => screen.getByTestId('crm-wizard-stage')
const notice = () => screen.queryByTestId('crm-wizard-unpaged-notice')

describe('the page ceiling', () => {
  it('is 200 pages and a 500 ms budget', () => {
    expect(MAX_PAGES).toBe(200)
    expect(MEASURE_BUDGET_MS).toBe(500)
  })

  it('pages an offer at the ceiling, with no notice', () => {
    const pages = pagesOf(120)
    show({ collect: () => lines(120), maxPages: pages })
    expect(stage().getAttribute('data-pages')).toBe(String(pages))
    expect(notice()).toBeNull()
  })

  it('one page more: one continuous sheet, no rail, the notice, the text still in the flow', () => {
    const pages = pagesOf(120)
    expect(pages).toBeGreaterThan(2)
    show({ collect: () => lines(120), maxPages: pages - 1 })
    expect(stage().getAttribute('data-pages')).toBe('1')
    expect(screen.getAllByTestId('crm-wizard-page')).toHaveLength(1)
    const flow = screen.getByTestId('crm-wizard-flow')
    const floats = Array.from(flow.children).filter((el) => (el as HTMLElement).style.float === 'left')
    expect(floats).toHaveLength(0)
    expect(flow.textContent).toContain('Apertura.')
    expect(flow.textContent).toContain('Testo uno.')
    const polite = notice()!
    expect(polite.textContent).toBe(t.preview.unpagedNotice)
    expect(polite.getAttribute('role')).toBe('status')
  })

  it('the default ceiling: 200 pages are laid out, 201 are not', () => {
    let count = 1
    while (pagesOf(count) < MAX_PAGES) count += 1
    expect(pagesOf(count)).toBe(MAX_PAGES)
    show({ collect: () => lines(count) })
    expect(stage().getAttribute('data-pages')).toBe(String(MAX_PAGES))
    expect(notice()).toBeNull()
    cleanup()
    while (pagesOf(count) <= MAX_PAGES) count += 1
    show({ collect: () => lines(count) })
    expect(stage().getAttribute('data-pages')).toBe('1')
    expect(notice()).not.toBeNull()
  })
})

describe('the measure budget', () => {
  const clock = (elapsed: number) => {
    let at = 0
    return () => {
      const now = at
      at += elapsed
      return now
    }
  }

  it('a measure within the budget is paged', () => {
    show({ collect: () => lines(120), now: clock(MEASURE_BUDGET_MS / 4) })
    expect(Number(stage().getAttribute('data-pages'))).toBeGreaterThan(1)
    expect(notice()).toBeNull()
  })

  it('a measure over the budget falls back to one continuous sheet with the notice, once (no loop)', () => {
    const collect = vi.fn(() => lines(120))
    show({ collect, now: clock(MEASURE_BUDGET_MS + 1) })
    expect(stage().getAttribute('data-pages')).toBe('1')
    expect(notice()).not.toBeNull()
    expect(collect).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('crm-wizard-flow').textContent).toContain('Testo uno.')
  })
})

describe('the notice copy', () => {
  it('exists in both languages, and they differ', () => {
    expect(offerWizard.en.preview.unpagedNotice.length).toBeGreaterThan(10)
    expect(offerWizard.it.preview.unpagedNotice.length).toBeGreaterThan(10)
    expect(offerWizard.it.preview.unpagedNotice).not.toBe(offerWizard.en.preview.unpagedNotice)
  })
})
