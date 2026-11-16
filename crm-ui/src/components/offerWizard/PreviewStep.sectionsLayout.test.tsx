/**
 * @vitest-environment jsdom
 *
 * The Sections list of the Preview step by the width it has (design S7: "table rows are cards already" below 640 px;
 * QE D15). A table that does not fit scrolled sideways and hid its own actions ("Edit text", "Restore wizard text"):
 * at 360 px, and at 1280 px where the preview takes half the width. Below 640 px of its own width the list is a stack
 * of cards with the same controls; at 640 px and more, the table. jsdom has no layout, so the width comes from a
 * ResizeObserver the test controls.
 */
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OfferWizard from './OfferWizard'
import { initialAnswers, sampleContext, type WizardAnswers } from '../../lib/offerEngine/answers'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'

const t = strings.offerWizard

const SOURCE = `@@salutation Dear
@@acceptance The Client

Opening.

## SCOPE
@@step scope
Project.

## COSTS
@@step costs
@@costs position unit
@@line canone yearly | Yearly fee | unit=1000 | qty=1
@@total **TOTAL**
@@end

@@annex SLA Service level

## Parameters
@@step annexes
Level.
`

const ast = parseTemplate(SOURCE).ast
const context = { ...sampleContext('en'), estimate: null }

let width = 800
let observers: ((entry: { contentRect: { width: number } }) => void)[] = []

beforeEach(() => {
  observers = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: (entries: { contentRect: { width: number } }[]) => void) {
        observers.push((entry) => callback([entry]))
      }
      observe() {
        // the first measure, as a real observer delivers it on observe()
        queueMicrotask(() => observers.forEach((notify) => notify({ contentRect: { width } })))
      }
      unobserve() {}
      disconnect() {}
    },
  )
  // the wrapper's own width, for the first synchronous measure
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function Form() {
  const [answers, setAnswers] = useState<WizardAnswers>(() => ({
    ...initialAnswers(ast, context),
    handEdits: { 'SCOPE#0': { heading: 'SCOPE', body: 'by hand', sourceHeading: 'SCOPE' } },
  }))
  return (
    <OfferWizard
      mode="sample"
      ast={ast}
      answers={answers}
      onAnswersChange={setAnswers}
      context={context}
      step="preview"
      onStepChange={() => undefined}
    />
  )
}

/** WCAG 2.5.3 (label in name): the accessible name of every control that shows text contains that text (QE D22). */
function expectLabelsInNames(root: HTMLElement) {
  const bad = within(root)
    .getAllByRole('button')
    .flatMap((button) => {
      const visible = (button.textContent ?? '').replace(/\s+/g, ' ').trim()
      const name = (button.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim()
      return visible && name && !name.toLowerCase().includes(visible.toLowerCase()) ? [`"${name}" vs "${visible}"`] : []
    })
  expect(bad).toEqual([])
}

describe('the Sections list by its own width (QE D15)', () => {
  it('names every control with the text it shows, in the table and in the cards (QE D22)', async () => {
    width = 800
    const { container, unmount } = render(<Form />)
    await act(async () => {})
    expect(screen.getByRole('button', { name: t.sections.restore('SCOPE') }).textContent).toBe(t.edit.restore)
    expectLabelsInNames(container)
    unmount()
    width = 500
    const cards = render(<Form />)
    await act(async () => {})
    expect(screen.getByRole('button', { name: t.sections.restore('SCOPE') }).textContent).toBe(t.edit.restore)
    expectLabelsInNames(cards.container)
  })

  it('is a table at 640 px and more', async () => {
    width = 800
    render(<Form />)
    await act(async () => {})
    expect(screen.getByRole('table', { name: t.sections.caption })).toBeTruthy()
    expect(screen.queryByRole('list', { name: t.sections.caption })).toBeNull()
  })

  it('is a stack of cards below 640 px, each with its status and every action on screen', async () => {
    const user = userEvent.setup()
    width = 500
    render(<Form />)
    await act(async () => {})
    expect(screen.queryByRole('table', { name: t.sections.caption })).toBeNull()
    const list = screen.getByRole('list', { name: t.sections.caption })
    const cards = within(list).getAllByRole('listitem')
    expect(cards).toHaveLength(3)

    const scope = cards[0]!
    expect(within(scope).getByText(t.sections.edited)).toBeTruthy()
    // both actions of a hand-edited section, named like the table's, and the step it belongs to
    expect(within(scope).getByRole('button', { name: t.sections.edit('SCOPE') })).toBeTruthy()
    expect(within(scope).getByRole('button', { name: t.sections.restore('SCOPE') })).toBeTruthy()
    expect(within(scope).getByText(t.steps.scope)).toBeTruthy()
    // a section nobody edited has only Edit text
    expect(within(cards[1]!).queryByRole('button', { name: new RegExp(t.edit.restore) })).toBeNull()

    await user.click(within(scope).getByRole('button', { name: t.sections.edit('SCOPE') }))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('follows the width when it changes', async () => {
    width = 800
    render(<Form />)
    await act(async () => {})
    expect(screen.getByRole('table', { name: t.sections.caption })).toBeTruthy()
    act(() => observers.forEach((notify) => notify({ contentRect: { width: 400 } })))
    expect(screen.getByRole('list', { name: t.sections.caption })).toBeTruthy()
  })
})
