/**
 * @vitest-environment jsdom
 *
 * The generic step form (specs/20261115-crm-offer-wizard T42; AC-1.3, AC-1.4, AC-1.5, AC-1.8, AC-1.9, AC-4.5,
 * AC-5.2): every kind of field, optional blocks and choices, fills (decisions.md O3), derived fields, the notice
 * on a field a hand-edited section reads — all through the engine's setters, placed as `outline()` returns them.
 */
import { useMemo, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OfferWizard from './OfferWizard'
import { initialAnswers, sampleContext, type WizardAnswers } from '../../lib/offerEngine/answers'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'

const t = strings.offerWizard

const SOURCE = `@@salutation Dear

Opening text.

## SCOPE
@@step scope
Object: [OGGETTO]{{?NOTE:: Note: [NOTE]}}. Priority: [PRIORITA]. Budget: [BUDGET].
Deposit: [ACCONTO]% Balance: [SALDO]% Level: [LIVELLO] Uptime: [UPTIME].
{{extra::Extra: [DETTAGLIO]}}
{{mode_a::Mode A: [DETT_A]}}{{mode_b::Mode B: [DETT_B]}}

## COSTS
@@step costs
@@costs position unit
@@line main one_off | Work | unit=deal | qty=1
@@total **TOTAL**
@@end

@@field OGGETTO
label: Object
hint: What we deliver
example: A website

@@field NOTE
label: Note
kind: longtext

@@field PRIORITA
label: Priority
options: Low | High
default: Low

@@field BUDGET
label: Budget
kind: amount

@@field ACCONTO
label: Deposit
kind: percentage
default: 50

@@field SALDO
label: Balance
kind: percentage
compute: 100 - ACCONTO

@@field LIVELLO
label: Service level
options: Basic | Premium
default: Basic
fills Premium: UPTIME = 99.9
fills Basic: UPTIME = 95

@@field UPTIME
label: Uptime
kind: percentage

@@block extra
label: Extra work
explain: Work outside the base scope
fills: UPTIME = 99

@@field DETTAGLIO
label: Extra detail

@@block mode_a
label: Mode A
explain: The first way

@@block mode_b
label: Mode B

@@field DETT_A
label: Detail A

@@field DETT_B
label: Detail B

@@choice mode
label: Mode
options: mode_a | mode_b
default: mode_a
`

const ast = parseTemplate(SOURCE).ast
const context = { ...sampleContext('en'), estimate: null }

function Form({
  start,
  step = 'scope',
}: {
  start?: (answers: WizardAnswers) => WizardAnswers
  step?: 'scope' | 'costs'
}) {
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
        step={step}
        onStepChange={() => undefined}
      />
      <output data-testid="answers">{JSON.stringify(answers)}</output>
    </>
  )
}

const stored = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}') as WizardAnswers

afterEach(cleanup)

describe('StepForm — a field (AC-1.3)', () => {
  it('shows its label, hint and example, and the default of its kind', () => {
    render(<Form />)
    const object = screen.getByLabelText(/^Object/)
    expect(object.getAttribute('placeholder')).toBe('A website')
    expect(screen.getByText('What we deliver')).not.toBeNull()
    expect((screen.getByLabelText(/^Deposit/) as HTMLInputElement).value).toBe('50')
    expect((screen.getByLabelText(/^Priority/) as HTMLSelectElement).value).toBe('Low')
  })

  it('marks a required field with * and aria-required, and an optional one with the word "optional"', () => {
    render(<Form />)
    expect(screen.getByLabelText(/^Object/).getAttribute('aria-required')).toBe('true')
    const note = screen.getByLabelText(/^Note/)
    expect(note.getAttribute('aria-required')).toBeNull()
    expect(note.tagName).toBe('TEXTAREA')
    expect(within(note.closest('.field') as HTMLElement).getByText(t.field.optional)).not.toBeNull()
    expect(
      within(screen.getByLabelText(/^Object/).closest('.field') as HTMLElement).queryByText(t.field.optional),
    ).toBeNull()
  })

  it('never counts an optional field missing', () => {
    render(<Form />)
    // OGGETTO, BUDGET and DETT_A (the chosen mode's) are missing; NOTE (optional) and SALDO (derived) are not
    const tab = screen.getByRole('tab', { name: new RegExp(t.steps.scope) })
    expect(within(tab).getByText(t.steps.count(3))).not.toBeNull()
  })

  it('enters an amount in the deal currency and stores integer cents', async () => {
    const user = userEvent.setup()
    render(<Form />)
    const budget = screen.getByLabelText(/^Budget/)
    expect(screen.getByText(t.field.withCurrency('Budget', 'CHF'), { exact: false })).not.toBeNull()
    expect(budget.getAttribute('inputmode')).toBe('decimal')
    expect(budget.getAttribute('type')).toBe('text')
    await user.type(budget, '1234,5')
    expect(stored().fields.BUDGET).toBe(123450)
    await user.clear(budget)
    expect(stored().fields.BUDGET).toBeUndefined()
  })

  it('keeps a decimal typed for a percentage and stores it canonical', async () => {
    const user = userEvent.setup()
    render(<Form />)
    const uptime = screen.getByLabelText(/^Uptime/)
    await user.clear(uptime)
    await user.type(uptime, '99,90')
    expect((uptime as HTMLInputElement).value).toBe('99,90')
    expect(stored().fields.UPTIME).toBe('99.9')
    await user.clear(uptime)
    await user.type(uptime, 'abc')
    expect(stored().fields.UPTIME).toBeUndefined()
    await user.tab()
    expect(screen.getByText(t.invalid.not_a_number)).not.toBeNull()
  })

  it('shows the reason of an invalid answer, and Required on a missing one after blur', async () => {
    const user = userEvent.setup()
    render(<Form />)
    expect(screen.queryByText(t.invalid.required)).toBeNull() // a fresh wizard is not red
    const object = screen.getByLabelText(/^Object/)
    await user.click(object)
    await user.tab()
    expect(within(object.closest('.field') as HTMLElement).getByText(t.invalid.required)).not.toBeNull()
    const deposit = screen.getByLabelText(/^Deposit/)
    await user.clear(deposit)
    await user.type(deposit, '150')
    expect(within(deposit.closest('.field') as HTMLElement).getByText(t.invalid.out_of_range)).not.toBeNull()
  })
})

describe('StepForm — options (AC-1.8)', () => {
  it('offers exactly the declared options as a select', () => {
    render(<Form />)
    const select = screen.getByLabelText(/^Priority/) as HTMLSelectElement
    expect(select.tagName).toBe('SELECT')
    expect([...select.options].map((option) => option.value)).toEqual(['Low', 'High'])
  })

  it('keeps a stored value outside the options as a flagged extra choice with its error', () => {
    render(<Form start={(a) => ({ ...a, fields: { ...a.fields, PRIORITA: 'Urgent' } })} />)
    const select = screen.getByLabelText(/^Priority/) as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual(['Low', 'High', 'Urgent'])
    expect(select.value).toBe('Urgent')
    expect(screen.getByText(t.field.notAnOption('Urgent'))).not.toBeNull()
    expect(within(select.closest('.field') as HTMLElement).getByText(t.invalid.not_an_option)).not.toBeNull()
  })
})

describe('StepForm — optional blocks (AC-1.4, AC-1.5)', () => {
  it('shows a switch with its label and explanation, off by default, and reveals its fields when on', async () => {
    const user = userEvent.setup()
    render(<Form />)
    const toggle = screen.getByRole('checkbox', { name: /Extra work/ })
    expect((toggle as HTMLInputElement).checked).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('Work outside the base scope')).not.toBeNull()
    expect(screen.queryByLabelText(/^Extra detail/)).toBeNull()

    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const detail = screen.getByLabelText(/^Extra detail/)
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')?.contains(detail)).toBe(true)
    await user.click(toggle)
    expect(screen.queryByLabelText(/^Extra detail/)).toBeNull()
  })
})

describe('StepForm — block choices (AC-1.4, DD-43)', () => {
  it('is a radio group with exactly one option selected, whose own fields come beside it', async () => {
    const user = userEvent.setup()
    render(<Form />)
    const group = screen.getByRole('radiogroup', { name: 'Mode' })
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((radio) => radio.checked)).toEqual([true, false])
    expect(within(group).getByText('The first way')).not.toBeNull()

    const detail = screen.getByLabelText(/^Detail A/)
    // beside the choice, not under it (DD-43)
    expect(detail.closest('[role="radiogroup"]')).toBeNull()
    expect(group.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(radios[1]!)
    expect((within(group).getAllByRole('radio') as HTMLInputElement[]).map((radio) => radio.checked)).toEqual([
      false,
      true,
    ])
    expect(screen.queryByLabelText(/^Detail A/)).toBeNull()
    expect(screen.getByLabelText(/^Detail B/)).not.toBeNull()
    expect(stored().blocks).toMatchObject({ mode_a: false, mode_b: true })
  })
})

describe('StepForm — fills (AC-1.9, decisions.md O3)', () => {
  it('sets the targets of a chosen option, announces it, lets a later edit stand and keeps values when switched', async () => {
    const user = userEvent.setup()
    render(<Form />)
    const level = screen.getByLabelText(/^Service level/)
    // the hint of the chosen option says what it fills
    expect(within(level.closest('.field') as HTMLElement).getByText(/Fills: Uptime = 95/)).not.toBeNull()
    await user.selectOptions(level, 'Premium')
    expect(stored().fields.UPTIME).toBe('99.9')
    expect((screen.getByLabelText(/^Uptime/) as HTMLInputElement).value).toBe('99.9')
    expect(screen.getByText(t.field.filledLive(1, 'Uptime'))).not.toBeNull()

    const uptime = screen.getByLabelText(/^Uptime/)
    await user.clear(uptime)
    await user.type(uptime, '98')
    expect(stored().fields.UPTIME).toBe('98')
    // choosing another option fills its own values
    await user.selectOptions(level, 'Basic')
    expect(stored().fields.UPTIME).toBe('95')
  })

  it('fills when a block is switched on and keeps the values when it is switched off', async () => {
    const user = userEvent.setup()
    render(<Form />)
    const toggle = screen.getByRole('checkbox', { name: /Extra work/ })
    expect(screen.getByText(/Fills: Uptime = 99\./)).not.toBeNull()
    await user.click(toggle)
    expect(stored().fields.UPTIME).toBe('99')
    expect(screen.getByText(t.field.filledLive(1, 'Uptime'))).not.toBeNull()
    await user.click(toggle)
    expect(stored().fields.UPTIME).toBe('99')
  })
})

describe('StepForm — derived fields (AC-4.5)', () => {
  it('is read-only, shows the computed value and follows its inputs', async () => {
    const user = userEvent.setup()
    render(<Form />)
    const balance = screen.getByLabelText(/^Balance/) as HTMLInputElement
    expect(balance.readOnly).toBe(true)
    expect(balance.getAttribute('aria-readonly')).toBe('true')
    expect(balance.value).toBe('50')
    expect(balance.getAttribute('aria-required')).toBeNull()
    expect(within(balance.closest('.field') as HTMLElement).getByText(t.field.derived)).not.toBeNull()

    const deposit = screen.getByLabelText(/^Deposit/)
    await user.clear(deposit)
    await user.type(deposit, '30')
    expect((screen.getByLabelText(/^Balance/) as HTMLInputElement).value).toBe('70')
    await user.clear(deposit)
    expect((screen.getByLabelText(/^Balance/) as HTMLInputElement).value).toBe('')
    // never stored, never typed
    expect(stored().fields.SALDO).toBeUndefined()
  })
})

describe('StepForm — a hand-edited section reads a field (AC-5.2)', () => {
  it('names the section on each field it uses', () => {
    render(
      <Form
        start={(a) => ({
          ...a,
          handEdits: { 'SCOPE#0': { heading: 'SCOPE', body: 'Written by hand', sourceHeading: 'SCOPE' } },
        })}
      />,
    )
    const note = t.field.handEdited('SCOPE')
    const object = screen.getByLabelText(/^Object/)
    expect(within(object.closest('.field') as HTMLElement).getByText(note)).not.toBeNull()
    expect(within(screen.getByLabelText(/^Budget/).closest('.field') as HTMLElement).getByText(note)).not.toBeNull()
  })

  it('shows none when no section was edited by hand', () => {
    render(<Form />)
    expect(screen.queryByText(t.field.handEdited('SCOPE'))).toBeNull()
  })
})

describe('StepForm — only the step’s own items', () => {
  it('leaves the cost table to the Costs step', () => {
    render(<Form step="costs" />)
    expect(screen.queryByLabelText(/^Object/)).toBeNull()
  })
})
