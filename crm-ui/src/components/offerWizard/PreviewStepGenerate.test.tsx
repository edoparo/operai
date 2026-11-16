/**
 * @vitest-environment jsdom
 *
 * The Preview step's Generate and deal facts (specs/20261115-crm-offer-wizard, QE D3; design S7 items 1 and 4):
 * Generate also sits in the "Before you can generate" card, with the count text, and is the action bar's own control
 * (same handler, same blocked state); the deal context line lists template, language, currency, validity, effort
 * annex and PDFs.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OfferWizard from './OfferWizard'
import { initialAnswers, sampleAnswers, sampleContext, type WizardAnswers } from '../../lib/offerEngine/answers'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'

const t = strings.offerWizard

const SOURCE = `@@salutation Dear
@@acceptance The Client

Opening for [CLIENTE].

## SCOPE
@@step scope
Project [PROGETTO].

@@field CLIENTE
label: Client
source: client

@@field PROGETTO
label: Project
`

const ast = parseTemplate(SOURCE).ast
const context = { ...sampleContext('en'), estimate: null }

function Harness({
  complete = false,
  mode = 'deal',
  onGenerate,
  generateBlockedReason,
  generating,
  withTemplate = true,
  tweak,
}: {
  complete?: boolean
  mode?: 'deal' | 'sample'
  onGenerate?: () => void
  generateBlockedReason?: string
  generating?: boolean
  withTemplate?: boolean
  tweak?: (a: WizardAnswers) => WizardAnswers
}) {
  const [answers, setAnswers] = useState(() => {
    const base = complete ? sampleAnswers(ast, 'en') : initialAnswers(ast, context)
    return tweak ? tweak(base) : base
  })
  return (
    <OfferWizard
      mode={mode}
      ast={ast}
      answers={answers}
      onAnswersChange={setAnswers}
      context={context}
      step="preview"
      onStepChange={() => undefined}
      onGenerate={onGenerate}
      generateBlockedReason={generateBlockedReason}
      generating={generating}
      {...(withTemplate ? { templateName: 'Progetto a corpo' } : {})}
    />
  )
}

afterEach(cleanup)

const card = () => screen.getByRole('region', { name: t.issues.title })
const bar = () => screen.getByTestId('offer-wizard-action-bar')

describe('Generate in the issues card (S7.1)', () => {
  it('sits in the card with the count text, blocked like the bar while anything is missing', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn()
    render(<Harness onGenerate={onGenerate} />)
    const generate = within(card()).getByRole('button', { name: t.bar.generate })
    expect(generate.getAttribute('aria-disabled')).toBe('true')
    expect(within(card()).getByText(t.bar.counts(1, 0))).toBeTruthy()
    expect(generate.getAttribute('aria-describedby')).toBeTruthy()
    await user.click(generate)
    expect(onGenerate).not.toHaveBeenCalled()
    // the bar's button is in the same state
    expect(within(bar()).getByRole('button', { name: t.bar.generate }).getAttribute('aria-disabled')).toBe('true')
  })

  it('calls the one generate handler when nothing is missing', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn()
    render(<Harness complete onGenerate={onGenerate} />)
    const generate = within(card()).getByRole('button', { name: t.bar.generate })
    expect(generate.getAttribute('aria-disabled')).toBeNull()
    await user.click(generate)
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('carries the page’s extra blocking reason and the in-progress state, as the bar does', () => {
    const { rerender } = render(<Harness complete generateBlockedReason="No ready estimate" />)
    expect(within(card()).getAllByText('No ready estimate').length).toBeGreaterThan(0)
    expect(within(card()).getByRole('button', { name: t.bar.generate }).getAttribute('aria-disabled')).toBe('true')
    rerender(<Harness complete generating />)
    expect(within(card()).getByRole('button', { name: t.bar.generating }).getAttribute('aria-busy')).toBe('true')
    // the polite "generating" line is announced once, by the bar
    expect(screen.getAllByText(t.bar.generatingLive)).toHaveLength(1)
  })

  it('with nothing missing says the reason instead of "you can generate" (G15), once in words and once for the button', () => {
    render(<Harness complete generateBlockedReason="No ready estimate" />)
    expect(within(card()).queryByText(t.issues.none)).toBeNull()
    const shown = within(card())
      .getAllByText('No ready estimate')
      .filter((node) => node.closest('.sr-only') === null)
    expect(shown).toHaveLength(1)
    const generate = within(card()).getByRole('button', { name: t.bar.generate })
    const described = document.getElementById(generate.getAttribute('aria-describedby')!)
    expect(described?.textContent).toBe('No ready estimate')
  })

  it('with answers still missing keeps the lists and shows the reason beside the button once', () => {
    render(<Harness generateBlockedReason="No ready estimate" />)
    expect(within(card()).getAllByText('No ready estimate')).toHaveLength(1)
    expect(within(card()).getByText(t.bar.counts(1, 0))).toBeTruthy()
  })

  it('is not offered in the editor’s sample mode, where there is no deal', () => {
    render(<Harness mode="sample" complete />)
    expect(within(card()).queryByRole('button', { name: t.bar.generate })).toBeNull()
  })
})

describe('the deal context line (S7.4)', () => {
  it('lists template, language, currency, validity, effort annex and PDFs', () => {
    render(
      <Harness complete tweak={(a) => ({ ...a, validityDays: 45, effortAnnex: true, attachmentIds: ['a', 'b'] })} />,
    )
    const facts = screen.getByTestId('crm-wizard-facts')
    const w = within(facts)
    const valueOf = (term: string) => w.getByText(term).closest('div')!.querySelector('dd')!.textContent
    expect(valueOf(t.facts.template)).toBe('Progetto a corpo')
    expect(valueOf(t.facts.language)).toBe(t.facts.languageName.en)
    expect(valueOf(t.facts.currency)).toBe(context.currency)
    expect(valueOf(t.facts.validity)).toBe(t.facts.days(45))
    expect(valueOf(t.facts.effortAnnex)).toBe(t.facts.included)
    expect(valueOf(t.facts.pdfs)).toBe('2')
  })

  it('says the effort annex is not included when it is off', () => {
    render(<Harness complete tweak={(a) => ({ ...a, effortAnnex: false })} />)
    const facts = within(screen.getByTestId('crm-wizard-facts'))
    expect(facts.getByText(t.facts.effortAnnex).closest('div')!.querySelector('dd')!.textContent).toBe(
      t.facts.notIncluded,
    )
  })

  it('is absent without a deal (no template name)', () => {
    render(<Harness complete withTemplate={false} />)
    expect(screen.queryByTestId('crm-wizard-facts')).toBeNull()
  })
})
