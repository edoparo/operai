import { Icon, VisuallyHidden } from '@operai/ui'
import type { AgendaPoint } from '../../lib/types'
import { strings } from '../../strings'

export type AgendaChecklistProps = {
  points: AgendaPoint[]
  /** An agenda editor ticks points; anyone else reads the marks. */
  canTick: boolean
  /** The point whose tick is being saved (its box is disabled meanwhile). */
  busyId: string | null
  onTick: (point: AgendaPoint, covered: boolean) => void
  /** Compact: the recorder widget shows titles only. */
  compact?: boolean
  testIdPrefix: string
}

/**
 * AgendaChecklist — the agenda's points in order, each with its covered mark. A covered point reads as
 * covered by more than colour: a ticked box (or a check icon for a reader) and a struck-through title,
 * and a screen reader hears the point's position, title and state. Plain text only: titles and notes
 * are what people typed, never links or markup.
 */
export default function AgendaChecklist({ points, canTick, busyId, onTick, compact = false, testIdPrefix }: AgendaChecklistProps) {
  const t = strings.agenda.card
  return (
    <ol aria-label={t.listLabel} className="flex flex-col divide-y divide-rule" data-testid={`${testIdPrefix}-points`}>
      {points.map((point, index) => {
        const title = <span className={point.covered ? 'text-sm line-through' : 'text-sm'}>{point.title}</span>
        const note = !compact && point.note !== null && (
          <span className="block whitespace-pre-wrap text-xs text-soft">{point.note}</span>
        )
        return (
          <li key={point.id} className="py-2" data-testid={`${testIdPrefix}-point-${index}`}>
            {canTick ? (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={point.covered}
                  disabled={busyId === point.id}
                  aria-label={t.tickLabel(index + 1, point.title)}
                  onChange={(event) => onTick(point, event.target.checked)}
                  data-testid={`${testIdPrefix}-tick-${index}`}
                />
                <span className="flex flex-col gap-0.5">
                  {title}
                  {note}
                </span>
              </label>
            ) : (
              <div className="flex items-start gap-2">
                <span className={point.covered ? 'mt-0.5 text-grn-text' : 'mt-0.5 text-soft'} aria-hidden="true">
                  <Icon name={point.covered ? 'check-circle' : 'minus'} />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span>
                    <VisuallyHidden>{`${index + 1}. `}</VisuallyHidden>
                    {title}
                    <VisuallyHidden>{` (${point.covered ? t.covered : t.notCovered})`}</VisuallyHidden>
                  </span>
                  {note}
                </span>
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
