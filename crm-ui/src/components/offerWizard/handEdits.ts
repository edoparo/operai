import type { WizardAnswers } from '../../lib/offerEngine/answers'
import type { ResolvedOffer, ResolvedSection } from '../../lib/offerEngine/resolve'
import { splitMarked } from './splitMarked'

/** The limits of a hand-edited section (AC-5.4): the resolver's own, the dialog enforces them before saving. */
export const MAX_EDIT_HEADING = 120
export const MAX_EDIT_BODY = 20_000

/** One line of the Sections table: a contract section or an annex's section, in document order. */
export interface SectionRow {
  readonly section: ResolvedSection
  /** The annex it belongs to (its title), null for a contract section. */
  readonly annex: string | null
}

/** Every hand-editable section the offer prints: the contract's, then each annex's (DD-17: not the opening or salutation). */
export function sectionRows(resolved: ResolvedOffer): SectionRow[] {
  return [
    ...resolved.sections.map((section) => ({ section, annex: null })),
    ...resolved.annexes.flatMap((annex) => annex.sections.map((section) => ({ section, annex: annex.title }))),
  ]
}

/** A plain surface as one string for a name or label: markers become the visible "⟦Label⟧". */
export function plainText(text: string): string {
  return splitMarked(text)
    .map((piece) => (piece.kind === 'text' ? piece.text : `⟦${piece.label}⟧`))
    .join('')
}

/** A hand edit's key is the template's heading text + "#" + occurrence (DD-17); its source heading is the first part. */
const sourceHeadingOf = (key: string): string => key.replace(/#\d+$/, '')

/** The answers with `key`'s text written by hand; every other answer is untouched, so no field change reaches it (AC-5.2). */
export function withHandEdit(answers: WizardAnswers, key: string, heading: string, body: string): WizardAnswers {
  return {
    ...answers,
    handEdits: { ...answers.handEdits, [key]: { heading, body, sourceHeading: sourceHeadingOf(key) } },
  }
}

/** The answers with `key` following the wizard's text again (AC-5.3). */
export function withoutHandEdit(answers: WizardAnswers, key: string): WizardAnswers {
  const rest = { ...answers.handEdits }
  delete rest[key]
  return { ...answers, handEdits: rest }
}
