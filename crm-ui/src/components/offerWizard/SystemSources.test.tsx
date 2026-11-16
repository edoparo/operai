/**
 * @vitest-environment jsdom
 *
 * A template field bound to what the system knows (`source:`), driven the way a person does (owner D13): each
 * source is either edited in the wizard's own place (never a form control), or an editable control whose typing
 * reaches the answers. The validity (`source: validityDays`) lives in `answers.validityDays`, not in
 * `answers.fields`, and was an input that wrote nowhere.
 */
import { useMemo, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OfferWizard from './OfferWizard'
import { initialAnswers, sampleContext, type WizardAnswers } from '../../lib/offerEngine/answers'
import { outline } from '../../lib/offerEngine/outline'
import { parseTemplate, SYSTEM_SOURCES, type SystemSource } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'

const t = strings.offerWizard

const templateOf = (source: SystemSource, kind: string): string => `@@salutation Dear

## SCOPE
@@step scope
Value: [VALORE].

## COSTS
@@step costs
@@costs position unit
@@line main one_off | Work | unit=? | qty=1
@@total **TOTAL**
@@end

@@field VALORE
label: Valore di sistema
kind: ${kind}
source: ${source}
`

const context = { ...sampleContext('en'), estimate: null }

function Form({ source, kind }: { source: SystemSource; kind: string }) {
  const ast = useMemo(() => parseTemplate(templateOf(source, kind)).ast, [source, kind])
  const [answers, setAnswers] = useState<WizardAnswers>(() => initialAnswers(ast, context))
  return (
    <>
      <OfferWizard
        mode="sample"
        ast={ast}
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

afterEach(cleanup)

describe('a field bound to the offer validity (owner D13)', () => {
  const field = () => screen.getByLabelText(/^Valore di sistema/) as HTMLInputElement

  it('takes digits, stores them as the validity, and shows them', async () => {
    const user = userEvent.setup()
    render(<Form source="validityDays" kind="number" />)
    expect(field().value).toBe('30')
    await user.clear(field())
    await user.type(field(), '45')
    expect(stored().validityDays).toBe(45)
    expect(field().value).toBe('45')
    expect(stored().fields.VALORE).toBeUndefined()
  })

  it('refuses letters and decimals as a whole-number field does, and marks a value outside 1 to 365', async () => {
    const user = userEvent.setup()
    render(<Form source="validityDays" kind="number" />)
    await user.clear(field())
    await user.type(field(), 'abc')
    await user.tab()
    expect(screen.getByText(t.invalid.not_integer)).not.toBeNull()
    // what the server refuses is never saved (QE D14): the answer keeps its last valid value
    expect(stored().validityDays).toBe(30)
    await user.clear(field())
    await user.type(field(), '12.5')
    // "12" was a valid number on the way; the "." and what follows are not saved
    expect(stored().validityDays).toBe(12)
    await user.clear(field())
    await user.type(field(), '400')
    expect(screen.getByText(t.invalid.days_out_of_range, { selector: '.field-error' })).not.toBeNull()
    expect(stored().validityDays).toBe(40)
    await user.clear(field())
    await user.type(field(), '365')
    expect(stored().validityDays).toBe(365)
    expect(screen.queryByText(t.invalid.days_out_of_range, { selector: '.field-error' })).toBeNull()
  })

  it('is the only validity input: the Costs step does not repeat it', async () => {
    const user = userEvent.setup()
    render(<Form source="validityDays" kind="number" />)
    await user.click(screen.getByRole('tab', { name: new RegExp(t.steps.costs) }))
    expect(screen.queryByLabelText(new RegExp(t.costs.validity.replace(/[()]/g, '\\$&')))).toBeNull()
  })
})

describe('every system source a template field may bind to', () => {
  // the sources the wizard edits in its own place are never a form control; the rest are, and typing must land
  const OWN_PLACE: readonly SystemSource[] = [
    'client',
    'clientAddress',
    'contacts',
    'place',
    'date',
    'reference',
    'issuer',
    'issuerAddress',
    'currency',
  ]

  it.each(SYSTEM_SOURCES.map((source) => [source]))('%s', async (source) => {
    const kind = source === 'manDays' ? 'number' : 'text'
    const parsed = parseTemplate(templateOf(source, kind))
    const items = outline(parsed.ast, null).steps.flatMap((step) => step.items)
    const asked = items.some((item) => item.type === 'field' && item.name === 'VALORE')
    if (OWN_PLACE.includes(source)) {
      expect(asked).toBe(false)
      return
    }
    expect(asked).toBe(true)
    const user = userEvent.setup()
    render(<Form source={source} kind={kind} />)
    const control = screen.getByLabelText(/^Valore di sistema/) as HTMLInputElement
    await user.clear(control)
    const before = JSON.stringify(stored())
    await user.type(control, '7')
    expect(JSON.stringify(stored())).not.toBe(before)
    if (source === 'validityDays') expect(stored().validityDays).toBe(7)
    else expect(stored().fields.VALORE).toBe('7')
    expect(control.value).toBe('7')
  })
})
