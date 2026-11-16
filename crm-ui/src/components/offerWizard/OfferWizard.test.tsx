/**
 * @vitest-environment jsdom
 *
 * The wizard's frame (specs/20261115-crm-offer-wizard T41; AC-1.2, AC-1.6, AC-3.5): step tabs from `outline()`,
 * Back/Next and tab jumps that keep every answer, the action bar's Generate with its counts, the save status.
 * The step panels are built by later tasks, so these tests put a plain input in the panel through `renderStep`.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OfferWizard, { type OfferWizardProps } from './OfferWizard'
import SaveStatus from './SaveStatus'
import TemplateText from './TemplateText'
import {
  initialAnswers,
  sampleAnswers,
  sampleContext,
  setField,
  type WizardAnswers,
} from '../../lib/offerEngine/answers'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'

const t = strings.offerWizard

const WITH_CONDITIONS = `@@salutation Dear

## SCOPE
@@step scope
We deliver [OGGETTO].

## TERMS
@@step conditions
Payment: [PAGAMENTO].

## COSTS
@@step costs
@@costs position unit
@@line main one_off | Work | unit=? | qty=1
@@total **TOTAL**
@@end

@@field OGGETTO
label: Object

@@field PAGAMENTO
label: Payment
`

const WITHOUT_CONDITIONS = WITH_CONDITIONS.replace('Payment: [PAGAMENTO].', 'Payment: net 30.').replace(
  '@@field PAGAMENTO\nlabel: Payment\n',
  '',
)

// no estimate and no PDFs: the Annexes step has nothing to offer
const context = { ...sampleContext('en'), estimate: null }

type HarnessProps = Partial<OfferWizardProps> & { source?: string; complete?: boolean }

function Harness({ source = WITH_CONDITIONS, complete = false, ...rest }: HarnessProps) {
  const ast = useMemo(() => parseTemplate(source).ast, [source])
  const [answers, setAnswers] = useState<WizardAnswers>(() =>
    complete ? sampleAnswers(ast, 'en') : initialAnswers(ast, context),
  )
  return (
    <OfferWizard
      mode="sample"
      ast={ast}
      answers={answers}
      onAnswersChange={setAnswers}
      context={context}
      renderStep={({ step }): ReactNode =>
        step === 'scope' ? (
          <label>
            Object input
            <input
              value={String(answers.fields.OGGETTO ?? '')}
              onChange={(event) => setAnswers(setField(ast, answers, 'OGGETTO', event.target.value))}
            />
          </label>
        ) : (
          <p>{`panel ${step}`}</p>
        )
      }
      {...rest}
    />
  )
}

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent ?? '')

afterEach(cleanup)

describe('OfferWizard — the steps (AC-1.2)', () => {
  it('lists a step only when the template asks for something in it', () => {
    const { unmount } = render(<Harness />)
    expect(tabNames()).toEqual([
      expect.stringContaining(t.steps.client),
      expect.stringContaining(t.steps.scope),
      expect.stringContaining(t.steps.conditions),
      expect.stringContaining(t.steps.costs),
      expect.stringContaining(t.steps.preview),
    ])
    unmount()

    render(<Harness source={WITHOUT_CONDITIONS} />)
    expect(screen.queryByRole('tab', { name: new RegExp(t.steps.conditions) })).toBeNull()
    expect(screen.getByRole('tab', { name: new RegExp(t.steps.scope) })).not.toBeNull()
  })

  it('lists Annexes when the deal has an estimate or a PDF to offer, though the template asks nothing there', () => {
    function WithPdf() {
      const ast = useMemo(() => parseTemplate(WITH_CONDITIONS).ast, [])
      const withPdf = { ...context, attachments: [{ id: 'f1', fileName: 'brochure.pdf', sizeBytes: 1000 }] }
      return (
        <OfferWizard
          mode="sample"
          ast={ast}
          answers={initialAnswers(ast, withPdf)}
          onAnswersChange={() => undefined}
          context={withPdf}
          renderStep={() => null}
        />
      )
    }
    render(<WithPdf />)
    expect(tabNames().some((name) => name.includes(t.steps.annexes))).toBe(true)
  })

  it('shows the Template step only in deal mode', () => {
    const { unmount } = render(<Harness mode="deal" />)
    expect(tabNames()[0]).toContain(t.steps.template)
    unmount()
    render(<Harness mode="sample" />)
    expect(screen.queryByRole('tab', { name: new RegExp(t.steps.template) })).toBeNull()
  })

  it('counts what each step still needs, in text for assistive technology too', () => {
    render(<Harness />)
    const scope = screen.getByRole('tab', { name: new RegExp(t.steps.scope) })
    expect(scope.textContent).toContain('1')
    expect(within(scope).getByText(t.steps.count(1))).not.toBeNull()
    const tabCount = (name: string) => screen.getByRole('tab', { name: new RegExp(name) })
    expect(within(tabCount(t.steps.preview)).getByText(t.steps.count(3))).not.toBeNull()
  })
})

describe('OfferWizard — moving never loses an answer (AC-1.6)', () => {
  it('keeps what was typed in step 2 after a jump to step 4 and back, by tab and by Back', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('tab', { name: new RegExp(t.steps.scope) }))
    await user.type(screen.getByLabelText('Object input'), 'Website')

    await user.click(screen.getByRole('tab', { name: new RegExp(t.steps.costs) }))
    expect(screen.getByText('panel costs')).not.toBeNull()
    await user.click(screen.getByRole('tab', { name: new RegExp(t.steps.scope) }))
    expect((screen.getByLabelText('Object input') as HTMLInputElement).value).toBe('Website')

    // Next, Next (Costs), then Back, Back (Scope)
    await user.click(screen.getByRole('button', { name: t.bar.next }))
    await user.click(screen.getByRole('button', { name: t.bar.next }))
    expect(screen.getByText('panel costs')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: t.bar.back }))
    await user.click(screen.getByRole('button', { name: t.bar.back }))
    expect((screen.getByLabelText('Object input') as HTMLInputElement).value).toBe('Website')
  })

  it('moves focus to the new panel heading after Next, and reports the step to the parent', async () => {
    const user = userEvent.setup()
    const onStepChange = vi.fn()
    render(<Harness onStepChange={onStepChange} />)
    await user.click(screen.getByRole('button', { name: t.bar.next }))
    expect(onStepChange).toHaveBeenLastCalledWith('scope')
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: t.steps.scope }))
  })

  it('has no Back on the first step and shows where the person is', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.getByRole('button', { name: t.bar.back }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(t.bar.stepOf(1, 5, t.steps.client))).not.toBeNull()
    await user.click(screen.getByRole('button', { name: t.bar.next }))
    expect(screen.getByText(t.bar.stepOf(2, 5, t.steps.scope))).not.toBeNull()
    expect(screen.getByRole('progressbar', { name: t.bar.progress }).getAttribute('aria-valuenow')).toBe('2')
  })

  it('follows a controlled step', () => {
    render(<Harness step="costs" onStepChange={() => undefined} />)
    expect(screen.getByText('panel costs')).not.toBeNull()
    expect(screen.getByRole('tab', { name: new RegExp(t.steps.costs) }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('OfferWizard — Generate (AC-3.5)', () => {
  it('is aria-disabled with the counts while anything is missing, and ignores the click', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn()
    render(<Harness mode="deal" step="preview" onStepChange={() => undefined} onGenerate={onGenerate} />)
    const generate = screen.getByRole('button', { name: new RegExp(t.bar.generate) })
    expect(generate.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getAllByText(t.bar.counts(3, 0)).length).toBeGreaterThan(0)
    expect(generate.getAttribute('aria-describedby')).toBeTruthy()
    await user.click(generate)
    expect(onGenerate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: t.bar.next })).toBeNull()
  })

  it('counts invalid answers as to correct', () => {
    // a percentage out of range is an answer to correct, not a missing one
    const source = `${WITH_CONDITIONS}
@@field QUOTA
label: Share
kind: percentage
`.replace('Payment: [PAGAMENTO].', 'Payment: [PAGAMENTO] [QUOTA].')
    function Wrong() {
      const ast = useMemo(() => parseTemplate(source).ast, [])
      const answers = sampleAnswers(ast, 'en')
      answers.fields.QUOTA = '150'
      return (
        <OfferWizard
          mode="deal"
          step="preview"
          onStepChange={() => undefined}
          ast={ast}
          answers={answers}
          onAnswersChange={() => undefined}
          context={context}
          onGenerate={() => undefined}
          renderStep={() => null}
        />
      )
    }
    render(<Wrong />)
    expect(screen.getAllByText(t.bar.counts(0, 1)).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: new RegExp(t.bar.generate) }).getAttribute('aria-disabled')).toBe('true')
  })

  it('works once nothing is missing or invalid', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn()
    render(<Harness mode="deal" complete step="preview" onStepChange={() => undefined} onGenerate={onGenerate} />)
    const generate = screen.getByRole('button', { name: new RegExp(t.bar.generate) })
    expect(generate.getAttribute('aria-disabled')).toBeNull()
    await user.click(generate)
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('does not offer Generate in the editor’s sample mode', () => {
    render(<Harness mode="sample" complete step="preview" onStepChange={() => undefined} />)
    expect(screen.queryByRole('button', { name: new RegExp(t.bar.generate) })).toBeNull()
  })

  it('shows a generate in progress and the extra reason the page gives', () => {
    render(
      <Harness
        mode="deal"
        complete
        step="preview"
        onStepChange={() => undefined}
        generating
        generateBlockedReason="No ready estimate"
      />,
    )
    const generate = screen.getByRole('button', { name: new RegExp(t.bar.generating) })
    expect(generate.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText(t.bar.generatingLive)).not.toBeNull()
    expect(screen.getByText('No ready estimate')).not.toBeNull()
  })

  it('offers Preview in the bar when the page can open it', async () => {
    const user = userEvent.setup()
    const onOpenPreview = vi.fn()
    render(<Harness onOpenPreview={onOpenPreview} />)
    await user.click(screen.getByRole('button', { name: t.bar.preview }))
    expect(onOpenPreview).toHaveBeenCalled()
  })
})

describe('OfferWizard — read-only', () => {
  it('disables the form but keeps the steps and the bar usable', async () => {
    const user = userEvent.setup()
    render(<Harness readOnly step="scope" onStepChange={() => undefined} />)
    expect(screen.getByLabelText('Object input').matches(':disabled')).toBe(true)
    expect(screen.getByRole('tab', { name: new RegExp(t.steps.costs) }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: t.bar.next }).hasAttribute('disabled')).toBe(false)
    await user.click(screen.getByRole('button', { name: t.bar.next }))
  })
})

describe('SaveStatus', () => {
  it('says what is true, with the time as a title once saved', () => {
    const { rerender } = render(<SaveStatus state="saving" />)
    expect(screen.getByText(t.save.saving)).not.toBeNull()
    rerender(<SaveStatus state="saved" savedAt="2026-11-15T10:00:00.000Z" />)
    // the visible line and, once it is spoken, the hidden live region both carry the text
    expect(screen.getAllByText(t.save.saved).some((node) => node.closest('[title]') !== null)).toBe(true)
    rerender(<SaveStatus state="retrying" />)
    expect(screen.getAllByText(t.save.retrying).length).toBeGreaterThan(0)
  })

  it('announces a saved state at most once every ten seconds, a retry at once', () => {
    vi.useFakeTimers()
    try {
      const { rerender, container } = render(<SaveStatus state="saving" />)
      const live = () => container.querySelector('[aria-live="polite"]')?.textContent ?? ''
      rerender(<SaveStatus state="saved" />)
      expect(live()).toBe(t.save.saved)
      rerender(<SaveStatus state="saving" />)
      act(() => {
        vi.advanceTimersByTime(3_000)
      })
      rerender(<SaveStatus state="saved" />)
      // the second "saved" within ten seconds is not announced again: the line still holds the first
      expect(live()).toBe(t.save.saved)
      rerender(<SaveStatus state="retrying" />)
      expect(live()).toBe(t.save.retrying)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('TemplateText', () => {
  it('marks the language when the template differs from the interface language', () => {
    const { container, rerender } = render(<TemplateText language="it">Oggetto</TemplateText>)
    expect(container.querySelector('[lang="it"]')?.textContent).toBe('Oggetto')
    rerender(<TemplateText language="en">Object</TemplateText>)
    expect(container.querySelector('[lang]')).toBeNull()
  })
})
