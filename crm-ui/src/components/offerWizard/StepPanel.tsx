/**
 * The step dispatch (specs/20261115-crm-offer-wizard T41): one `case` per step, each added by the task that
 * builds the step. Shared and append-only — T42 (Scope, Conditions), T44 (Costs), T45 (Client, Annexes), T47
 * (Preview) and T49 (Template) each add their own case and touch nothing else here.
 */
import type { ReactNode, Ref } from 'react'
import type { WizardAnswers, WizardContext } from '../../lib/offerEngine/answers'
import type { Outline } from '../../lib/offerEngine/outline'
import type { Issue, ResolvedOffer } from '../../lib/offerEngine/resolve'
import type { TemplateAst } from '../../lib/offerEngine/syntax'
import AnnexesStep from './AnnexesStep'
import ClientStep from './ClientStep'
import CostTableEditor from './CostTableEditor'
import type { GenerateState } from './GenerateControl'
import type { IssueWithCode } from './IssuesList'
import PreviewStep from './PreviewStep'
import StepForm from './StepForm'
import type { ValidityEntry } from './validityEntry'
import TemplateStep, { type TemplateStepProps } from './TemplateStep'
import type { WizardMode, WizardStep } from './steps'

/** What every step's panel is given: the template, the answers and how to change them, and what the engine resolved. */
export interface StepPanelProps {
  step: WizardStep
  mode: WizardMode
  ast: TemplateAst
  answers: WizardAnswers
  /** The one way an answer changes: the next answers (built by the engine's setters), never a patch. */
  onAnswersChange: (next: WizardAnswers) => void
  context: WizardContext
  outline: Outline
  resolved: ResolvedOffer
  /** Moves to another step (an issue's jump, a link to a block's step). */
  onGoToStep: (step: WizardStep) => void
  /**
   * The cost lines (by row name) whose "Discount as" choice is Percent. The stored answers cannot say "percent
   * chosen, no value yet" (`percentBp: null` is the amount mode), so the choice is kept here, above the step, to
   * survive a re-render, an autosave and a move to another step. Absent, the Costs step keeps it itself.
   */
  percentChosen?: ReadonlySet<string>
  onPercentChosen?: (next: ReadonlySet<string>) => void
  /**
   * What is typed in the validity field when it is not a valid number of days (see `ValidityEntry`): kept above the
   * step, because the answers cannot hold it. Absent, the validity control keeps its own.
   */
  validityEntry?: ValidityEntry | null
  onValidityEntry?: (entry: ValidityEntry | null) => void
  /** What the Client step says about the reference when it is not "assigned when generated" (an edit's own, a revision's next). */
  referenceNote?: string
  /** A 422 `offer_incomplete` body, as the server sent it: replaces the Preview step's two lists. */
  serverIssues?: { missing: readonly Issue[]; invalid: readonly IssueWithCode[] } | null
  /** The Preview step's "Before you can generate" heading, which a failed Generate moves focus to. */
  issuesHeadingRef?: Ref<HTMLHeadingElement>
  /**
   * Makes `next` the draft's answers and resolves once they are saved, rejecting with the failure (a conflict, a
   * network error): the hand-edit dialog stays busy meanwhile and keeps its text if it rejects. Absent, the answers
   * change through `onAnswersChange` and the dialog closes at once (the editor's Try view has no draft).
   */
  commitAnswers?: (next: WizardAnswers) => Promise<void>
  /** Generate as the action bar has it, for the Preview card's own button; absent without a deal (the editor's Try view). */
  generate?: GenerateState
  /** The draft's template name, for the Preview step's deal context line; absent without a deal. */
  templateName?: string
  /** What the Template step needs beyond the draft: the deal, the estimate gate, the unsent offer, the choose callback. */
  templateStep?: TemplateStepProps
}

export default function StepPanel(props: StepPanelProps): ReactNode {
  switch (props.step) {
    case 'scope':
    case 'conditions':
      return <StepForm {...props} items={props.outline.steps.find((step) => step.key === props.step)?.items ?? []} />
    case 'client':
      return <ClientStep {...props} />
    case 'annexes':
      return <AnnexesStep {...props} />
    case 'costs':
      return <CostTableEditor {...props} />
    case 'preview':
      return <PreviewStep {...props} />
    case 'template':
      return props.templateStep ? <TemplateStep {...props.templateStep} /> : null
    default:
      // a step whose panel is not built yet shows its heading and nothing else
      return null
  }
}
