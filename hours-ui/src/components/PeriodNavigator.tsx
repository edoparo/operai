import { Button, Icon } from '@operai/ui'
import { current, isCurrent, shift } from '../lib/tablePeriod'
import type { TablePeriod } from '../lib/tablePeriod'
import { strings } from '../strings'

export type PeriodNavigatorProps = {
  /** The period shown. */
  period: TablePeriod
  /** Today as hours-api counts it (`todayZurich()`): "This week" returns to the period holding it. */
  today: string
  /** The period asked for: the one before, the one after, or the one holding today. */
  onPeriodChange: (period: TablePeriod) => void
}

/**
 * PeriodNavigator — previous week, this week, next week (specs/20261116-record-hours-in-place T9, T18; design S7
 * "Navigator"; AC-5.5). It keeps no state and no address: it reports the period asked for and the page changes the
 * address, so the buttons stay mounted and keep focus across a step.
 *
 * Next week is always offered, a week that has not started included (its grid is blank, with its own state).
 * "This week" is `aria-disabled` rather than `disabled` while the current week is shown: it stays in the tab order
 * and keeps focus after a click, and the click asks for nothing.
 */
export default function PeriodNavigator({ period, today, onPeriodChange }: PeriodNavigatorProps) {
  const showingCurrent = isCurrent(period, today)
  return (
    <div
      role="group"
      aria-label={strings.table.nav.label}
      className="flex items-center gap-2"
      data-testid="hours-period-nav"
    >
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={strings.table.nav.previous}
        onClick={() => onPeriodChange(shift(period, -1))}
        data-testid="hours-period-previous"
      >
        <Icon name="chevron-left" />
      </Button>
      <Button
        variant="secondary"
        size="sm"
        aria-disabled={showingCurrent ? 'true' : undefined}
        onClick={() => {
          if (!showingCurrent) onPeriodChange(current(period.kind, today))
        }}
        data-testid="hours-period-current"
      >
        {strings.table.nav.thisWeek}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={strings.table.nav.next}
        onClick={() => onPeriodChange(shift(period, 1))}
        data-testid="hours-period-next"
      >
        <Icon name="chevron-right" />
      </Button>
    </div>
  )
}
