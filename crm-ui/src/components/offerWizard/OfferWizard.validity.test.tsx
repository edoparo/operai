/**
 * @vitest-environment jsdom
 *
 * The offer validity in the whole wizard (specs/20261115-crm-offer-wizard AC-3.5, AC-3.6; QE D14): a blank,
 * unreadable or out-of-range validity is never handed to the draft (the server refuses it and autosave stops), is
 * shown invalid on the field, counts on the Preview step by the field's name and blocks Generate with that reason.
 * Driven with the real step panels, through the tabs, the way a person does.
 */
import { useMemo, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OfferWizard from './OfferWizard'
import { sampleAnswers, sampleContext, type WizardAnswers } from '../../lib/offerEngine/answers'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'

const t = strings.offerWizard

const CARD_TEMPLATE = `@@salutation Dear

## SCOPE
@@step scope
We deliver [OGGETTO].

## COSTS
@@step costs
@@costs position unit
@@line main one_off | Work | unit=1000 | qty=1
@@total **TOTAL**
@@end

@@field OGGETTO
label: Object
`

const BOUND_TEMPLATE = `${CARD_TEMPLATE}
@@field DURATA
label: Validità offerta
kind: number
source: validityDays
step: scope
`.replace('We deliver [OGGETTO].', 'We deliver [OGGETTO], valid [DURATA] days.')

const context = { ...sampleContext('en'), estimate: null }

function Harness({
  source,
  onSave,
  onGenerate,
}: {
  source: string
  onSave: (answers: WizardAnswers) => void
  onGenerate: () => void
}) {
  const ast = useMemo(() => parseTemplate(source).ast, [source])
  const [answers, setAnswers] = useState<WizardAnswers>(() => sampleAnswers(ast, 'en'))
  return (
    <OfferWizard
      mode="deal"
      ast={ast}
      answers={answers}
      onAnswersChange={(next) => {
        onSave(next)
        setAnswers(next)
      }}
      context={context}
      onGenerate={onGenerate}
    />
  )
}

afterEach(cleanup)

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const accepted = (days: unknown) => typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= 365
const tab = (name: RegExp) => screen.getByRole('tab', { name })
const issuesCard = () => screen.getByRole('region', { name: t.issues.title })

async function setup(source: string) {
  const user = userEvent.setup()
  const saved: WizardAnswers[] = []
  const onGenerate = vi.fn()
  render(<Harness source={source} onSave={(next) => saved.push(next)} onGenerate={onGenerate} />)
  return { user, saved, onGenerate }
}

describe('the Costs card validity (no template field bound to it)', () => {
  const field = () =>
    screen.getByRole('textbox', { name: new RegExp(`^${escape(t.costs.validity)}`) }) as HTMLInputElement

  it.each([
    ['blank', '', t.invalid.required, 'missing'],
    ['letters', '4a5', t.invalid.not_integer, 'invalid'],
    ['a decimal', '4.5', t.invalid.not_integer, 'invalid'],
    ['zero', '0', t.invalid.days_out_of_range, 'invalid'],
    ['more than a year', '366', t.invalid.days_out_of_range, 'invalid'],
  ])('%s: nothing is saved, the field and the Preview name it, Generate waits', async (_n, typed, reason, kind) => {
    const { user, saved, onGenerate } = await setup(CARD_TEMPLATE)
    await user.click(tab(/^Costs/))
    await user.clear(field())
    if (typed !== '') await user.type(field(), typed)
    await user.tab()
    expect(saved.filter((answers) => !accepted(answers.validityDays))).toEqual([])
    expect(field().getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText(reason)).toBeTruthy()

    await user.click(tab(/^Preview/))
    const named = within(issuesCard()).getByRole('button', { name: new RegExp(escape(t.costs.validity)) })
    expect(named.textContent).toContain(kind === 'missing' ? t.steps.costs : reason)
    const generate = within(issuesCard()).getByRole('button', { name: t.bar.generate })
    expect(generate.getAttribute('aria-disabled')).toBe('true')
    await user.click(generate)
    expect(onGenerate).not.toHaveBeenCalled()

    // the entry is still there when the step is opened again, and the issue's link takes the person to it
    await user.click(named)
    await waitFor(() => expect(document.activeElement).toBe(field()))
    expect(field().value).toBe(typed)
  })

  it('a valid number replaces the entry: saved, no issue, Generate ready', async () => {
    const { user, saved, onGenerate } = await setup(CARD_TEMPLATE)
    await user.click(tab(/^Costs/))
    await user.clear(field())
    await user.type(field(), '45')
    expect(saved.at(-1)?.validityDays).toBe(45)
    await user.click(tab(/^Preview/))
    expect(within(issuesCard()).getByText(t.issues.none)).toBeTruthy()
    await user.click(within(issuesCard()).getByRole('button', { name: t.bar.generate }))
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })
})

describe('a template field bound to the validity', () => {
  it('is the same control: refused values are held, named by the template label, and block Generate', async () => {
    const { user, saved, onGenerate } = await setup(BOUND_TEMPLATE)
    const field = () => screen.getByRole('textbox', { name: /^Validità offerta/ }) as HTMLInputElement
    await user.click(tab(/^Scope/))
    await user.clear(field())
    await user.type(field(), '999')
    expect(saved.filter((answers) => !accepted(answers.validityDays))).toEqual([])
    await user.click(tab(/^Preview/))
    const named = within(issuesCard()).getByRole('button', { name: /Validità offerta/ })
    expect(named.textContent).toContain(t.invalid.days_out_of_range)
    await user.click(within(issuesCard()).getByRole('button', { name: t.bar.generate }))
    expect(onGenerate).not.toHaveBeenCalled()
    await user.click(named)
    await waitFor(() => expect(document.activeElement).toBe(field()))
  })
})
