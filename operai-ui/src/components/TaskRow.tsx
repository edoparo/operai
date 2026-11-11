import { useId } from 'react'
import type { ReactNode } from 'react'
import { Button } from './Button'
import { listRowClassName, listRowMetaClassName } from './ListRows'
import { StatusBadge } from './StatusBadge'
import type { StatusMeaning } from './StatusBadge'

export type TaskRowState = 'open' | 'blocked' | 'overdue' | 'done'

/** Library default; an app overrides single entries through `stateMeanings` (one map per app, INC-23). */
const DEFAULT_MEANING: Record<TaskRowState, StatusMeaning> = {
  open: 'pending',
  blocked: 'attention',
  overdue: 'attention',
  done: 'settled',
}

export type TaskRowProps = {
  /** Drives the badge and the blocked behaviour of the complete button. */
  state: TaskRowState
  /** The badge text for the state ("Open", "Blocked", "Overdue", "Done"): copy from the app. */
  stateLabel: string
  /** Remaps a state to another status meaning (tone + glyph). The badge always carries a glyph and the label. */
  stateMeanings?: Partial<Record<TaskRowState, StatusMeaning>>
  /** Badges shown before the state badge (an activity type, "Pre-sales"). */
  leading?: ReactNode
  title: ReactNode
  /** A paragraph under the title (an activity's notes, a link). */
  body?: ReactNode
  /** Secondary lines, one paragraph each ("Due 12.11.2026 · Assigned to Anna", "With A, B"). */
  meta?: readonly ReactNode[]
  /**
   * "Waiting on T1, T2. Finish those first." — shown while `state` is `blocked`. It is also the
   * description of the blocked complete button, so a keyboard user who reaches it hears why.
   */
  waiting?: ReactNode
  /** Mark done / Reopen. Omit it and the row has no such button. Not called while `state` is `blocked`. */
  onComplete?: () => void
  completeLabel?: string
  /** The action is running: the button shows `completingLabel` and ignores clicks. */
  completing?: boolean
  completingLabel?: string
  /** App buttons after the complete button (Edit, Delete). The app decides who may see them. */
  actions?: ReactNode
  /** Names the action group, so Edit/Delete are not ambiguous across rows ("Actions for Send the offer"). */
  actionsLabel?: string
  /** A failed action, announced as an alert; focus stays where it was. */
  error?: ReactNode
  /** Dialogs and other things the row opens. */
  children?: ReactNode
  testId?: string
  completeTestId?: string
  waitingTestId?: string
}

/**
 * TaskRow — one task in a list: state badge (glyph + text), title, meta lines, what it is waiting on,
 * and the row's actions. Presentational: the app binds it to its API and its permission rules and
 * passes every string. A blocked task's Mark done is `aria-disabled` (design-system rule 5: it stays
 * reachable and described by the "Waiting on …" line; the click is ignored).
 */
export function TaskRow({
  state,
  stateLabel,
  stateMeanings,
  leading,
  title,
  body,
  meta = [],
  waiting,
  onComplete,
  completeLabel,
  completing = false,
  completingLabel,
  actions,
  actionsLabel,
  error,
  children,
  testId,
  completeTestId,
  waitingTestId,
}: TaskRowProps) {
  const hintId = useId()
  const blocked = state === 'blocked'
  const showWaiting = blocked && waiting !== undefined && waiting !== null && waiting !== false && waiting !== ''
  const hasComplete = onComplete !== undefined
  const meaning = stateMeanings?.[state] ?? DEFAULT_MEANING[state]

  return (
    <div className={`${listRowClassName} flex-col items-stretch gap-2`} data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        {leading}
        <StatusBadge status={meaning}>{stateLabel}</StatusBadge>
        <span className="font-medium text-text">{title}</span>
      </div>
      {body}
      {meta.map((line, index) => (
        <p key={index} className={listRowMetaClassName}>
          {line}
        </p>
      ))}
      {showWaiting && (
        <p className={listRowMetaClassName} id={hintId} data-testid={waitingTestId}>
          {waiting}
        </p>
      )}
      {(hasComplete || actions) && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={actionsLabel}>
          {hasComplete && (
            <Button
              size="sm"
              busy={completing}
              aria-disabled={blocked || undefined}
              aria-describedby={blocked && showWaiting ? hintId : undefined}
              onClick={() => {
                if (!blocked) onComplete()
              }}
              data-testid={completeTestId}
            >
              {completing && completingLabel ? completingLabel : completeLabel}
            </Button>
          )}
          {actions}
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {children}
    </div>
  )
}
