/**
 * @vitest-environment jsdom
 *
 * The Preview step (specs/20261115-crm-offer-wizard T47; AC-3.4, AC-3.5, AC-3.6; design S7, F4a): what is missing
 * and what is invalid, listed from the engine's one issue list (or a 422 `offer_incomplete` body as it is), each
 * item taking the person to the step that holds it and focusing the element named by its `name`; and the sections
 * table that opens the hand edit.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OfferWizard from './OfferWizard'
import type { WizardStep } from './steps'
import {
  initialAnswers,
  sampleContext,
  setField,
  type WizardAnswers,
  type WizardContext,
} from '../../lib/offerEngine/answers'
import type { Issue } from '../../lib/offerEngine/resolve'
import { resolveOffer } from '../../lib/offerEngine/resolve'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'

const t = strings.offerWizard

const SOURCE = `@@salutation Dear
@@acceptance The Client

Opening for [CLIENTE].

## SCOPE
@@step scope
Project [PROGETTO]. Deposit [ACCONTO]%, balance [SALDO]%.

## CONDITIONS
@@step conditions
Venue [SEDE].

## COSTS
@@step costs
@@costs position unit
@@line canone yearly | Yearly fee | unit=? | qty=1
@@total **TOTAL**
@@end

@@annex SLA Service level

Intro text.

## Parameters
@@step annexes
Level [LIVELLO].

@@field CLIENTE
label: Client
source: client

@@field PROGETTO
label: Project

@@field ACCONTO
label: Deposit
kind: percentage
default: 50

@@field SALDO
label: Balance
kind: percentage
compute: 100 - ACCONTO

@@field SEDE
label: Venue

@@field LIVELLO
label: Level
`

const parsed = parseTemplate(SOURCE)
const ast = parsed.ast
const context: WizardContext = { ...sampleContext('en'), estimate: null }

function Form({
  start,
  serverIssues,
  first = 'preview',
}: {
  start?: (answers: WizardAnswers) => WizardAnswers
  serverIssues?: { missing: Issue[]; invalid: (Issue & { code: string })[] } | null
  first?: WizardStep
}) {
  const [step, setStep] = useState<WizardStep>(first)
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
        serverIssues={serverIssues}
      />
      <output data-testid="answers">{JSON.stringify(answers)}</output>
    </>
  )
}

afterEach(cleanup)

const issuesCard = () => screen.getByRole('region', { name: t.issues.title })
const focusedField = () => document.activeElement?.closest('[data-wizard-field]')?.getAttribute('data-wizard-field')

describe('the issues list (AC-3.4, AC-3.6)', () => {
  it('parses the fixture without problems', () => {
    expect(parsed.problems).toEqual([])
  })

  it('lists every missing field with its label and step, and every invalid answer with its reason', () => {
    render(
      <Form start={(a) => ({ ...setField(ast, a, 'ACCONTO', 130), client: { ...a.client, date: '2999-01-01' } })} />,
    )
    const resolved = resolveOffer(ast, setField(ast, initialAnswers(ast, context), 'ACCONTO', 130), context)
    const card = within(issuesCard())
    // missing: exactly what the engine says, label — step
    for (const issue of resolved.missing) {
      const label = issue.label ?? t.issues.costExtra
      expect(card.getByRole('button', { name: t.issues.item(label, t.steps[issue.step]) })).toBeTruthy()
    }
    expect(card.getByRole('button', { name: t.issues.item('Project', t.steps.scope) })).toBeTruthy()
    expect(card.getByRole('button', { name: t.issues.item('Venue', t.steps.conditions) })).toBeTruthy()
    expect(card.getByRole('button', { name: t.issues.item('Level', t.steps.annexes) })).toBeTruthy()
    expect(card.getByText(t.issues.missing(resolved.missing.length))).toBeTruthy()
    // invalid: label — reason; the derived Balance (-30) is invalid, never missing
    expect(card.getByRole('button', { name: t.issues.invalidItem('Deposit', t.invalid.out_of_range) })).toBeTruthy()
    expect(card.getByRole('button', { name: t.issues.invalidItem('Balance', t.invalid.out_of_range) })).toBeTruthy()
    expect(card.queryByRole('button', { name: t.issues.item('Balance', t.steps.scope) })).toBeNull()
    expect(resolved.missing.some((issue) => issue.name === 'SALDO')).toBe(false)
  })

  it('names the printed date with the strings module when the issue has no label', () => {
    render(<Form start={(a) => ({ ...a, client: { ...a.client, date: '2999-01-01' } })} />)
    expect(
      within(issuesCard()).getByRole('button', {
        name: t.issues.invalidItem(t.client.dateInput, t.invalid.date_out_of_range),
      }),
    ).toBeTruthy()
  })

  it('says nothing is missing when both lists are empty', () => {
    render(
      <Form
        start={(a) => {
          let next = a
          for (const name of ['PROGETTO', 'SEDE', 'LIVELLO']) next = setField(ast, next, name, 'x')
          return {
            ...next,
            costs: { ...next.costs, lines: { canone: { unitCents: 1000, quantity: 1 } } },
          }
        }}
      />,
    )
    const resolved = resolveOffer(ast, JSON.parse(screen.getByTestId('answers').textContent!) as WizardAnswers, context)
    expect([...resolved.missing, ...resolved.invalid]).toEqual([])
    expect(within(issuesCard()).getByRole('status').textContent).toContain(t.issues.none)
    expect(within(issuesCard()).queryByRole('button')).toBeNull()
  })

  it('replaces both lists with a 422 body, as it is', () => {
    render(
      <Form
        serverIssues={{
          missing: [{ name: 'SEDE', label: 'Venue', step: 'conditions' }],
          invalid: [{ name: 'cost:extra:abc', label: null, step: 'costs', code: 'discounts_exceed_span' }],
        }}
      />,
    )
    const card = within(issuesCard())
    expect(card.getAllByRole('button')).toHaveLength(2)
    expect(card.getByRole('button', { name: t.issues.item('Venue', t.steps.conditions) })).toBeTruthy()
    expect(
      card.getByRole('button', { name: t.issues.invalidItem(t.issues.costExtra, t.invalid.discounts_exceed_span) }),
    ).toBeTruthy()
    expect(card.queryByRole('button', { name: /Project/ })).toBeNull()
  })

  it('gives a reason of a code this version does not know a neutral one', () => {
    render(
      <Form
        serverIssues={{ missing: [], invalid: [{ name: 'cost:*', label: null, step: 'costs', code: 'a_future_code' }] }}
      />,
    )
    expect(
      within(issuesCard()).getByRole('button', {
        name: t.issues.invalidItem(t.issues.costTable, t.issues.unknownReason),
      }),
    ).toBeTruthy()
  })
})

describe('selecting an issue (AC-3.4, AC-3.6)', () => {
  const select = async (name: string) => {
    const user = userEvent.setup()
    await user.click(within(issuesCard()).getByRole('button', { name }))
  }

  it('opens the step of a missing field and focuses its control', async () => {
    render(<Form />)
    await select(t.issues.item('Venue', t.steps.conditions))
    expect(screen.getByRole('tab', { name: new RegExp(t.steps.conditions) }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(focusedField()).toBe('SEDE'))
    expect(document.activeElement?.tagName).toBe('INPUT')
  })

  it('opens the step of an invalid derived field and focuses it', async () => {
    render(<Form start={(a) => setField(ast, a, 'ACCONTO', 130)} />)
    await select(t.issues.invalidItem('Balance', t.invalid.out_of_range))
    await waitFor(() => expect(focusedField()).toBe('SALDO'))
    expect((document.activeElement as HTMLInputElement).readOnly).toBe(true)
  })

  it('opens the Costs step on a cost line and focuses its card', async () => {
    render(<Form />)
    await select(t.issues.item('Yearly fee', t.steps.costs))
    await waitFor(() => expect(focusedField()).toBe('cost:canone'))
  })

  it('opens the Client step on the printed date and focuses its input', async () => {
    render(<Form start={(a) => ({ ...a, client: { ...a.client, date: '2999-01-01' } })} />)
    await select(t.issues.invalidItem(t.client.dateInput, t.invalid.date_out_of_range))
    await waitFor(() => expect(focusedField()).toBe('client:date'))
    expect(screen.getByRole('tab', { name: new RegExp(t.steps.client) }).getAttribute('aria-selected')).toBe('true')
  })

  it('focuses the Edit text button of a section whose hand edit is too long, without leaving the step', async () => {
    render(
      <Form
        start={(a) => ({
          ...a,
          handEdits: { 'SCOPE#0': { heading: 'SCOPE', body: 'x'.repeat(20_001), sourceHeading: 'SCOPE' } },
        })}
      />,
    )
    const button = within(issuesCard()).getByRole('button', {
      name: t.issues.invalidItem('SCOPE', t.invalid.section_too_long),
    })
    await userEvent.setup().click(button)
    await waitFor(() => expect(focusedField()).toBe('section:SCOPE#0'))
    expect(document.activeElement?.getAttribute('aria-label')).toBe(t.sections.edit('SCOPE'))
    expect(screen.getByRole('tab', { name: new RegExp(t.steps.preview) }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('the sections table (S7)', () => {
  it('lists the contract sections and the annex sections with an Edit text button each', () => {
    render(<Form />)
    const table = screen.getByRole('table', { name: t.sections.caption })
    for (const heading of ['SCOPE', 'CONDITIONS', 'COSTS', 'Parameters']) {
      expect(within(table).getByRole('rowheader', { name: new RegExp(heading) })).toBeTruthy()
      expect(within(table).getByRole('button', { name: t.sections.edit(heading) })).toBeTruthy()
    }
    // the opening and the salutation are not sections (DD-17)
    expect(within(table).queryByText(/Opening/)).toBeNull()
  })

  it('marks a section whose text is too long', () => {
    render(
      <Form
        start={(a) => ({
          ...a,
          handEdits: { 'SCOPE#0': { heading: 'SCOPE', body: 'x'.repeat(20_001), sourceHeading: 'SCOPE' } },
        })}
      />,
    )
    const row = screen.getByRole('rowheader', { name: /SCOPE/ }).closest('tr') as HTMLElement
    expect(within(row).getByText(t.sections.tooLong)).toBeTruthy()
  })
})
