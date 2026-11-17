/**
 * The Week view of My hours (specs/20261116-record-hours-in-place T9; design S7 and § Copy; AC-4.6): the card's
 * heading, the navigator, the grid's headers and the names of a cell's buttons, the states and the sentence a
 * screen reader hears when a week arrives. The kind badges, the retired and "not visible" wording, "Recorded on",
 * "Clear filters" and the empty-filter and error sentences are the List's, reused from `entries`, `names`,
 * `filters` and `common`, so the two views of the same hours never word one thing twice.
 *
 * Weekday names are copy, not a date format (the library has no weekday formatter): seven short and seven long,
 * Monday first (WA1), picked by a day's place in the week. The week itself is written as two `formatDate`s with an
 * en dash by `WeekViewModel.weekRange` and arrives here already made (`range`).
 */

/** One name for each day of the week, Monday first. */
type Week7 = [string, string, string, string, string, string, string]

const en = {
  /** The List | Week switch under the page header (design S6, AC-5.1): a tab list of two views of the same page. */
  view: {
    label: 'View of your hours',
    list: 'List',
    week: 'Week',
  },
  /** The card's heading — the week as two dates, "Week 16.11.2026 – 22.11.2026". */
  title: (range: string) => `Week ${range}`,
  /** The previous / this / next week buttons, one group (AC-5.5). */
  nav: {
    label: 'Choose a week',
    previous: 'Previous week',
    next: 'Next week',
    thisWeek: 'This week',
  },
  weekday: {
    short: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as Week7,
    long: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as Week7,
  },
  /** A badge on today's column header: the calendar's, never about the hours (AC-5.11). */
  today: 'Today',
  grid: {
    /** Names the table and its scroll region. */
    caption: (range: string) => `Hours by project, deal, meeting and other work, ${range}`,
    /** The last column's header and the last row's header (the day totals). */
    total: 'Total',
  },
  /** The accessible names of a cell's button: they carry the row and the day, since a button is reached out of the table. */
  cell: {
    /** An empty cell of today or an earlier day on a row that can be recorded on (AC-5.12). `day`: "Thursday 19 November 2026". */
    record: (on: string, day: string) => `Record hours on ${on}, ${day}`,
    /** A cell that holds hours (AC-5.15). */
    open: (duration: string, on: string, day: string, entries: number) =>
      `${duration} on ${on}, ${day}, ${entries === 1 ? '1 entry' : `${entries} entries`}`,
  },
  loading: 'Loading your week…',
  /** Polite, when a week (or its filters) has arrived. `total` is spoken ("38 hours, 30 minutes"). */
  announce: (range: string, total: string) => `${range}: ${total} in total.`,
  announceEmpty: (range: string) => `${range}: no hours recorded.`,
  /** No filter is set and the week has no entries (the page header has the action). */
  empty: {
    title: 'No hours recorded this week',
    body: 'Record the hours you worked and they appear here, by project and day.',
  },
  /** The week begins after today: nothing can be recorded on it yet, whatever the filters. */
  emptyFuture: {
    title: 'This week has not started',
    body: 'You can record hours on a day once it has come.',
  },
}

const it: typeof en = {
  view: {
    label: 'Vista delle tue ore',
    list: 'Elenco',
    week: 'Settimana',
  },
  title: (range: string) => `Settimana ${range}`,
  nav: {
    label: 'Scegli una settimana',
    previous: 'Settimana precedente',
    next: 'Settimana successiva',
    thisWeek: 'Questa settimana',
  },
  weekday: {
    short: ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'] as Week7,
    long: ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'] as Week7,
  },
  today: 'Oggi',
  grid: {
    caption: (range: string) => `Ore per progetto, opportunità, riunione e altro lavoro, ${range}`,
    total: 'Totale',
  },
  cell: {
    record: (on: string, day: string) => `Registra ore su ${on}, ${day}`,
    open: (duration: string, on: string, day: string, entries: number) =>
      `${duration} su ${on}, ${day}, ${entries === 1 ? '1 registrazione' : `${entries} registrazioni`}`,
  },
  loading: 'Caricamento della tua settimana…',
  announce: (range: string, total: string) => `${range}: ${total} in totale.`,
  announceEmpty: (range: string) => `${range}: nessuna ora registrata.`,
  empty: {
    title: 'Nessuna ora registrata in questa settimana',
    body: 'Registra le ore lavorate e compaiono qui, per progetto e giorno.',
  },
  emptyFuture: {
    title: 'Questa settimana non è ancora iniziata',
    body: 'Puoi registrare le ore di un giorno quando è arrivato.',
  },
}

export const week = { en, it }
