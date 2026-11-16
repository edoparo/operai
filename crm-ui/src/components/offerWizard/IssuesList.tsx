import type { Ref } from 'react'
import { Icon } from '@operai/ui'
import type { Issue } from '../../lib/offerEngine/resolve'
import { strings } from '../../strings'
import { plainText } from './handEdits'

const t = strings.offerWizard

/** An invalid answer as the engine, or a 422 `offer_incomplete` body, reports it; an unknown code gets a neutral reason. */
export type IssueWithCode = Issue & { code: string }

export interface IssuesListProps {
  missing: readonly Issue[]
  invalid: readonly IssueWithCode[]
  /** An issue was chosen: the Preview step moves to its step and focuses the element named `issue.name`. */
  onSelect: (issue: Issue) => void
  /** The card's heading takes focus when a failed Generate asks for it (S10). */
  headingRef?: Ref<HTMLHeadingElement>
  /**
   * Why Generate is blocked beyond the answers (no ready estimate, an archived template, a blank legal name). With
   * nothing missing or to correct the card says this instead of "you can generate" (design G15).
   */
  blockedReason?: string
}

/** The words for an issue whose label is null (an extra cost line, the whole cost table, the printed date). */
function labelOf(issue: Issue): string {
  if (issue.label !== null) return plainText(issue.label)
  if (issue.name.startsWith('cost:extra:')) return t.issues.costExtra
  if (issue.name === 'client:date') return t.client.dateInput
  if (issue.name.startsWith('cost:')) return t.issues.costTable
  return t.steps[issue.step]
}

function reasonOf(code: string): string {
  return (t.invalid as Record<string, string>)[code] ?? t.issues.unknownReason
}

/**
 * "Before you can generate" (design S7): what is missing and what is to correct, each a link-styled button that
 * takes the person to the field (AC-3.4, AC-3.6). Both lists come from the same issue list; nothing here derives
 * an issue itself, so a derived field is listed only when it is invalid.
 */
export default function IssuesList({ missing, invalid, onSelect, headingRef, blockedReason }: IssuesListProps) {
  const none = missing.length === 0 && invalid.length === 0
  return (
    <>
      <h3 ref={headingRef} tabIndex={-1} className="card-title mb-3 outline-none">
        {t.issues.title}
      </h3>
      {none && blockedReason ? (
        <p role="status" className="flex items-center gap-2 text-sm text-text">
          <Icon name="alert" className="text-org" /> {blockedReason}
        </p>
      ) : none ? (
        <p role="status" className="flex items-center gap-2 text-sm text-text">
          <Icon name="check-circle" className="text-grn" /> {t.issues.none}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {missing.length > 0 ? (
            <div role="group" aria-label={t.issues.missing(missing.length)}>
              <h4 className="mb-1 text-xs text-soft">{t.issues.missing(missing.length)}</h4>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {missing.map((issue) => (
                  <li key={`m:${issue.name}`}>
                    <button type="button" className="link text-left text-sm" onClick={() => onSelect(issue)}>
                      {t.issues.item(labelOf(issue), t.steps[issue.step])}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {invalid.length > 0 ? (
            <div role="group" aria-label={t.issues.invalid(invalid.length)}>
              <h4 className="mb-1 text-xs text-soft">{t.issues.invalid(invalid.length)}</h4>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {invalid.map((issue) => (
                  <li key={`i:${issue.name}:${issue.code}`}>
                    <button type="button" className="link text-left text-sm" onClick={() => onSelect(issue)}>
                      {t.issues.invalidItem(labelOf(issue), reasonOf(issue.code))}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </>
  )
}
