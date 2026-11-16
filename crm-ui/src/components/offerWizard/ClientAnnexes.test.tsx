/**
 * @vitest-environment jsdom
 *
 * The Client and Annexes steps (specs/20261115-crm-offer-wizard T45; AC-2.1, AC-2.2, AC-2.5, AC-9.6): the client
 * block prefilled and editable, contacts and PDFs capped, the reference never an input, the printed date checked
 * against the context's day, and the annexes the template, the estimate and the deal's files give.
 */
import { useMemo, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OfferWizard from './OfferWizard'
import type { WizardStep } from './steps'
import { initialAnswers, sampleContext, type WizardAnswers, type WizardContext } from '../../lib/offerEngine/answers'
import { resolveOffer } from '../../lib/offerEngine/resolve'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'

const t = strings.offerWizard

const SOURCE = `@@salutation Dear

Opening for [CLIENTE].

## SCOPE
@@step scope
Man-days: [GIORNI]. Place [LUOGO] on [DATA].

## COSTS
@@step costs
@@costs position unit
@@line main one_off | Work | unit=deal | qty=manDays
@@total **TOTAL**
@@end

@@annex SLA Service level
@@subtitle Support for [PIATTAFORMA]

Intro text.

## Parameters
@@step annexes
Level [LIVELLO].

@@field CLIENTE
label: Client
source: client

@@field LUOGO
label: Place
source: place

@@field DATA
label: Date
source: date

@@field GIORNI
label: Man-days
source: manDays

@@field PIATTAFORMA
label: Platform

@@field LIVELLO
label: Level
`

const ast = parseTemplate(SOURCE).ast

const baseContext: WizardContext = {
  ...sampleContext('en'),
  estimate: null,
  contacts: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `c${n}`, name: `Contact ${n}` })),
  attachments: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `a${n}`, fileName: `file${n}.pdf`, sizeBytes: 1024 * 1024 * n })),
}

function Form({
  first,
  context = baseContext,
  start,
}: {
  first: WizardStep
  context?: WizardContext
  start?: (answers: WizardAnswers) => WizardAnswers
}) {
  const tree = useMemo(() => ast, [])
  const [step, setStep] = useState<WizardStep>(first)
  const [answers, setAnswers] = useState(() => {
    const initial = initialAnswers(tree, context)
    return start ? start(initial) : initial
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
        onStepChange={setStep}
      />
      <output data-testid="answers">{JSON.stringify(answers)}</output>
    </>
  )
}

const stored = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}') as WizardAnswers

afterEach(cleanup)

describe('Client step (AC-2.1, AC-2.2)', () => {
  it('shows the prefilled client lines, place and no chosen contacts', () => {
    render(<Form first="client" />)
    const lines = baseContext.clientLines.en
    expect((screen.getByLabelText(t.list.item(1, t.client.lines)) as HTMLInputElement).value).toBe(lines[0])
    expect((screen.getByLabelText(t.client.place) as HTMLInputElement).value).toBe(baseContext.placeOfIssue)
    for (const contact of baseContext.contacts) {
      expect((screen.getByRole('checkbox', { name: contact.name }) as HTMLInputElement).checked).toBe(false)
    }
  })

  it('edits the client lines and the place, and the resolved document follows', async () => {
    const user = userEvent.setup()
    render(<Form first="client" />)
    const first = screen.getByLabelText(t.list.item(1, t.client.lines))
    await user.clear(first)
    await user.type(first, 'Acme SA')
    const place = screen.getByLabelText(t.client.place)
    await user.clear(place)
    await user.type(place, 'Bellinzona')
    const resolved = resolveOffer(ast, stored(), baseContext)
    expect(resolved.client.lines[0]).toBe('Acme SA')
    expect(resolved.client.place).toBe('Bellinzona')
    expect(resolved.opening).toContain('Acme SA')
  })

  it('keeps client lines to 8', async () => {
    const user = userEvent.setup()
    render(
      <Form
        first="client"
        start={(a) => ({ ...a, client: { ...a.client, lines: ['1', '2', '3', '4', '5', '6', '7', '8'] } })}
      />,
    )
    const add = screen.getByRole('button', { name: t.list.add })
    expect(add.getAttribute('aria-disabled')).toBe('true')
    await user.click(add)
    expect(stored().client.lines).toHaveLength(8)
  })

  it('picks contacts and refuses a sixth', async () => {
    const user = userEvent.setup()
    render(<Form first="client" />)
    for (let n = 1; n <= 5; n += 1) await user.click(screen.getByRole('checkbox', { name: `Contact ${n}` }))
    expect(stored().client.contactIds).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    await user.click(screen.getByRole('checkbox', { name: 'Contact 6' }))
    expect(stored().client.contactIds).toHaveLength(5)
    expect(screen.getByText(t.client.contactsLimit, { selector: '.field-error' })).not.toBeNull()
    expect(resolveOffer(ast, stored(), baseContext).client.contacts).toHaveLength(5)
    await user.click(screen.getByRole('checkbox', { name: 'Contact 5' }))
    expect(stored().client.contactIds).toHaveLength(4)
    expect(screen.queryByText(t.client.contactsLimit, { selector: '.field-error' })).toBeNull()
  })

  it('says a company without contacts has none, as a note and not an error', () => {
    render(<Form first="client" context={{ ...baseContext, contacts: [] }} />)
    expect(screen.getByText(t.client.contactsEmpty)).not.toBeNull()
  })

  it('shows the reference as assigned later and never as an input', () => {
    render(<Form first="client" />)
    expect(screen.getByText(t.client.referencePending)).not.toBeNull()
    expect(screen.queryByRole('textbox', { name: new RegExp(t.client.reference) })).toBeNull()
  })

  it('states the currency once', () => {
    render(<Form first="client" />)
    expect(screen.getByText(t.client.currency('CHF'))).not.toBeNull()
  })

  it('prints the day of generation by default and a chosen date when asked', async () => {
    const user = userEvent.setup()
    render(<Form first="client" />)
    expect((screen.getByRole('radio', { name: t.client.dateToday }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByLabelText(t.client.dateInput)).toBeNull()
    await user.click(screen.getByRole('radio', { name: t.client.dateOn }))
    const date = screen.getByLabelText(t.client.dateInput) as HTMLInputElement
    expect(date.value).toBe(baseContext.today)
    fireEvent.change(date, { target: { value: '2026-02-03' } })
    expect(stored().client.date).toBe('2026-02-03')
    expect(resolveOffer(ast, stored(), baseContext).client.date).toBe('2026-02-03')
    await user.click(screen.getByRole('radio', { name: t.client.dateToday }))
    expect(stored().client.date).toBeNull()
  })

  it('shows the date_out_of_range error on the date input for a date 91 days from today (DD-42)', () => {
    // sampleContext's day is 2026-01-15; 91 days later is 2026-04-16
    render(<Form first="client" start={(a) => ({ ...a, client: { ...a.client, date: '2026-04-16' } })} />)
    const date = screen.getByLabelText(t.client.dateInput)
    expect(date.getAttribute('aria-invalid')).toBe('true')
    expect(within(date.closest('.field') as HTMLElement).getByText(t.client.dateRange)).not.toBeNull()
    expect(date.getAttribute('data-wizard-field')).toBe('client:date')
  })

  it('accepts a date exactly 90 days from today', () => {
    render(<Form first="client" start={(a) => ({ ...a, client: { ...a.client, date: '2026-04-15' } })} />)
    expect(screen.getByLabelText(t.client.dateInput).getAttribute('aria-invalid')).toBeNull()
  })
})

describe('Annexes step (AC-2.5, AC-9.6)', () => {
  const ready = (manDays: number, manDaysAi: number): WizardContext => ({
    ...baseContext,
    estimate: {
      state: 'ready',
      manDays,
      manDaysAi,
      epics: [],
      phases: [],
      timeline: { it: '', en: '' },
      releases: [],
    },
  })

  it('lists the deal’s PDFs as the only annex picker, with their sizes', () => {
    render(<Form first="annexes" />)
    const group = screen.getByRole('group', { name: t.annexes.pdfs })
    expect(within(group).getAllByRole('checkbox')).toHaveLength(6)
    expect(screen.getByText(t.annexes.pdfsSize(0, '0.0'))).not.toBeNull()
    expect(screen.queryByRole('textbox', { name: /Allegati|Annexes/ })).toBeNull()
  })

  it('picks up to five PDFs and refuses a sixth', async () => {
    const user = userEvent.setup()
    render(<Form first="annexes" />)
    for (let n = 1; n <= 5; n += 1) await user.click(screen.getByRole('checkbox', { name: new RegExp(`file${n}.pdf`) }))
    expect(stored().attachmentIds).toHaveLength(5)
    await user.click(screen.getByRole('checkbox', { name: /file6.pdf/ }))
    expect(stored().attachmentIds).toHaveLength(5)
    expect(screen.getByText(t.annexes.pdfsLimit, { selector: '.field-error' })).not.toBeNull()
    expect(screen.getByText(t.annexes.pdfsSize(5, '15.0'))).not.toBeNull()
  })

  it('refuses a PDF that would take the total past 20 MB', async () => {
    const user = userEvent.setup()
    render(
      <Form
        first="annexes"
        context={{ ...baseContext, attachments: [{ id: 'big', fileName: 'big.pdf', sizeBytes: 21 * 1024 * 1024 }] }}
      />,
    )
    await user.click(screen.getByRole('checkbox', { name: /big.pdf/ }))
    expect(stored().attachmentIds).toEqual([])
    expect(screen.getByText(t.annexes.pdfsTooBig, { selector: '.field-error' })).not.toBeNull()
  })

  it('says a deal without PDFs has none', () => {
    render(<Form first="annexes" context={{ ...baseContext, attachments: [] }} />)
    expect(screen.getByText(t.annexes.pdfsEmpty)).not.toBeNull()
  })

  it('shows the template’s own annex-step items', () => {
    render(<Form first="annexes" />)
    expect(screen.getByLabelText(/Level/)).not.toBeNull()
  })

  it('disables the effort-detail annex with its reason when the deal has no ready estimate', () => {
    render(<Form first="annexes" />)
    const effort = screen.getByRole('checkbox', { name: t.annexes.effort }) as HTMLInputElement
    expect(effort.disabled).toBe(true)
    expect(screen.getAllByText(t.annexes.noEstimate).length).toBeGreaterThan(0)
  })

  it('switches the effort-detail annex on and the resolved document follows', async () => {
    const user = userEvent.setup()
    const context = ready(12, 8)
    render(<Form first="annexes" context={context} />)
    await user.click(screen.getByRole('checkbox', { name: t.annexes.effort }))
    expect(stored().effortAnnex).toBe(true)
    expect(resolveOffer(ast, stored(), context).effortAnnex).toBe(true)
  })

  it('switches AI-assisted figures: untouched man-days follow, edited ones keep the person’s value', async () => {
    const user = userEvent.setup()
    const context = ready(12, 8)
    render(<Form first="annexes" context={context} />)
    expect(stored().fields.GIORNI).toBe('12')
    await user.click(screen.getByRole('checkbox', { name: t.annexes.ai }))
    expect(stored().aiAssisted).toBe(true)
    expect(stored().fields.GIORNI).toBe('8')
    expect(stored().costs.lines.main?.quantity).toBe(8)
    await user.click(screen.getByRole('checkbox', { name: t.annexes.ai }))
    expect(stored().fields.GIORNI).toBe('12')
  })

  it('keeps a man-days value the person edited when AI-assisted is switched', async () => {
    const user = userEvent.setup()
    const context = ready(12, 8)
    render(<Form first="annexes" context={context} start={(a) => ({ ...a, fields: { ...a.fields, GIORNI: '15' } })} />)
    await user.click(screen.getByRole('checkbox', { name: t.annexes.ai }))
    expect(stored().aiAssisted).toBe(true)
    expect(stored().fields.GIORNI).toBe('15')
  })
})
