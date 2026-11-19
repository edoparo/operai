import { useImperativeHandle, useRef } from 'react'
import type { ReactNode, Ref } from 'react'
import {
  Badge,
  Button,
  Card,
  DataTable,
  SkeletonRows,
  StatePanel,
  VisuallyHidden,
  formatDate,
  formatDuration,
} from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import type { TableGrid, TableGridRow } from '../lib/tableGrid'
import type { TablePeriod } from '../lib/tablePeriod'
import { strings } from '../strings'
import ErrorBanner from './ErrorBanner'
import PeriodNavigator from './PeriodNavigator'
import { longDay, periodLabel, rowLabel, rowPhrase, shortDay } from './TableViewModel'

export type TableViewState =
  /** The period is being read (or read again after a write): nothing of any other period is shown. */
  | { status: 'loading' }
  /** The grid of the period the page asked for (`tableGrid(entries, daysOf(period))`); no rows is an empty period. */
  | { status: 'loaded'; grid: TableGrid }
  /** The read failed, in whole or in part; `message` is the sentence in the person's language. No partial grid. */
  | { status: 'error'; message: string }
  /** The page's own state in place of the grid (the deal filter that cannot be answered, time-tracking AC-4.11). */
  | { status: 'replaced'; content: ReactNode }

/** What the page can ask of the card (design S7 "Focus after a write"): where keyboard focus goes once the week is read again. */
export type TableViewHandle = {
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

export type TableViewProps = {
  /** The period asked for: the heading and the navigator. A loaded `grid` is the grid of this period. */
  period: TablePeriod
  /** Today as hours-api counts it (`todayZurich()`): marks its column and decides which way the navigator can move (AC-5.28). */
  today: string
  /** A filter the table applies is set: an empty period then says no entry matches, and offers Clear filters. */
  filtered: boolean
  state: TableViewState
  /** The period the navigator asks for: the one before, the one after, or the one holding today. */
  onPeriodChange: (period: TablePeriod) => void
  /** Retry after a failed read. */
  onRetry: () => void
  /** Clear filters, from the empty-and-filtered state. */
  onClearFilters: () => void
  /** A cell that holds hours was chosen (AC-5.15): the page opens the cell's entries. An empty cell is not a control (AC-5.32). */
  onOpenCell?: (row: TableGridRow, day: string) => void
  ref?: Ref<TableViewHandle>
}

/** A row of the table: one of the grid's, or the last, the totals of the days. */
type TableRow = { type: 'row'; row: TableGridRow } | { type: 'total' }

const short = (minutes: number) => formatDuration(minutes * 60_000, { style: 'short' })

/** A day's column header: the weekday of its date (never of its place among the columns, R17) and the date. */
function DayHeader({ day, today }: { day: string; today: string }) {
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="inline-flex items-center gap-1">
        {shortDay(day)}
        {day === today && <Badge tone="accent">{strings.table.today}</Badge>}
      </span>{' '}
      <span>{formatDate(day)}</span>
    </span>
  )
}

function RowLabel({ row }: { row: TableGridRow }) {
  return (
    // The floor is 7 rem: it decides whether a day figure is on a phone's first screen and whether the grid fits at 1024 px
    // (design S7 "Columns"); a wider one left a phone with a column of names only, and a laptop with 10 px of scroll.
    <span className="flex min-w-28 flex-wrap items-center gap-x-3 gap-y-1">
      <Badge>{strings.entries.type[row.kind]}</Badge> <span className="break-words">{rowLabel(row)}</span>
    </span>
  )
}

/**
 * One cell of a row (design S7 "Cells"). A cell that holds hours shows the total and, when the page can open it, is the
 * button that does, named for its row and its day since it can be reached out of the table. An empty cell is nothing: a
 * blank `td` with no button, no `data-cell`, no tab stop and no handler, on any day, any row and any state of the row
 * (AC-5.14, AC-5.24, AC-5.32) — hours are recorded with Record hours, or with Add hours in the list of a cell that holds
 * some, never from an empty cell.
 */
function Cell({ row, day, onOpenCell }: Pick<TableViewProps, 'onOpenCell'> & { row: TableGridRow; day: string }) {
  const cell = row.cells[day]
  if (!cell) return null
  const figure = short(cell.minutes)
  if (!onOpenCell) return figure
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-haspopup="dialog"
      aria-label={strings.table.cell.open(figure, rowPhrase(row), longDay(day), cell.entries.length)}
      onClick={() => onOpenCell(row, day)}
      data-cell={`${row.key}:${day}`}
    >
      <span className="font-mono">{figure}</span>
    </Button>
  )
}

function GridTable({
  grid,
  label,
  today,
  onOpenCell,
}: Pick<TableViewProps, 'onOpenCell'> & { grid: TableGrid; label: string; today: string }) {
  const columns: DataTableColumn<TableRow>[] = [
    {
      id: 'on',
      header: strings.filters.recordedOn.label,
      rowHeader: true,
      render: (item) =>
        item.type === 'total' ? (
          <span className="font-medium">{strings.table.grid.total}</span>
        ) : (
          <RowLabel row={item.row} />
        ),
    },
    ...grid.days.map((day, index): DataTableColumn<TableRow> => ({
      id: day,
      header: <DayHeader day={day} today={today} />,
      numeric: true,
      render: (item) =>
        item.type === 'total' ? (
          grid.dayMinutes[index] === 0 ? (
            strings.common.none
          ) : (
            short(grid.dayMinutes[index]!)
          )
        ) : (
          <Cell row={item.row} day={day} onOpenCell={onOpenCell} />
        ),
    })),
    {
      id: 'total',
      header: strings.table.grid.total,
      numeric: true,
      render: (item) => (
        <span className="font-medium">{short(item.type === 'total' ? grid.totalMinutes : item.row.minutes)}</span>
      ),
    },
  ]
  const rows: TableRow[] = [...grid.rows.map((row): TableRow => ({ type: 'row', row })), { type: 'total' }]
  return (
    <DataTable
      caption={strings.table.grid.caption(label)}
      columns={columns}
      rows={rows}
      getRowKey={(item) => (item.type === 'total' ? 'total' : item.row.key)}
      rowTestIdPrefix="hours-table-row"
      testId="hours-table-table"
    />
  )
}

/**
 * A period with no entries (design S7 States): the List's own sentence for "a filter is set" with Clear filters, or the
 * plain one — the page header has the Record hours action, so the panel has none. There is no "not started" state: no
 * period after today is ever shown (AC-5.28, AC-5.29).
 */
function EmptyPeriod({ filtered, onClearFilters }: Pick<TableViewProps, 'filtered' | 'onClearFilters'>) {
  if (filtered) {
    return (
      <StatePanel
        headingLevel={4}
        title={strings.entries.emptyFiltered.title}
        action={
          <Button variant="ghost" onClick={onClearFilters} data-testid="hours-table-clear">
            {strings.filters.clear}
          </Button>
        }
        testId="hours-table-empty"
      >
        {strings.entries.emptyFiltered.body}
      </StatePanel>
    )
  }
  return (
    <StatePanel headingLevel={4} title={strings.table.empty.title} testId="hours-table-empty">
      {strings.table.empty.body}
    </StatePanel>
  )
}

/**
 * What the one polite live region says: the wait, then the period that arrived with its total (spoken, as a sentence is,
 * and as the Totals card says its figure). Nothing on an error — its banner is an alert — and nothing on a state the page
 * supplies, which words itself.
 */
const announcement = (state: TableViewState, label: string): string => {
  if (state.status === 'loading') return strings.table.loading
  if (state.status !== 'loaded') return ''
  return state.grid.rows.length === 0
    ? strings.table.announceEmpty(label)
    : strings.table.announce(label, formatDuration(state.grid.totalMinutes * 60_000, { style: 'spoken' }))
}

/**
 * TableView — the table card of My hours, drawn for a `TablePeriod` (specs/20261116-record-hours-in-place T9, T18, T20;
 * design S7; AC-5.3, AC-5.5, AC-5.9–AC-5.11, AC-5.14, AC-5.23, AC-5.24, AC-5.28, AC-5.32).
 *
 * Presentational. It is handed `period` (the period asked for), `today` (`todayZurich()`), the `state` of the one read
 * of that period and, when loaded, the `TableGrid` the pure fold of T8 made of it. It sums nothing and compares nothing:
 * every figure is one the grid states, and the same markup draws a 1 h week and a 42 h week (AC-5.11). A day is named by
 * its date — the weekday in a column header and in a cell's name — never by the column's place (R17).
 *
 * The card's heading is the period's label and its action the navigator, in every state, so the period can be changed
 * out of an error or an empty one. The body is exactly one of: a skeleton while the period is read (so the previous
 * period's figures are never on screen under the new span), the table, the empty period, one error with Retry (the read
 * is all or nothing: never a partial grid), or whatever the page supplies in place of the grid (`replaced`: the deal
 * filter that cannot be answered).
 *
 * A cell that holds hours is a button that gives the row and the day to the page, which lists the cell's entries; a grid
 * given no handler is read-only. An empty cell is not a control (AC-5.32). Every cell button carries
 * `data-cell="<row key>:<day>"` so the page can put focus back on it once the period has been read again; an empty cell
 * has none, so a cell that has run out of entries is found by no one and focus goes to the card's heading.
 */
export default function TableView({
  period,
  today,
  filtered,
  state,
  onPeriodChange,
  onRetry,
  onClearFilters,
  onOpenCell,
  ref,
}: TableViewProps) {
  const root = useRef<HTMLDivElement>(null)
  const label = periodLabel(period)

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
        title={strings.table.title(label)}
        titleTestId="hours-table-heading"
        action={<PeriodNavigator period={period} today={today} onPeriodChange={onPeriodChange} />}
        data-testid="hours-table"
      >
        <VisuallyHidden live data-testid="hours-table-live">
          {announcement(state, label)}
        </VisuallyHidden>

        {state.status === 'loading' && <SkeletonRows rows={4} actions={0} testId="hours-table-skeleton" />}

        {state.status === 'loaded' &&
          (state.grid.rows.length === 0 ? (
            <EmptyPeriod filtered={filtered} onClearFilters={onClearFilters} />
          ) : (
            <>
              {/* Below 1024 px the grid scrolls inside the card and nothing else says so; with a grid only (design S7 "Phone"). */}
              <p className="mb-3 text-xs text-soft lg:hidden" aria-hidden="true">
                {strings.table.scrollHint}
              </p>
              <GridTable grid={state.grid} label={label} today={today} onOpenCell={onOpenCell} />
            </>
          ))}

        {state.status === 'error' && (
          <ErrorBanner
            title={strings.entries.error.title}
            message={state.message}
            onRetry={onRetry}
            testId="hours-table-error"
          />
        )}

        {state.status === 'replaced' && state.content}
      </Card>
    </div>
  )
}
