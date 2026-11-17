import { useImperativeHandle, useRef } from 'react'
import type { ReactNode, Ref } from 'react'
import {
  Badge,
  Button,
  Card,
  DataTable,
  Icon,
  SkeletonRows,
  StatePanel,
  VisuallyHidden,
  formatDate,
  formatDuration,
} from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import type { WeekGrid, WeekRow } from '../lib/weekGrid'
import { strings } from '../strings'
import ErrorBanner from './ErrorBanner'
import WeekNavigator from './WeekNavigator'
import { longDay, rowLabel, rowPhrase, weekRange } from './WeekViewModel'

export type WeekViewState =
  /** The week is being read (or read again after a write): nothing of any other week is shown. */
  | { status: 'loading' }
  /** The grid of the week the page asked for (`weekGrid(entries, monday)`); no rows is an empty week. */
  | { status: 'loaded'; grid: WeekGrid }
  /** The read failed, in whole or in part; `message` is the sentence in the person's language. No partial grid. */
  | { status: 'error'; message: string }
  /** The page's own state in place of the grid (the deal filter that cannot be answered, time-tracking AC-4.11). */
  | { status: 'replaced'; content: ReactNode }

/** What the page can ask of the card (design S7 "Focus after a write"): where keyboard focus goes once the week is read again. */
export type WeekViewHandle = {
  /**
   * Moves focus to the card's heading, which is focusable but never a tab stop: the landing place when the cell that was
   * acted on is gone or is no longer a control (the grid is replaced while it is read again, so the control that had
   * focus before the write no longer exists).
   */
  focusHeading: () => void
  /** Moves focus to the button of the cell `<row key>:<day>`; `false`, and focus stays where it is, when the grid has none. */
  focusCell: (cell: string) => boolean
  /**
   * Moves focus to the Retry button of the failed read; `false`, and focus stays where it is, when the card shows none.
   * The button that was pressed is replaced by a new one while the week is read again, so a Retry that fails again
   * would otherwise leave the keyboard on <body>.
   */
  focusRetry: () => boolean
}

export type WeekViewProps = {
  /** The Monday of the week asked for (`YYYY-MM-DD`): the heading and the navigator. A loaded `grid` is the grid of this week. */
  monday: string
  /** Today as hours-api counts it (`todayZurich()`): marks its column; a day after it offers no recording (AC-5.14). */
  today: string
  /** A filter the Week applies is set: an empty week then says no entry matches, and offers Clear filters. */
  filtered: boolean
  state: WeekViewState
  /** The Monday of the week the navigator asks for: the one before, the one after, or the one holding today. */
  onWeekChange: (monday: string) => void
  /** Retry after a failed read. */
  onRetry: () => void
  /** Clear filters, from the empty-and-filtered state. */
  onClearFilters: () => void
  /** An empty cell of today or an earlier day on a row that can be recorded on was chosen (AC-5.12): the page opens the entry dialog on it (T11). */
  onRecordCell?: (row: WeekRow, day: string) => void
  /** A cell that holds hours was chosen (AC-5.15): the page opens the cell's entries (T12). */
  onOpenCell?: (row: WeekRow, day: string) => void
  ref?: Ref<WeekViewHandle>
}

/** A row of the table: one of the grid's, or the last, the totals of the days. */
type TableRow = { type: 'row'; row: WeekRow } | { type: 'total' }

const short = (minutes: number) => formatDuration(minutes * 60_000, { style: 'short' })

function DayHeader({ day, index, today }: { day: string; index: number; today: string }) {
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="inline-flex items-center gap-1">
        {strings.week.weekday.short[index]}
        {day === today && <Badge tone="accent">{strings.week.today}</Badge>}
      </span>{' '}
      <span>{formatDate(day)}</span>
    </span>
  )
}

function RowLabel({ row }: { row: WeekRow }) {
  return (
    <span className="flex min-w-44 flex-wrap items-center gap-x-3 gap-y-1">
      <Badge>{strings.entries.type[row.kind]}</Badge> <span className="break-words">{rowLabel(row)}</span>
    </span>
  )
}

type CellActions = Pick<WeekViewProps, 'onRecordCell' | 'onOpenCell'>

/**
 * One cell of a row (design S7 "Cells"). A cell that holds hours shows the total and, when the page can open it,
 * is the button that does; an empty one is a plus button only on a day that is today or earlier and on a row that
 * can be recorded on (`preset`: not an unreadable row, not a retired category — AC-5.24), and is blank otherwise.
 * A button names its row and its day, since it can be reached out of the table.
 */
function Cell({
  row,
  day,
  index,
  today,
  onRecordCell,
  onOpenCell,
}: CellActions & { row: WeekRow; day: string; index: number; today: string }) {
  const cell = row.cells[day]
  const on = rowPhrase(row)
  const dayName = longDay(day, index)
  const dataCell = `${row.key}:${day}`
  if (cell) {
    const figure = short(cell.minutes)
    if (!onOpenCell) return figure
    return (
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="dialog"
        aria-label={strings.week.cell.open(figure, on, dayName, cell.entries.length)}
        onClick={() => onOpenCell(row, day)}
        data-cell={dataCell}
      >
        <span className="font-mono">{figure}</span>
      </Button>
    )
  }
  if (day > today || row.preset === null || !onRecordCell) return null
  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      aria-haspopup="dialog"
      aria-label={strings.week.cell.record(on, dayName)}
      onClick={() => onRecordCell(row, day)}
      data-cell={dataCell}
    >
      <Icon name="plus" />
    </Button>
  )
}

function WeekTable({ grid, today, onRecordCell, onOpenCell }: CellActions & { grid: WeekGrid; today: string }) {
  const columns: DataTableColumn<TableRow>[] = [
    {
      id: 'on',
      header: strings.filters.recordedOn.label,
      rowHeader: true,
      render: (item) =>
        item.type === 'total' ? (
          <span className="font-medium">{strings.week.grid.total}</span>
        ) : (
          <RowLabel row={item.row} />
        ),
    },
    ...grid.days.map((day, index): DataTableColumn<TableRow> => ({
      id: day,
      header: <DayHeader day={day} index={index} today={today} />,
      numeric: true,
      render: (item) =>
        item.type === 'total' ? (
          grid.dayMinutes[index] === 0 ? (
            strings.common.none
          ) : (
            short(grid.dayMinutes[index]!)
          )
        ) : (
          <Cell
            row={item.row}
            day={day}
            index={index}
            today={today}
            onRecordCell={onRecordCell}
            onOpenCell={onOpenCell}
          />
        ),
    })),
    {
      id: 'total',
      header: strings.week.grid.total,
      numeric: true,
      render: (item) => (
        <span className="font-medium">{short(item.type === 'total' ? grid.totalMinutes : item.row.minutes)}</span>
      ),
    },
  ]
  const rows: TableRow[] = [...grid.rows.map((row): TableRow => ({ type: 'row', row })), { type: 'total' }]
  const range = weekRange(grid.days[0]!)
  return (
    <DataTable
      caption={strings.week.grid.caption(range)}
      columns={columns}
      rows={rows}
      getRowKey={(item) => (item.type === 'total' ? 'total' : item.row.key)}
      rowTestIdPrefix="hours-week-row"
      testId="hours-week-table"
    />
  )
}

/**
 * A week with no entries (design S7 States). A week that begins after today says it has not started, whatever the
 * filters are: nothing can be recorded on a day that has not come, so clearing a filter would change nothing and is
 * not offered. Otherwise the List's own sentence for "a filter is set" with Clear filters, or the plain one — the
 * page header has the Record hours action, so the panel has none.
 */
function EmptyWeek({
  monday,
  today,
  filtered,
  onClearFilters,
}: Pick<WeekViewProps, 'monday' | 'today' | 'filtered' | 'onClearFilters'>) {
  if (monday > today) {
    return (
      <StatePanel headingLevel={4} title={strings.week.emptyFuture.title} testId="hours-week-empty">
        {strings.week.emptyFuture.body}
      </StatePanel>
    )
  }
  if (filtered) {
    return (
      <StatePanel
        headingLevel={4}
        title={strings.entries.emptyFiltered.title}
        action={
          <Button variant="ghost" onClick={onClearFilters} data-testid="hours-week-clear">
            {strings.filters.clear}
          </Button>
        }
        testId="hours-week-empty"
      >
        {strings.entries.emptyFiltered.body}
      </StatePanel>
    )
  }
  return (
    <StatePanel headingLevel={4} title={strings.week.empty.title} testId="hours-week-empty">
      {strings.week.empty.body}
    </StatePanel>
  )
}

/**
 * What the one polite live region says: the wait, then the week that arrived with its total (spoken, as a sentence is,
 * and as the Totals card says its figure). Nothing on an error — its banner is an alert — and nothing on a state the page
 * supplies, which words itself.
 */
const announcement = (state: WeekViewState, monday: string): string => {
  if (state.status === 'loading') return strings.week.loading
  if (state.status !== 'loaded') return ''
  const range = weekRange(monday)
  return state.grid.rows.length === 0
    ? strings.week.announceEmpty(range)
    : strings.week.announce(range, formatDuration(state.grid.totalMinutes * 60_000, { style: 'spoken' }))
}

/**
 * WeekView — the Week card of My hours (specs/20261116-record-hours-in-place T9; design S7; AC-5.3, AC-5.5,
 * AC-5.9–AC-5.11, AC-5.14, AC-5.23, AC-5.24).
 *
 * Presentational. It is handed `monday` (the week asked for), `today` (`todayZurich()`), the `state` of the one read
 * of that week and, when loaded, the `WeekGrid` the pure fold of T8 made of it. It sums nothing and compares nothing:
 * every figure is one the grid states, and the same markup draws a 1 h week and a 42 h week (AC-5.11).
 *
 * The card's heading is the week as two dates and its action the navigator, in every state, so the week can be changed
 * out of an error or an empty one. The body is exactly one of: a skeleton while the week is read (so the previous
 * week's figures are never on screen under the new span), the table, the empty week, one error with Retry (the read is
 * all or nothing: never a partial grid), or whatever the page supplies in place of the grid (`replaced`: the deal
 * filter that cannot be answered).
 *
 * A cell's actions are callbacks that give the row and the day (T11 records on an empty cell, T12 lists a cell's
 * entries): a cell is a button only where the page gave the handler for it, and a grid given none is read-only.
 * Every cell button carries `data-cell="<row key>:<day>"` so the page can put focus back on it once the week has been
 * read again.
 */
export default function WeekView({
  monday,
  today,
  filtered,
  state,
  onWeekChange,
  onRetry,
  onClearFilters,
  onRecordCell,
  onOpenCell,
  ref,
}: WeekViewProps) {
  const root = useRef<HTMLDivElement>(null)

  // `Card` has no focusable heading yet, so the heading is found through the card's own `aria-labelledby` (the way
  // `TotalsCard` does it) and made a programmatic focus target; a cell is found by the `data-cell` it carries.
  useImperativeHandle(ref, () => ({
    focusHeading: () => {
      const labelledBy = root.current?.querySelector('section')?.getAttribute('aria-labelledby')
      const heading = labelledBy ? document.getElementById(labelledBy) : null
      if (heading === null) return
      heading.tabIndex = -1
      heading.focus()
    },
    focusCell: (cell) => {
      const button = [...(root.current?.querySelectorAll<HTMLElement>('[data-cell]') ?? [])].find(
        (candidate) => candidate.dataset['cell'] === cell,
      )
      if (button === undefined) return false
      button.focus()
      return true
    },
    focusRetry: () => {
      // The failed read's banner is the only alert of the card, and Retry its only button.
      const retry = root.current?.querySelector<HTMLElement>('[role="alert"] button')
      if (retry === null || retry === undefined) return false
      retry.focus()
      return true
    },
  }))

  return (
    <div ref={root} className="contents">
      <Card
        title={strings.week.title(weekRange(monday))}
        titleTestId="hours-week-heading"
        action={<WeekNavigator monday={monday} today={today} onWeekChange={onWeekChange} />}
        data-testid="hours-week"
      >
        <VisuallyHidden live data-testid="hours-week-live">
          {announcement(state, monday)}
        </VisuallyHidden>

        {state.status === 'loading' && <SkeletonRows rows={4} actions={0} testId="hours-week-skeleton" />}

        {state.status === 'loaded' &&
          (state.grid.rows.length === 0 ? (
            <EmptyWeek monday={monday} today={today} filtered={filtered} onClearFilters={onClearFilters} />
          ) : (
            <WeekTable grid={state.grid} today={today} onRecordCell={onRecordCell} onOpenCell={onOpenCell} />
          ))}

        {state.status === 'error' && (
          <ErrorBanner
            title={strings.entries.error.title}
            message={state.message}
            onRetry={onRetry}
            testId="hours-week-error"
          />
        )}

        {state.status === 'replaced' && state.content}
      </Card>
    </div>
  )
}
