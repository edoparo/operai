/**
 * @vitest-environment jsdom
 *
 * List fields and repeatable tables in the step form (specs/20261115-crm-offer-wizard T43; AC-1.7): add, remove and
 * reorder with labelled icon buttons, focus to the neighbour on remove, empty items and rows kept in the form
 * and absent from the resolved document.
 */
import { useMemo, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OfferWizard from './OfferWizard'
import { initialAnswers, sampleContext, type WizardAnswers } from '../../lib/offerEngine/answers'
import { resolveOffer } from '../../lib/offerEngine/resolve'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'

const t = strings.offerWizard

const SOURCE = `@@salutation Dear

## SCOPE
@@step scope
Deliverables:

- [FEATURE]

| Module | Notes | Hours |
|---|---|---|
| [MODULO] | [NOTE_MODULO] | [ORE_MODULO] |

## COSTS
@@step costs
@@costs position unit
@@line main one_off | Work | unit=deal | qty=1
@@total **TOTAL**
@@end

@@list FEATURE
label: Features
hint: One per line

@@table MODULO
label: Module
columns: MODULO, NOTE_MODULO, ORE_MODULO

@@field NOTE_MODULO
label: Notes

@@field ORE_MODULO
label: Hours
kind: number
`

const ast = parseTemplate(SOURCE).ast
const context = { ...sampleContext('en'), estimate: null }

function Form({ start }: { start?: (answers: WizardAnswers) => WizardAnswers }) {
  const tree = useMemo(() => ast, [])
  const [answers, setAnswers] = useState(() => {
    const first = initialAnswers(tree, context)
    return start ? start(first) : first
  })
  return (
    <>
      <OfferWizard
        mode="sample"
        ast={tree}
        answers={answers}
        onAnswersChange={setAnswers}
        context={context}
        step="scope"
        onStepChange={() => undefined}
      />
      <output data-testid="answers">{JSON.stringify(answers)}</output>
    </>
  )
}

const stored = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}') as WizardAnswers
const body = (): string => resolveOffer(ast, stored(), context).sections[0]!.body
const withFeatures =
  (...items: string[]) =>
  (a: WizardAnswers): WizardAnswers => ({ ...a, lists: { ...a.lists, FEATURE: items } })
const withRows =
  (...rows: [string, string?, string?][]) =>
  (a: WizardAnswers): WizardAnswers => ({
    ...a,
    tables: {
      ...a.tables,
      MODULO: rows.map(([key, notes, hours], index) => ({
        id: `r${index + 1}`,
        cells: { MODULO: key, ...(notes ? { NOTE_MODULO: notes } : {}), ...(hours ? { ORE_MODULO: hours } : {}) },
      })),
    },
  })

afterEach(cleanup)

describe('ListFieldEditor (AC-1.7)', () => {
  it('shows each item as an input named by its position and the list', () => {
    render(<Form start={withFeatures('Alpha', 'Beta')} />)
    expect((screen.getByLabelText(t.list.item(1, 'Features')) as HTMLInputElement).value).toBe('Alpha')
    expect((screen.getByLabelText(t.list.item(2, 'Features')) as HTMLInputElement).value).toBe('Beta')
    expect(screen.getByText('One per line')).not.toBeNull()
  })

  it('adds an item, focuses it and updates the answers in order', async () => {
    const user = userEvent.setup()
    render(<Form start={withFeatures('Alpha')} />)
    await user.click(screen.getByRole('button', { name: t.list.add }))
    const added = screen.getByLabelText(t.list.item(2, 'Features'))
    expect(document.activeElement).toBe(added)
    await user.type(added, 'Beta')
    expect(stored().lists.FEATURE).toEqual(['Alpha', 'Beta'])
    expect(body().indexOf('Alpha')).toBeLessThan(body().indexOf('Beta'))
  })

  it('keeps an empty item in the form but never prints it', async () => {
    const user = userEvent.setup()
    render(<Form start={withFeatures('Alpha')} />)
    await user.click(screen.getByRole('button', { name: t.list.add }))
    expect(stored().lists.FEATURE).toEqual(['Alpha', ''])
    expect(screen.getByLabelText(t.list.item(2, 'Features'))).not.toBeNull()
    expect(body().match(/^- /gm)).toHaveLength(1)
  })

  it('removes an item by a button that names it, moves focus to its neighbour and says so', async () => {
    const user = userEvent.setup()
    render(<Form start={withFeatures('Alpha', 'Beta', 'Gamma')} />)
    await user.click(screen.getByRole('button', { name: t.list.remove(2, 'Features') }))
    expect(stored().lists.FEATURE).toEqual(['Alpha', 'Gamma'])
    expect(document.activeElement).toBe(screen.getByLabelText(t.list.item(2, 'Features')))
    expect((document.activeElement as HTMLInputElement).value).toBe('Gamma')
    expect(screen.getByText(t.list.removedLive)).not.toBeNull()
    // the last item's neighbour is the one before it
    await user.click(screen.getByRole('button', { name: t.list.remove(2, 'Features') }))
    expect((document.activeElement as HTMLInputElement).value).toBe('Alpha')
    // nothing left: focus goes to Add
    await user.click(screen.getByRole('button', { name: t.list.remove(1, 'Features') }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: t.list.add }))
    expect(stored().lists.FEATURE).toEqual([])
  })

  it('moves an item up or down, keeps focus on the moved item and the document follows', async () => {
    const user = userEvent.setup()
    render(<Form start={withFeatures('Alpha', 'Beta', 'Gamma')} />)
    await user.click(screen.getByRole('button', { name: t.list.up(3, 'Features') }))
    expect(stored().lists.FEATURE).toEqual(['Alpha', 'Gamma', 'Beta'])
    expect(document.activeElement).toBe(screen.getByRole('button', { name: t.list.up(2, 'Features') }))
    await user.click(screen.getByRole('button', { name: t.list.down(1, 'Features') }))
    expect(stored().lists.FEATURE).toEqual(['Gamma', 'Alpha', 'Beta'])
    const text = body()
    expect(text.indexOf('Gamma')).toBeLessThan(text.indexOf('Alpha'))
    expect(text.indexOf('Alpha')).toBeLessThan(text.indexOf('Beta'))
  })

  it('has nothing to move above the first item or below the last', () => {
    render(<Form start={withFeatures('Alpha', 'Beta')} />)
    expect(screen.getByRole('button', { name: t.list.up(1, 'Features') }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: t.list.down(2, 'Features') }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: t.list.down(1, 'Features') }).hasAttribute('disabled')).toBe(false)
  })

  it('stops adding at 50 items and says why', async () => {
    const user = userEvent.setup()
    render(<Form start={withFeatures(...Array.from({ length: 50 }, (_, i) => `Item ${i}`))} />)
    const add = screen.getByRole('button', { name: t.list.add })
    expect(add.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText(t.list.limit)).not.toBeNull()
    await user.click(add)
    expect(stored().lists.FEATURE).toHaveLength(50)
  })
})

describe('RepeatableTableEditor (AC-1.7)', () => {
  it('shows a card per row with a control per column, by the column field’s kind', () => {
    render(<Form start={withRows(['Intro', 'Basics', '8'])} />)
    const card = screen.getByRole('group', { name: t.table.row(1) })
    expect((within(card).getByLabelText(/^Module/) as HTMLInputElement).value).toBe('Intro')
    expect((within(card).getByLabelText(/^Notes/) as HTMLInputElement).value).toBe('Basics')
    const hours = within(card).getByLabelText(/^Hours/) as HTMLInputElement
    expect(hours.value).toBe('8')
    expect(hours.getAttribute('inputmode')).toBe('decimal')
  })

  it('adds a row, focuses its first cell and stores what is typed under the row’s id', async () => {
    const user = userEvent.setup()
    render(<Form />)
    expect(screen.getByText(t.table.empty)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: t.table.addRow }))
    const card = screen.getByRole('group', { name: t.table.row(1) })
    expect(document.activeElement).toBe(within(card).getByLabelText(/^Module/))
    await user.type(within(card).getByLabelText(/^Module/), 'Basics')
    await user.type(within(card).getByLabelText(/^Hours/), '4,5')
    const rows = stored().tables.MODULO!
    expect(rows).toHaveLength(1)
    expect(rows[0]!.cells).toEqual({ MODULO: 'Basics', ORE_MODULO: '4.5' })
    expect(rows[0]!.id).toBeTruthy()
    expect(body()).toContain('Basics')
  })

  it('keeps an empty row in the form but never prints it', async () => {
    const user = userEvent.setup()
    render(<Form start={withRows(['Intro'])} />)
    await user.click(screen.getByRole('button', { name: t.table.addRow }))
    expect(screen.getAllByRole('group', { name: /^Row \d/ })).toHaveLength(2)
    const printedRows = body()
      .split('\n')
      .filter((line) => line.includes('Intro') || /^\|\s*\|/.test(line))
    expect(printedRows.filter((line) => line.includes('Intro'))).toHaveLength(1)
    expect(body()).not.toMatch(/\|\s*\|\s*\|\s*\|/)
  })

  it('removes a row by a button that names it and moves focus to its neighbour', async () => {
    const user = userEvent.setup()
    render(<Form start={withRows(['One'], ['Two'], ['Three'])} />)
    await user.click(screen.getByRole('button', { name: t.table.removeNamed(2, 'Module') }))
    expect(stored().tables.MODULO!.map((row) => row.cells.MODULO)).toEqual(['One', 'Three'])
    const card = screen.getByRole('group', { name: t.table.row(2) })
    expect(document.activeElement).toBe(within(card).getByLabelText(/^Module/))
    expect((document.activeElement as HTMLInputElement).value).toBe('Three')
    expect(screen.getByText(t.table.removedLive)).not.toBeNull()
  })

  it('reorders rows and the document follows', async () => {
    const user = userEvent.setup()
    render(<Form start={withRows(['One'], ['Two'], ['Three'])} />)
    await user.click(screen.getByRole('button', { name: t.table.up(3, 'Module') }))
    expect(stored().tables.MODULO!.map((row) => row.cells.MODULO)).toEqual(['One', 'Three', 'Two'])
    const text = body()
    expect(text.indexOf('Three')).toBeLessThan(text.indexOf('Two'))
    // a moved row keeps its id: its cells follow it
    expect(stored().tables.MODULO!.map((row) => row.id)).toEqual(['r1', 'r3', 'r2'])
  })

  it('stops adding at 50 rows and says why', async () => {
    const user = userEvent.setup()
    render(<Form start={withRows(...Array.from({ length: 50 }, (_, i): [string] => [`Row ${i}`]))} />)
    const add = screen.getByRole('button', { name: t.table.addRow })
    expect(add.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText(t.table.limit)).not.toBeNull()
    await user.click(add)
    expect(stored().tables.MODULO).toHaveLength(50)
  })
})
