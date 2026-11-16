/**
 * @vitest-environment jsdom
 *
 * The hand-edit dialog and Restore (specs/20261115-crm-offer-wizard T48; AC-5.1, AC-5.2, AC-5.3, AC-5.4; DD-30,
 * DD-52; design S8, F9): a section opens as the answers resolve it — a value still missing as a visible "⟦Label⟧",
 * the offer reference as "⟪REF⟫" — and cannot be saved while a "⟦"/"⟧" or a stray "⟪"/"⟫" is left, whether or not
 * the field was filled since; a saved section follows the answers no more until it is restored.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OfferWizard from './OfferWizard'
import type { StepPanelProps } from './StepPanel'
import type { WizardStep } from './steps'
import {
  initialAnswers,
  sampleContext,
  setField,
  type WizardAnswers,
  type WizardContext,
} from '../../lib/offerEngine/answers'
import { ApiError } from '../../lib/api'
import { resolveSectionForEdit } from '../../lib/offerEngine/edit'
import { REFERENCE_TOKEN } from '../../lib/offerEngine/markup'
import { resolveOffer } from '../../lib/offerEngine/resolve'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'

const t = strings.offerWizard

const SOURCE = `@@salutation Dear
@@acceptance The Client

Opening for [CLIENTE].

## SCOPE
@@step scope
Project [PROGETTO] for [CLIENTE].

## CONDITIONS
@@step conditions
Venue [SEDE]. Reference [RIF]. **Note** on [PROGETTO].

@@field CLIENTE
label: Client
source: client

@@field PROGETTO
label: Project
default: Alpha

@@field SEDE
label: Venue

@@field RIF
label: Reference
source: reference
`

const parsed = parseTemplate(SOURCE)
const ast = parsed.ast
const context: WizardContext = { ...sampleContext('en'), estimate: null }
const KEY = 'CONDITIONS#0'

function Form({
  commitAnswers,
  start,
}: {
  commitAnswers?: StepPanelProps['commitAnswers']
  start?: (answers: WizardAnswers) => WizardAnswers
}) {
  const [step, setStep] = useState<WizardStep>('preview')
  const [answers, setAnswers] = useState(() =>
    start ? start(initialAnswers(ast, context)) : initialAnswers(ast, context),
  )
  return (
    <>
      <OfferWizard
        mode="sample"
        ast={ast}
        answers={answers}
        onAnswersChange={setAnswers}
        context={context}
        step={step}
        onStepChange={setStep}
        commitAnswers={
          commitAnswers
            ? async (next) => {
                await commitAnswers(next)
                setAnswers(next)
              }
            : undefined
        }
      />
      <button
        type="button"
        data-testid="fill-venue"
        onClick={() => setAnswers((a) => setField(ast, a, 'SEDE', 'Lugano'))}
      />
      <output data-testid="answers">{JSON.stringify(answers)}</output>
    </>
  )
}

afterEach(cleanup)

const stored = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}') as WizardAnswers
const rowOf = (heading: string) =>
  screen.getByRole('rowheader', { name: new RegExp(heading) }).closest('tr') as HTMLElement
const openEdit = async (heading = 'CONDITIONS') => {
  const user = userEvent.setup()
  await user.click(within(rowOf(heading)).getByRole('button', { name: t.sections.edit(heading) }))
  return { user, dialog: screen.getByRole('dialog', { name: t.edit.title }) }
}
const headingBox = (dialog: HTMLElement) => within(dialog).getByLabelText(t.edit.heading) as HTMLInputElement
const textBox = (dialog: HTMLElement) => within(dialog).getByLabelText(t.edit.text) as HTMLTextAreaElement
const type = (box: HTMLElement, value: string) => fireEvent.change(box, { target: { value } })
const save = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: t.edit.save }))

describe('opening a section (AC-5.1)', () => {
  it('shows the text resolved from the answers, with a visible mark for what is missing', async () => {
    render(<Form />)
    const { dialog } = await openEdit()
    const expected = resolveSectionForEdit(ast, initialAnswers(ast, context), context, KEY)!
    expect(expected.tokens.map((token) => token.label)).toEqual(['Venue'])
    expect(headingBox(dialog).value).toBe(expected.heading)
    expect(textBox(dialog).value).toBe(expected.body)
    expect(textBox(dialog).value).toContain('⟦Venue⟧')
    // the warning names the marks; the description says the answers stop following the section
    expect(within(dialog).getByText(t.edit.missingBanner('Venue'))).toBeTruthy()
    expect(within(dialog).getByText(t.edit.description)).toBeTruthy()
    // the dialog opens on the heading, and the counters say how much room is left
    expect(document.activeElement).toBe(headingBox(dialog))
    expect(within(dialog).getByText(t.edit.counter(textBox(dialog).value.length, 20_000))).toBeTruthy()
  })

  it('opens a section with nothing missing without the warning', async () => {
    render(<Form />)
    const { dialog } = await openEdit('SCOPE')
    expect(textBox(dialog).value).not.toContain('⟦')
    expect(within(dialog).queryByRole('status')).toBeNull()
  })

  it('writes the offer reference as ⟪REF⟫, explains it and does not list it as a mark', async () => {
    render(<Form />)
    const { dialog } = await openEdit()
    expect(textBox(dialog).value).toContain(REFERENCE_TOKEN)
    expect(within(dialog).getByText(t.edit.referenceNote)).toBeTruthy()
    expect(within(dialog).getByText(t.edit.missingBanner('Venue'))).toBeTruthy() // only Venue, not the reference
  })

  it('returns focus to the Edit text button when cancelled, and changes nothing', async () => {
    render(<Form />)
    const { user, dialog } = await openEdit()
    await user.click(within(dialog).getByRole('button', { name: strings.common.cancel }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(
      within(rowOf('CONDITIONS')).getByRole('button', { name: t.sections.edit('CONDITIONS') }),
    )
    expect(stored().handEdits).toEqual({})
  })
})

describe('saving (AC-5.2)', () => {
  it('refuses while a mark is left, with the caret on it', async () => {
    render(<Form />)
    const { dialog } = await openEdit()
    const body = textBox(dialog)
    save(dialog)
    expect(within(dialog).getByText(t.edit.tokenLeft('Venue'))).toBeTruthy()
    expect(body.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(body)
    const start = body.value.indexOf('⟦Venue⟧')
    expect([body.selectionStart, body.selectionEnd]).toEqual([start, start + '⟦Venue⟧'.length])
    expect(stored().handEdits).toEqual({})
    // the error is tied to the control it is about
    const describedBy = body.getAttribute('aria-describedby') ?? ''
    expect(
      describedBy.split(' ').some((id) => document.getElementById(id)?.textContent === t.edit.tokenLeft('Venue')),
    ).toBe(true)
  })

  it('refuses a mark for a field filled since: hand-edited text no longer follows the answers', async () => {
    render(<Form />)
    const { dialog } = await openEdit()
    fireEvent.click(screen.getByTestId('fill-venue'))
    expect(stored().fields.SEDE).toBe('Lugano')
    save(dialog)
    expect(within(dialog).getByText(t.edit.tokenLeft('Venue'))).toBeTruthy()
    expect(stored().handEdits).toEqual({})
  })

  it('saves once the marks are replaced, keeps ⟪REF⟫, badges the section and ignores later field changes', async () => {
    render(<Form />)
    const { dialog } = await openEdit()
    const body = textBox(dialog).value.replace('⟦Venue⟧', 'Bellinzona')
    type(headingBox(dialog), 'Condizioni scritte a mano')
    type(textBox(dialog), body)
    save(dialog)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stored().handEdits[KEY]).toEqual({ heading: 'Condizioni scritte a mano', body, sourceHeading: 'CONDITIONS' })
    expect(stored().handEdits[KEY]!.body).toContain(REFERENCE_TOKEN)
    const row = rowOf('Condizioni scritte a mano')
    expect(within(row).getByText(t.sections.edited)).toBeTruthy()
    expect(screen.getByText(t.edit.savedLive('Condizioni scritte a mano'))).toBeTruthy()
    // a field the section uses changes: the section does not
    fireEvent.click(screen.getByTestId('fill-venue'))
    const resolved = resolveOffer(ast, stored(), context)
    const section = resolved.sections.find((candidate) => candidate.key === KEY)!
    expect(section.handEdited).toBe(true)
    expect(section.body).not.toContain('Lugano')
    expect(section.heading).toBe('Condizioni scritte a mano')
    // focus is back on the row's button
    expect(document.activeElement?.textContent).toBe(t.sections.editShort)
  })

  it('refuses ⟪REF⟫ in the heading, with the caret on it', async () => {
    render(<Form />)
    const { dialog } = await openEdit('SCOPE')
    const heading = headingBox(dialog)
    type(heading, `Scope ${REFERENCE_TOKEN}`)
    save(dialog)
    expect(within(dialog).getByText(t.edit.referenceStrayHeading)).toBeTruthy()
    expect(document.activeElement).toBe(heading)
    expect([heading.selectionStart, heading.selectionEnd]).toEqual([6, 7])
    expect(stored().handEdits).toEqual({})
  })

  it('refuses a stray ⟪ or ⟫ in the text, with the caret on the first', async () => {
    render(<Form />)
    const { dialog } = await openEdit('SCOPE')
    const body = textBox(dialog)
    type(body, 'ok ⟫ and ⟪')
    save(dialog)
    expect(within(dialog).getByText(t.edit.referenceStrayBody)).toBeTruthy()
    expect(document.activeElement).toBe(body)
    expect([body.selectionStart, body.selectionEnd]).toEqual([3, 4])
    // the whole token twice is still fine
    type(body, `A ${REFERENCE_TOKEN} B ${REFERENCE_TOKEN}`)
    save(dialog)
    expect(stored().handEdits['SCOPE#0']!.body).toBe(`A ${REFERENCE_TOKEN} B ${REFERENCE_TOKEN}`)
  })

  it('refuses a lone ⟦ or ⟧ typed by the person in the heading as well', async () => {
    render(<Form />)
    const { dialog } = await openEdit('SCOPE')
    type(headingBox(dialog), 'Scope ⟧')
    save(dialog)
    expect(within(dialog).getByText(t.edit.bracketStray)).toBeTruthy()
    expect(document.activeElement).toBe(headingBox(dialog))
    expect(stored().handEdits).toEqual({})
  })

  it('refuses a heading over 120 and a text over 20 000 characters, and says so at once', async () => {
    render(<Form />)
    const { dialog } = await openEdit('SCOPE')
    type(headingBox(dialog), 'h'.repeat(121))
    expect(within(dialog).getByText(t.edit.tooLong(120))).toBeTruthy()
    expect(headingBox(dialog).getAttribute('aria-invalid')).toBe('true')
    save(dialog)
    expect(stored().handEdits).toEqual({})
    expect(document.activeElement).toBe(headingBox(dialog))
    type(headingBox(dialog), 'h'.repeat(120))
    type(textBox(dialog), 'b'.repeat(20_001))
    expect(within(dialog).getByText(t.edit.tooLong(20_000))).toBeTruthy()
    save(dialog)
    expect(stored().handEdits).toEqual({})
    expect(document.activeElement).toBe(textBox(dialog))
    type(textBox(dialog), 'b'.repeat(20_000))
    save(dialog)
    expect(stored().handEdits['SCOPE#0']!.body).toHaveLength(20_000)
  })

  it('is busy while the draft saves: it says so and cannot be dismissed', async () => {
    let finish: () => void = () => {}
    render(<Form commitAnswers={() => new Promise<void>((resolve) => (finish = resolve))} />)
    const { user, dialog } = await openEdit('SCOPE')
    type(textBox(dialog), 'Written by hand')
    save(dialog)
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: t.edit.saving }).getAttribute('aria-busy')).toBe('true'),
    )
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: t.edit.title })).toBe(dialog)
    finish()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stored().handEdits['SCOPE#0']!.body).toBe('Written by hand')
  })

  it('stays busy while the draft saves and keeps the text when it fails', async () => {
    let fail = true
    render(
      <Form
        commitAnswers={async () => {
          if (fail) throw new ApiError({ status: 409, title: 'Conflict', code: 'version_conflict' })
        }}
      />,
    )
    const { dialog } = await openEdit('SCOPE')
    type(textBox(dialog), 'Written by hand')
    save(dialog)
    await waitFor(() =>
      expect(within(dialog).getByRole('alert').textContent).toBe(strings.offers.errors.versionConflict),
    )
    expect(screen.getByRole('dialog', { name: t.edit.title })).toBe(dialog)
    expect(textBox(dialog).value).toBe('Written by hand')
    expect(stored().handEdits).toEqual({})
    fail = false
    save(dialog)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stored().handEdits['SCOPE#0']!.body).toBe('Written by hand')
  })
})

describe('restoring (AC-5.3)', () => {
  const edited = (a: WizardAnswers): WizardAnswers => ({
    ...a,
    handEdits: { [KEY]: { heading: 'My heading', body: 'My text', sourceHeading: 'CONDITIONS' } },
  })

  it('opens a hand-edited section with its stored text and no marks', async () => {
    render(<Form start={edited} />)
    const { dialog } = await openEdit('My heading')
    expect(headingBox(dialog).value).toBe('My heading')
    expect(textBox(dialog).value).toBe('My text')
    expect(within(dialog).queryByText(t.edit.missingBanner('Venue'))).toBeNull()
  })

  it('asks first, naming the section and what is lost, then the wizard text returns', async () => {
    render(<Form start={edited} />)
    const user = userEvent.setup()
    const row = rowOf('My heading')
    expect(within(row).getByText(t.sections.edited)).toBeTruthy()
    await user.click(within(row).getByRole('button', { name: t.sections.restore('My heading') }))
    const confirm = screen.getByRole('alertdialog', { name: t.restore.title })
    expect(within(confirm).getByText(t.restore.body('My heading'))).toBeTruthy()
    // nothing happens until it is confirmed
    expect(stored().handEdits[KEY]).toBeDefined()
    await user.click(within(confirm).getByRole('button', { name: t.restore.confirm }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(stored().handEdits).toEqual({})
    const section = resolveOffer(ast, stored(), context).sections.find((candidate) => candidate.key === KEY)!
    expect(section.handEdited).toBe(false)
    expect(section.body).toContain('Venue')
    expect(screen.getByText(t.edit.restoredLive('CONDITIONS'))).toBeTruthy()
    expect(within(rowOf('CONDITIONS')).queryByText(t.sections.edited)).toBeNull()
  })

  it('keeps the text when the confirmation is cancelled', async () => {
    render(<Form start={edited} />)
    const user = userEvent.setup()
    await user.click(within(rowOf('My heading')).getByRole('button', { name: t.sections.restore('My heading') }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: strings.common.cancel }))
    expect(stored().handEdits[KEY]!.body).toBe('My text')
  })

  it('restores from inside the dialog, over it, and closes both', async () => {
    render(<Form start={edited} />)
    const { user, dialog } = await openEdit('My heading')
    await user.click(within(dialog).getByRole('button', { name: t.edit.restore }))
    const confirm = screen.getByRole('alertdialog', { name: t.restore.title })
    // the confirmation is on top: Escape closes it and leaves the dialog
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog', { name: t.edit.title })).toBe(dialog)
    await user.click(within(dialog).getByRole('button', { name: t.edit.restore }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: t.restore.confirm }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stored().handEdits).toEqual({})
    expect(confirm.isConnected).toBe(false)
  })

  it('offers no Restore for a section that was never edited', async () => {
    render(<Form />)
    const { dialog } = await openEdit('SCOPE')
    expect(within(dialog).queryByRole('button', { name: t.edit.restore })).toBeNull()
    expect(within(rowOf('SCOPE')).queryByRole('button', { name: t.sections.restore('SCOPE') })).toBeNull()
  })
})
