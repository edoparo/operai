/**
 * The shapes the pagination's pure core passes around (specs/20261115-crm-offer-wizard T73, plan DD-68, DD-70).
 *
 * All lengths are CSS px. `top` is measured from the top of the flow in the UNPAGED layout (no rail, no row shift),
 * which `collectFlowItems` (T74) reads from the real tree. Nothing here touches the DOM.
 */

/** A block of text: `lines` line boxes of an explicit `lineHeight`, the i-th at `top + i * lineHeight`. */
export interface TextItem {
  kind: 'text'
  id: number
  top: number
  lineHeight: number
  lines: number
  /** R3: stays on the page of what follows (a heading, a mark, a title). */
  keepNext: boolean
  /** R6: starts a page (a text annex, the effort-detail annex) unless it already is at a page's first line. */
  breakBefore: boolean
}

/**
 * A block that never splits (R5): the acceptance block. `parts` are its children's boxes, and are what a break may
 * fall between only when the block is taller than a page (R7); without them it is one atom that overflows.
 */
export interface UnitItem {
  kind: 'unit'
  id: number
  top: number
  height: number
  parts?: readonly { top: number; height: number }[]
  keepNext: boolean
  breakBefore: boolean
}

/** One row of a table. `pad` is the cell's vertical padding (top = bottom); the row's lines sit between. */
export interface TableRow {
  top: number
  height: number
  head: boolean
  lineHeight: number
  pad?: number
}

export interface TableItem {
  kind: 'table'
  id: number
  breakBefore: boolean
  /** Always false for a table: nothing is kept with what follows a table. Accepted so a chain reads uniformly. */
  keepNext?: boolean
  rows: readonly TableRow[]
}

export type FlowItem = TextItem | UnitItem | TableItem

/** The rule that had to give way for a break to exist, for the development log and the tests. */
export type Relaxed = 'keep' | 'widow' | 'unit' | 'row'

/**
 * A page break. `at` is the unpaged y of the first line (or row) that moves to the next page. A break before an
 * item's first line carries `line: 0` (text) or `row: 0` (table); a unit's start carries neither.
 */
export interface Break {
  at: number
  item: number
  /** Text: index of the first line moved. Unit with `parts`: index of the first part moved. */
  line?: number
  /** Table: index of the first row moved (or of the row split, with `rowLine`). */
  row?: number
  /** An over-tall row split inside: index of the first line of that row moved (>= 1). */
  rowLine?: number
  relaxed?: Relaxed
}

export interface Band {
  from: number
  to: number
}

/** What T74 paints. See `realize`. */
export interface PagedLayout {
  /** Pages the offer fills: `breaks.length + 1`. */
  pages: number
  /** The page boxes, in the stage's px: where each A4 sheet is drawn. */
  pageBoxes: readonly { left: number; top: number; width: number; height: number }[]
  /** The flow's box in the stage's px: the frame of the first page; the same left and width on every page. */
  flowBox: { left: number; top: number; width: number }
  /** The rail at the start of the flow: `z_k` (width 0, height `run`) then `F_k` (width 100 %, height `dead`). */
  rail: readonly { run: number; dead: number }[]
  /** Row key (`"<item id>:<row>"`) to `translateY` px (cumulative within its table). */
  rowShift: ReadonlyMap<string, number>
  /** Table key (`"<item id>"`) to `margin-bottom` px (the sum of its row-boundary breaks' dead zones). */
  tableExtra: ReadonlyMap<string, number>
  /** Rows that start a page inside a table and draw their own top rule. */
  rowFirstOnPage: ReadonlySet<string>
  /** Over-tall row key to the rail inside each of its cells, in order. */
  cellRail: ReadonlyMap<string, readonly { run: number; dead: number }[]>
  /** Painted element key to the dead bands inside its own final box (to cut out with `clip-path`). */
  clip: ReadonlyMap<string, readonly Band[]>
  /** The stage's height: pages, gaps and the inset above and below. */
  stageHeight: number
}

/** An element that paints (a border, a background) across the flow: its unpaged box. */
export interface PaintedBox {
  key: string
  top: number
  height: number
}
