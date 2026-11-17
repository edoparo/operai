import { Button, Icon } from '@operai/ui'
import { mondayOf, shiftWeek } from '../lib/week'
import { strings } from '../strings'

export type WeekNavigatorProps = {
  /** The Monday of the week shown (`YYYY-MM-DD`). */
  monday: string
  /** Today as hours-api counts it (`todayZurich()`): "This week" returns to the week holding it. */
  today: string
  /** The Monday of the week asked for: the one before, the one after, or the one holding today. */
  onWeekChange: (monday: string) => void
}

/**
 * WeekNavigator — previous week, this week, next week (specs/20261116-record-hours-in-place T9; design S7
 * "Navigator"; AC-5.5). It keeps no state and no address: it reports the Monday asked for and the page changes
 * `week`, so the buttons stay mounted and keep focus across a step.
 *
 * Next week is always offered, a week that has not started included (its grid is blank, with its own state).
 * "This week" is `aria-disabled` rather than `disabled` while the current week is shown: it stays in the tab order
 * and keeps focus after a click, and the click asks for nothing.
 */
export default function WeekNavigator({ monday, today, onWeekChange }: WeekNavigatorProps) {
  const current = mondayOf(today)
  const showingCurrent = monday === current
  return (
    <div
      role="group"
      aria-label={strings.week.nav.label}
      className="flex items-center gap-2"
      data-testid="hours-week-nav"
    >
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={strings.week.nav.previous}
        onClick={() => onWeekChange(shiftWeek(monday, -1))}
        data-testid="hours-week-previous"
      >
        <Icon name="chevron-left" />
      </Button>
      <Button
        variant="secondary"
        size="sm"
        aria-disabled={showingCurrent ? 'true' : undefined}
        onClick={() => {
          if (!showingCurrent) onWeekChange(current)
        }}
        data-testid="hours-week-this"
      >
        {strings.week.nav.thisWeek}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={strings.week.nav.next}
        onClick={() => onWeekChange(shiftWeek(monday, 1))}
        data-testid="hours-week-next"
      >
        <Icon name="chevron-right" />
      </Button>
    </div>
  )
}
