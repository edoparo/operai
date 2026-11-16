/**
 * @vitest-environment jsdom
 *
 * QE round 4, defect D14 (specs/20261115-crm-offer-wizard design S9: "the UI enforces the same limits", so a 422
 * `answers_invalid` on an ordinary edit is not reachable). The server refuses a draft whose `validityDays` is not an
 * integer of 1 to 365 (crm-api `answersSchema.ts`: `z.number().int().min(1).max(365)`). The offer validity input
 * (the Costs card's own, and a template field bound to `source: validityDays`, which is the same control) turned a
 * blank or unreadable entry into `validityDays: 0` and handed it to autosave: the server answers 422, the page shows
 * "This change could not be saved", the Preview says "Nothing is missing" and Generate then fails with "Nothing was
 * created". This pins the control-level form of the invariant: the control hands the page only answers the server
 * accepts (a blank or unreadable entry is held back and shown invalid on the field, a number outside 1 to 365 is
 * shown invalid, never sent). If the owner prefers the fix at the draft writer, move this test to that layer: the
 * observable contract either way is "no 422 on an ordinary edit, and Generate never fails with no named reason".
 */
import { useMemo, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ValidityDaysInput from './ValidityDaysInput'
import { initialAnswers, sampleContext, type WizardAnswers } from '../../lib/offerEngine/answers'
import { parseTemplate } from '../../lib/offerEngine/syntax'

const TEMPLATE = `@@salutation Dear

## COSTS
@@step costs
@@costs
@@line main one_off | Work | unit=1000 | qty=1
@@total **TOTAL**
@@end
`

const context = { ...sampleContext('en'), estimate: null }
const emitted: WizardAnswers[] = []

function Harness() {
  const ast = useMemo(() => parseTemplate(TEMPLATE).ast, [])
  const [answers, setAnswers] = useState<WizardAnswers>(() => initialAnswers(ast, context))
  return (
    <ValidityDaysInput
      answers={answers}
      onAnswersChange={(next) => {
        emitted.push(next)
        setAnswers(next)
      }}
    />
  )
}

const serverAccepts = (days: unknown): boolean =>
  typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= 365

afterEach(() => {
  cleanup()
  emitted.length = 0
})

describe('the offer validity control never hands the page an answer the server refuses (QE D14)', () => {
  it.each([
    ['clearing the field to retype it', '{Backspace}{Backspace}{Backspace}'],
    ['a letter among the digits', '4a5'],
    ['a decimal', '4.5'],
    ['zero', '0'],
    ['more than a year', '999'],
  ])('%s', async (_name, typed) => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    await user.click(input)
    await user.clear(input)
    await user.type(input, typed)
    const refused = emitted.filter((answers) => !serverAccepts(answers.validityDays)).map((a) => a.validityDays)
    expect(refused).toEqual([])
  })
})
