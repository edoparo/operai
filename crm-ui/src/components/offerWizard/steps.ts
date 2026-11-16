/**
 * Which steps the wizard lists and what each still needs (specs/20261115-crm-offer-wizard AC-1.2, AC-3.5; DD-43).
 * Pure: the steps come from `outline(ast, answers)` and the counts from `ResolvedOffer`, never re-derived here.
 */
import type { WizardContext } from '../../lib/offerEngine/answers'
import type { Outline } from '../../lib/offerEngine/outline'
import type { ResolvedOffer } from '../../lib/offerEngine/resolve'
import { STEP_KEYS, type StepKey } from '../../lib/offerEngine/syntax'

/** A tab of the wizard: the template pick, a form step, or the final check. */
export type WizardStep = 'template' | StepKey | 'preview'

export type WizardMode = 'deal' | 'sample'

/**
 * The steps in order. The Template step exists only for a deal (the editor's Try view has no deal); Client
 * always (the client block, place and date belong to every offer); a template step only when the outline has
 * something to ask there; Annexes also when the deal has an estimate or PDFs to offer; Preview last.
 */
export function wizardSteps(outline: Outline, mode: WizardMode, context: WizardContext): WizardStep[] {
  const asked = new Set<StepKey>(outline.steps.map((step) => step.key))
  const steps: WizardStep[] = mode === 'deal' ? ['template'] : []
  for (const stepKey of STEP_KEYS) {
    const shown =
      stepKey === 'client' ||
      asked.has(stepKey) ||
      (stepKey === 'annexes' && (context.estimate !== null || context.attachments.length > 0))
    if (shown) steps.push(stepKey)
  }
  steps.push('preview')
  return steps
}

export interface IssueCounts {
  readonly missing: number
  readonly invalid: number
  /** Missing plus to correct, per step; the Preview step holds the total. */
  readonly byStep: Readonly<Partial<Record<WizardStep, number>>>
}

export function issueCounts(resolved: ResolvedOffer): IssueCounts {
  const byStep: Partial<Record<WizardStep, number>> = {}
  for (const issue of [...resolved.missing, ...resolved.invalid]) byStep[issue.step] = (byStep[issue.step] ?? 0) + 1
  byStep.preview = resolved.missing.length + resolved.invalid.length
  return { missing: resolved.missing.length, invalid: resolved.invalid.length, byStep }
}
