/**
 * @vitest-environment jsdom
 *
 * PipelinePage (AC-3.3, AC-3.4, D-25): the drag-and-drop board — six columns
 * (Won and Lost included), a deal card moved with the keyboard (Space, arrows
 * jump a lane, Space) and opened with Enter, the move sent with the deal's version
 * as If-Match, a drop on Lost asking for the reason first, and a deal outside
 * the caller's deal:manage scope rendered as a plain link card. jsdom has no layout, so each
 * column gets a fixed box (300 px apart) for dnd-kit to measure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import CrmShell from '../components/CrmShell'
import { createAppRouter } from '../router'
import { ADA, fakeApi, page } from '../test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost']

const deal = (id: string, stage: string, entity: string, version: number) => ({
  id,
  title: `Deal ${id}`,
  company: { id: 'c1', name: 'Acme SA' },
  stage,
  amountCents: 1_000_000,
  currency: 'CHF',
  entity,
  expectedCloseDate: null,
  owner: ADA,
  closedAt: null,
  updatedAt: '2026-10-30T10:00:00.000Z',
  version,
  estimateState: null,
  estimateOverridden: false,
})

const PIPELINE = {
  probabilities: { lead: 10, qualified: 25, proposal: 50, negotiation: 75, won: 100, lost: 0 },
  year: 2026,
  stages: STAGES.map((stage) => ({ stage, count: 0, totals: [] })),
}

type Moved = { stage: string; lostReason?: string; ifMatch: string | null }

type BoardOptions = {
  /** `false` plays a caller without deal:financials: the server leaves every figure out. */
  financials?: boolean
  move?: (body: { stage: string }) => { status: number; body: unknown }
}

/** The pipeline answers for the year it was asked (AC-3.6), offering 2026 and 2025. */
const yearOf = (url: URL) => ({ year: Number(url.searchParams.get('year') ?? 2026), years: [2026, 2025] })

const renderBoard = async ({ financials = true, move: answerMove }: BoardOptions = {}) => {
  const moves: Moved[] = []
  const boardQueries: string[] = []
  apiFetch.mockImplementation(
    fakeApi({
      'GET /scope': () => ({ status: 200, body: { deal: ['welld_ch'], canErase: false, financials, managesAll: false } }),
      'GET /companies': () => ({
        status: 200,
        body: page([{ id: 'c1', name: 'Acme SA', entity: 'welld_ch', status: 'client', source: null, sourceDetail: null }]),
      }),
      'GET /pipeline': (url) => ({
        status: 200,
        body: financials
          ? { ...PIPELINE, ...yearOf(url), stages: STAGES.map((stage) => ({ stage, count: 1, totals: [{ currency: 'CHF', amountCents: 5_000_000, weightedCents: 2_500_000 }] })) }
          : { ...PIPELINE, ...yearOf(url), stages: STAGES.map((stage) => ({ stage, count: 1 })) },
      }),
      'GET /deals': (url) => {
        boardQueries.push(url.search)
        const rows = [deal('d1', 'proposal', 'welld_ch', 3), { ...deal('d2', 'lead', 'welld_it', 1), estimateState: 'requested' }]
        return {
          status: 200,
          body: page(
            financials
              ? rows
              : rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'amountCents' && key !== 'currency'))),
          ),
        }
      },
      'POST /deals/d1/stage': (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { stage: string; lostReason?: string }
        const refused = answerMove?.(body)
        if (refused) return refused
        moves.push({ ...body, ifMatch: (init?.headers as Record<string, string>)['If-Match'] ?? null })
        return { status: 200, body: { ...deal('d1', body.stage, 'welld_ch', 4), lostReason: null, notes: null } }
      },
    }),
  )
  window.history.pushState(null, '', '/pipeline')
  render(<RouterProvider router={createAppRouter(undefined, CrmShell)} />)
  await screen.findByTestId('crm-pipeline-board')
  return { moves, boardQueries, pipelineQueries: () => apiFetch.mock.calls.map(([input]) => new URL(String(input))).filter((u) => u.pathname === '/pipeline') }
}

/** Lays the six lanes out side by side; a card (and the drag overlay over it) sits at the top left of its lane. */
function fakeLayout() {
  const box = (left: number, top: number, width: number, height: number) =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    // The drag overlay renders outside the columns; a browser places it over the dragged
    // card, which is the focused element during a keyboard drag.
    const anchor = this.closest('[data-testid^="crm-pipeline-stage-"]') ? this : document.activeElement
    const column = anchor?.closest('[data-testid^="crm-pipeline-stage-"]')
    if (!column) return box(0, 0, 0, 0)
    const index = STAGES.indexOf(column.getAttribute('data-testid')!.replace('crm-pipeline-stage-', ''))
    return anchor === column ? box(index * 300, 0, 280, 600) : box(index * 300 + 10, 100, 28, 28)
  })
}

const press = async (target: Element, code: string) => {
  await act(async () => {
    fireEvent.keyDown(target, { code, key: code === 'Space' ? ' ' : code })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  window.scrollTo = () => undefined
  fakeLayout()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('PipelinePage board', () => {
  it('shows a column per stage, Won and Lost included, from the board query', async () => {
    const { boardQueries } = await renderBoard()
    for (const stage of STAGES) expect(screen.getByTestId(`crm-pipeline-stage-${stage}`)).not.toBeNull()
    expect(boardQueries[0]).toContain('board=true')
    expect(within(screen.getByTestId('crm-pipeline-stage-won')).getByText('Closed in 2026')).not.toBeNull()
  })

  it('marks a deal whose technical estimate is still being worked on (specs/018)', async () => {
    await renderBoard()
    const waiting = screen.getByTestId('crm-pipeline-deal-d2')
    expect(within(waiting).getByTestId('crm-pipeline-awaiting-estimate-d2').textContent).toBe('Waiting for estimate')
    expect(screen.queryByTestId('crm-pipeline-awaiting-estimate-d1')).toBeNull()
    expect(screen.getByTestId('crm-pipeline-deal-d1').getAttribute('aria-label')).not.toContain('estimate')
  })

  it('a deal outside the caller’s scope is a plain link, not draggable', async () => {
    await renderBoard()
    expect(screen.getByTestId('crm-pipeline-deal-d1').getAttribute('aria-roledescription')).toBe('draggable')
    const outside = screen.getByTestId('crm-pipeline-deal-d2')
    expect(outside.tagName).toBe('A')
    expect(outside.getAttribute('aria-roledescription')).toBeNull()
  })

  it('Enter on a card opens the deal', async () => {
    await renderBoard()
    const card = screen.getByTestId('crm-pipeline-deal-d1')
    card.focus()
    await press(card, 'Enter')
    await waitFor(() => expect(window.location.pathname).toBe('/deals/d1'))
  })

  it('moves a deal with the keyboard, sending its version as If-Match', async () => {
    const { moves } = await renderBoard()
    const card = screen.getByTestId('crm-pipeline-deal-d1')
    card.focus()
    await press(card, 'Space')
    await press(card, 'ArrowRight')
    await press(card, 'Space')
    await waitFor(() => expect(moves).toEqual([{ stage: 'negotiation', ifMatch: '"3"' }]))
    expect(await screen.findByText('Deal moved to Offer sent.')).not.toBeNull()
  })

  it('a drop on Lost asks for the reason before moving', async () => {
    const { moves } = await renderBoard()
    const card = screen.getByTestId('crm-pipeline-deal-d1')
    card.focus()
    await press(card, 'Space')
    for (let i = 0; i < 3; i += 1) await press(card, 'ArrowRight')
    await press(card, 'Space')
    const dialog = await screen.findByRole('dialog', { name: 'Move to stage' })
    expect(moves).toEqual([])
    expect((within(dialog).getByLabelText('Stage') as HTMLSelectElement).value).toBe('lost')
    fireEvent.change(within(dialog).getByLabelText('Reason lost'), { target: { value: 'Budget cut' } })
    fireEvent.click(within(dialog).getByTestId('crm-stage-dialog-submit'))
    await waitFor(() => expect(moves).toEqual([{ stage: 'lost', lostReason: 'Budget cut', ifMatch: '"3"' }]))
  })

  it('shows amounts and per-stage totals to a caller with deal:financials', async () => {
    await renderBoard()
    expect(screen.getByTestId('crm-pipeline-deal-d1').textContent).toContain('CHF 10,000.00')
    expect(screen.getByTestId('crm-pipeline-stage-lead').textContent).toContain('CHF 50,000.00')
  })

  it('shows no money at all to a caller without deal:financials (US-1)', async () => {
    await renderBoard({ financials: false })
    const board = screen.getByTestId('crm-pipeline-board')
    expect(board.textContent).not.toMatch(/CHF|EUR/)
    expect(board.textContent).not.toContain('Total')
    expect(board.textContent).not.toContain('Weighted')
    // The count and the deal itself are still there.
    expect(screen.getByTestId('crm-pipeline-deal-d1').textContent).toContain('Deal d1')
  })

  it('explains a move the estimate gate refused, naming the deal and linking to it (AC-3.4)', async () => {
    await renderBoard({
      move: () => ({
        status: 409,
        body: {
          status: 409,
          title: 'Conflict',
          code: 'estimate_not_ready',
          detail: 'Request a technical estimate before moving the deal to offer in preparation',
        },
      }),
    })
    const card = screen.getByTestId('crm-pipeline-deal-d1')
    card.focus()
    await press(card, 'Space')
    await press(card, 'ArrowRight')
    await press(card, 'Space')
    const banner = await screen.findByTestId('crm-pipeline-gate')
    expect(banner.textContent).toContain('“Deal d1” cannot move yet')
    expect(banner.textContent).toContain('Request a technical estimate before moving the deal to offer in preparation')
    expect(within(banner).getByTestId('crm-pipeline-gate-link').getAttribute('href')).toBe('/deals/d1')
    // Not the stale-record banner: the deal is fine, the gate said no.
    expect(screen.queryByTestId('crm-stale-write')).toBeNull()
  })

  it('a year picker shows another year\'s won and lost; open deals stay whatever the year (AC-3.6)', async () => {
    const { boardQueries, pipelineQueries } = await renderBoard()
    const select = screen.getByLabelText(/Won and lost in/) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['2026', '2025'])
    expect(select.value).toBe('2026')
    expect(screen.getAllByText('Closed in 2026').length).toBeGreaterThan(0)
    fireEvent.change(select, { target: { value: '2025' } })
    await waitFor(() => expect(boardQueries.at(-1)).toContain('year=2025'))
    expect(pipelineQueries().at(-1)!.searchParams.get('year')).toBe('2025')
    expect((await screen.findAllByText('Closed in 2025')).length).toBeGreaterThan(0)
  })

  it('a card shows the client first and the deal under it, each keeping its own style', async () => {
    await renderBoard()
    const card = screen.getByTestId('crm-pipeline-deal-d1')
    const lines = Array.from(card.querySelectorAll('span')).map((el) => el.textContent)
    expect(lines.indexOf('Acme SA')).toBeLessThan(lines.indexOf('Deal d1'))
    expect(within(card).getByText('Acme SA').className).toBe('text-xs text-soft')
    expect(within(card).getByText('Deal d1').className).toBe('text-sm font-medium text-text')
  })

  it('the company list closes when focus leaves the field', async () => {
    await renderBoard()
    const input = screen.getByTestId('crm-pipeline-company-input')
    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.blur(input)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('the company filter narrows both the figures and the board', async () => {
    const { boardQueries, pipelineQueries } = await renderBoard()
    expect(boardQueries[0]).not.toContain('companyId')
    fireEvent.change(screen.getByTestId('crm-pipeline-company-input'), { target: { value: 'Acme' } })
    fireEvent.click(await screen.findByRole('option', { name: /Acme SA/ }))
    await waitFor(() => expect(boardQueries.at(-1)).toContain('companyId=c1'))
    expect(pipelineQueries().at(-1)!.searchParams.get('companyId')).toBe('c1')
  })

  it('a lane with two currencies lists each total on its own line, never summed (AC-3.4)', async () => {
    apiFetch.mockImplementation(
      fakeApi({
        'GET /scope': () => ({ status: 200, body: { deal: ['welld_ch'], canErase: false, financials: true, managesAll: false } }),
        'GET /pipeline': () => ({
          status: 200,
          body: {
            ...PIPELINE,
            stages: STAGES.map((stage) => ({
              stage,
              count: stage === 'qualified' ? 2 : 0,
              totals:
                stage === 'qualified'
                  ? [
                      { currency: 'EUR', amountCents: 16_500_000, weightedCents: 4_125_000 },
                      { currency: 'CHF', amountCents: 256_000, weightedCents: 64_000 },
                    ]
                  : [],
            })),
          },
        }),
        'GET /deals': () => ({ status: 200, body: page([deal('d1', 'qualified', 'welld_ch', 1)]) }),
      }),
    )
    window.history.pushState(null, '', '/pipeline')
    render(<RouterProvider router={createAppRouter(undefined, CrmShell)} />)
    const total = await screen.findByTestId('crm-pipeline-total-qualified')
    expect(Array.from(total.children).map((line) => line.textContent)).toEqual(['CHF 2,560.00', 'EUR 165,000.00'])
    const weighted = screen.getByTestId('crm-pipeline-weighted-qualified')
    expect(Array.from(weighted.children).map((line) => line.textContent)).toEqual(['CHF 640.00', 'EUR 41,250.00'])
  })
})

