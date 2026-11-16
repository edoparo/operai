import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Badge, Banner, Icon, VisuallyHidden } from '@operai/ui'
import type { WizardAnswers, WizardContext } from '../../lib/offerEngine/answers'
import { formatAmount, formatNumber, formatPercent, shortDate } from '../../lib/offerEngine/format'
import { parseMarkup, type Block, type CellLine, type Run } from '../../lib/offerEngine/markup'
import { numberOffer, type NumberedSection } from '../../lib/offerEngine/numbering'
import { printable } from '../../lib/offerEngine/printable'
import { resolveOffer, type ResolvedOffer, type ResolvedSection } from '../../lib/offerEngine/resolve'
import type { TemplateAst } from '../../lib/offerEngine/syntax'
import { words } from '../../lib/offerEngine/words'
import { useFitToScrollport } from '../../hooks/useFitToScrollport'
import { strings } from '../../strings'
import { MarkedText, MissingRun, PendingRun } from './MarkedText'
import { pageGeometry, pageNumberGeometry, type PageGeometry, type TypeRole } from './paper/geometry'
import { clipPath, type KeyedLayout } from './paper/keyed'
import { quantiseRail } from './paper/quantiseRail'
import { usePagination } from './paper/usePagination'
import { splitMarked } from './splitMarked'
import type { Letterhead } from './useLetterhead'

const t = strings.offerWizard

/** The effort-detail annex's table as the context route gives it (`estimate.annex`, one of its four variants). */
export interface EffortAnnexPreview {
  releases: readonly {
    name: string
    manDaysTenths: number
    epics: readonly { epic: string; manDaysTenths: number }[]
  }[]
  manDaysTenths: number
}

export interface DocumentPreviewProps {
  ast: TemplateAst
  answers: WizardAnswers
  context: WizardContext
  /** The effort-detail annex's figures for the offer's language and the AI-assisted choice; absent, only its heading shows. */
  effortAnnex?: EffortAnnexPreview | null
  /** Milliseconds after the last change before the document is resolved again. */
  debounceMs?: number
  /** The pane's own title row; off inside a drawer that has its title. */
  heading?: boolean
  /**
   * The inline pane of the wide layout: the scrolling region is as tall as the room left on screen above the action bar
   * and keeps its scrolling to itself (D19). Off in the Drawer, whose body is its own bound.
   */
  fit?: boolean
  /**
   * The inline pane of a wizard that fills its scroller (owner D20): the pane's box has a height of its own, the region
   * takes what the title, band and notice leave (`flex-1 min-h-0`) and scrolls inside it. CSS only — no measuring, and the
   * pagination reads the region's width alone. Takes the place of `fit`.
   */
  fill?: boolean
  /**
   * The page's one letterhead attempt (`useLetterhead`, called once by the page and handed to the pane and to the Drawer,
   * D-32): the image on every page and the band above the region follow its state. Absent (a view that has none yet), the
   * band reads as while pending and the pages carry no image.
   */
  letterhead?: Letterhead
  /** The issuer's name in the band and the notice; default the context's legal name (the page passes the entity's label when that is blank, AC-12.7). */
  issuerLabel?: string
}

/** Settled inputs: the preview shows these, and catches up 250 ms after the last change. */
interface Inputs {
  ast: TemplateAst
  answers: WizardAnswers
  context: WizardContext
}

const upper = (text: string): string => printable(text.toUpperCase())

/** A plain surface with its marker characters removed, as the PDF numbers it: the lists (index, "Allegati:") never print "?" for one. */
const unmarked = (text: string): string => text.replace(/[-]/g, '')

/** Marker placeholder used to find where the (unassigned) reference stands in the document's title. */
const REFERENCE_SPOT = '\u0001'

// ─── the paper: type, spacing and the paged layout, read by the elements (DD-66, DD-70) ───

/** The page geometry the elements are drawn at: sizes and spacing reach them as inline runtime `style`. */
const PaperContext = createContext<PageGeometry>(pageGeometry(488, 16))
/** The paged layout of the settled content: row shifts, cell rails and clips by key; null while unpaged. */
const PagedContext = createContext<KeyedLayout | null>(null)
/** The tables whose words break anywhere: those too wide for the frame with their words whole (DD-70, AC-11.10). */
const WrapContext = createContext<ReadonlySet<string>>(new Set())
const usePaper = (): PageGeometry => useContext(PaperContext)

const typeStyle = (g: PageGeometry, role: TypeRole): CSSProperties => ({
  fontSize: `${g.type[role].fontPx}px`,
  lineHeight: `${g.type[role].lineHeightPx}px`,
})

/** A text element of the flow: one item of the pagination (an explicit line height, no padding, no border). */
function FlowText({
  as: Tag = 'p',
  role = 'body',
  className,
  keep = false,
  breakBefore = false,
  style,
  children,
  ...rest
}: {
  as?: 'p' | 'h4' | 'h5' | 'div'
  role?: TypeRole
  className?: string
  keep?: boolean
  breakBefore?: boolean
  style?: CSSProperties
  children?: ReactNode
  'data-chrome'?: string
}) {
  const g = usePaper()
  return (
    <Tag
      {...rest}
      data-flow="text"
      data-flow-keep={keep ? 'next' : undefined}
      data-flow-break={breakBefore ? 'before' : undefined}
      className={className}
      style={{ ...typeStyle(g, role), ...style }}
    >
      {children}
    </Tag>
  )
}

function runKey(index: number): string {
  return `r${index}`
}

/** A run of the offer markup: emphasis as written, a marker as a marked run. */
function RunView({ run }: { run: Run }): ReactNode {
  if (run.mark === 'missing') return <MissingRun label={run.text} surface="paper" />
  if (run.mark === 'pending') return <PendingRun label={run.text} surface="paper" />
  const className = [run.bold ? 'font-semibold' : '', run.italic ? 'italic' : '', run.underline ? 'underline' : '']
    .filter(Boolean)
    .join(' ')
  const lines = run.text.split('\n')
  return (
    <span className={className || undefined}>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 ? <br /> : null}
          {line}
        </Fragment>
      ))}
    </span>
  )
}

function Runs({ runs }: { runs: readonly Run[] }): ReactNode {
  return (
    <>
      {runs.map((run, index) => (
        <RunView key={runKey(index)} run={run} />
      ))}
    </>
  )
}

function CellLines({ lines }: { lines: readonly CellLine[] }): ReactNode {
  const g = usePaper()
  return (
    <>
      {lines.map((line, index) => (
        <div key={index} style={line.bullet ? { paddingLeft: g.spacing.cellBulletIndent } : undefined}>
          {line.bullet ? <span aria-hidden="true">• </span> : null}
          <Runs runs={line.runs} />
        </div>
      ))}
    </>
  )
}

/**
 * One break of the rail: `z` (width 0, `run` high) then `F` (full width, `dead` high), both left floats that clear the
 * one before. The dead zone starts `RAIL_EPS` later than planned and ends where it was planned: a browser keeps float
 * positions in 1/64 px, so a line that ends exactly where the zone begins must not be pushed down by rounding.
 */
const RAIL_EPS = 0.05
/**
 * `drawn`: the heights are already the ones to draw (the flow's own rail, rounded to 1/64 px from absolute positions by
 * `quantiseRail`, so a long document does not drift, QE D24); a cell's rail is short and draws the plan plus the allowance.
 */
function RailPair({ run, dead, drawn = false }: { run: number; dead: number; drawn?: boolean }) {
  return (
    <>
      <div
        aria-hidden="true"
        style={{ float: 'left', clear: 'left', width: 0, height: drawn ? run : run + RAIL_EPS }}
      />
      <div
        aria-hidden="true"
        style={{ float: 'left', clear: 'left', width: '100%', height: drawn ? dead : Math.max(0, dead - RAIL_EPS) }}
      />
    </>
  )
}

// ─── tables: rows are never split, a break between rows is a shift, inside a row a rail in each cell (DD-70) ───

const RowContext = createContext<{ key: string; head: boolean }>({ key: '', head: false })

/** A table of the flow: an item of the pagination, named by `tableKey`; auto layout, wraps anywhere, no scroller. */
function FlowTable({ tableKey, after, children }: { tableKey: string; after: number; children: ReactNode }) {
  const g = usePaper()
  const paged = useContext(PagedContext)
  const anywhere = useContext(WrapContext).has(tableKey)
  return (
    <table
      data-flow="table"
      data-flow-key={tableKey}
      className={`w-full text-left ${anywhere ? 'wrap-anywhere' : 'wrap-break-word'}`}
      style={{
        ...typeStyle(g, 'table'),
        borderCollapse: 'separate',
        borderSpacing: 0,
        marginBottom: after,
        // the room the shifted rows left: padding, not margin — a margin would collapse with the next block's own and lose a pixel
        paddingBottom: paged?.tableExtra.get(tableKey) || undefined,
      }}
    >
      {children}
    </table>
  )
}

/** A row of a table: `index` counts the header as row 0, as the collector does. */
function FlowRow({
  tableKey,
  index,
  head = false,
  className,
  children,
}: {
  tableKey: string
  index: number
  head?: boolean
  className?: string
  children: ReactNode
}) {
  const value = useMemo(() => ({ key: `${tableKey}:${index}`, head }), [tableKey, index, head])
  return (
    <RowContext.Provider value={value}>
      <tr data-flow="row" data-flow-head={head ? '' : undefined} className={className}>
        {children}
      </tr>
    </RowContext.Provider>
  )
}

/**
 * A cell. Rules sit on the cells (right, bottom and top, the first cell also the left; the top rule is transparent
 * except on a header and on a row that starts a page, so that no row changes height when a break moves it) so a row moved to the next page carries its own. A row that follows a break moves by `translateY`; an
 * over-tall row has an empty float pair at the start of each cell and is clipped where it would paint in a gap.
 */
function FlowCell({
  as: Tag = 'td',
  first = false,
  className = '',
  colSpan,
  children,
}: {
  as?: 'td' | 'th'
  first?: boolean
  className?: string
  colSpan?: number
  children?: ReactNode
}) {
  const g = usePaper()
  const paged = useContext(PagedContext)
  const row = useContext(RowContext)
  const shift = paged?.rowShift.get(row.key)
  const rail = paged?.cellRail.get(row.key)
  const topRule = row.head || paged?.rowFirstOnPage.has(row.key) === true
  const classes = [
    'border-b border-r border-t border-paper-rule align-top',
    first ? 'border-l' : '',
    // every cell has a top border, so a row is as tall unpaged as paged; only a header and the first row on a page draw it
    topRule ? '' : 'border-t-transparent',
    row.head ? 'bg-paper-head font-semibold' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <Tag
      colSpan={colSpan}
      className={classes}
      style={{
        padding: g.cellPad,
        transform: shift ? `translateY(${shift}px)` : undefined,
        clipPath: clipPath(paged?.clip.get(row.key)),
      }}
    >
      {rail?.map((step, at) => (
        <RailPair key={at} run={step.run} dead={step.dead} />
      ))}
      {children}
    </Tag>
  )
}

interface BlocksProps {
  blocks: readonly Block[]
  /** The numbered sub-headings of the section these blocks are, in markup order; null = headings print as written. */
  labels: readonly string[] | null
  /** Which sub-heading each heading block is, depth-first in markup order (the order `numberOffer` numbers them in). */
  order: ReadonlyMap<Block, number>
  /** Where these blocks sit in the document: the stable name of their tables. */
  scope: string
}

function headingOrder(blocks: readonly Block[], found: Map<Block, number>): Map<Block, number> {
  for (const block of blocks) {
    if (block.type === 'heading') found.set(block, found.size)
    else if (block.type === 'list') for (const item of block.items) headingOrder(item.children, found)
  }
  return found
}

function Blocks({ blocks, labels, order, scope }: BlocksProps): ReactNode {
  const g = usePaper()
  const sp = g.spacing
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'paragraph':
            return (
              <FlowText key={index} style={{ marginBottom: sp.paragraphAfterRatio * g.type.body.fontPx }}>
                <Runs runs={block.runs} />
              </FlowText>
            )
          case 'heading': {
            const label = labels === null ? block.text : (labels[order.get(block) ?? -1] ?? block.text)
            return (
              <FlowText
                key={index}
                as="h5"
                role="subheading"
                keep
                className="font-semibold"
                style={{ marginTop: sp.subHeadingBefore, marginBottom: sp.paragraphAfterRatio * g.type.body.fontPx }}
              >
                {label}
              </FlowText>
            )
          }
          case 'list':
            return (
              <ul
                key={index}
                className="list-none"
                style={{ margin: 0, marginBottom: sp.listAfter, paddingLeft: sp.listIndent }}
              >
                {block.items.map((item, at) => (
                  <li key={at} style={{ marginBottom: sp.listItemAfter }}>
                    <FlowText as="div">
                      <span style={{ marginRight: sp.listIndent }}>{item.marker}</span>
                      <Runs runs={item.runs} />
                    </FlowText>
                    {item.children.length > 0 ? (
                      <Blocks blocks={item.children} labels={labels} order={order} scope={`${scope}/${index}.${at}`} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          case 'table': {
            const key = `t:${scope}/${index}`
            return (
              <FlowTable key={index} tableKey={key} after={sp.tableAfter}>
                <thead>
                  <FlowRow tableKey={key} index={0} head>
                    {block.header.map((cell, at) => (
                      <FlowCell as="th" key={at} first={at === 0}>
                        <CellLines lines={cell} />
                      </FlowCell>
                    ))}
                  </FlowRow>
                </thead>
                <tbody>
                  {block.rows.map((row, at) => (
                    <FlowRow key={at} tableKey={key} index={at + 1}>
                      {row.map((cell, cellAt) => (
                        <FlowCell key={cellAt} first={cellAt === 0}>
                          <CellLines lines={cell} />
                        </FlowCell>
                      ))}
                    </FlowRow>
                  ))}
                </tbody>
              </FlowTable>
            )
          }
        }
      })}
    </>
  )
}

/** A body of 018 markup as blocks; `labels` are the numbered sub-headings the engine gave this section. */
function Markup({
  source,
  labels,
  scope,
}: {
  source: string
  labels: readonly string[] | null
  scope: string
}): ReactNode {
  const blocks = useMemo(() => parseMarkup(source), [source])
  const order = useMemo(() => headingOrder(blocks, new Map()), [blocks])
  return <Blocks blocks={blocks} labels={labels} order={order} scope={scope} />
}

/**
 * A heading with its number (DD-46, DD-47): when its text carries a marker the engine's own string has printed it as
 * "?", so the heading is composed from the number and the split text — text upper-cased as the engine does, a missing
 * value a marked run — otherwise the engine's heading is drawn as it is.
 */
function Heading({ number, source, whole }: { number: string; source: string; whole: string }): ReactNode {
  const pieces = splitMarked(source)
  if (pieces.every((piece) => piece.kind === 'text')) return whole
  return (
    <>
      {number}
      {pieces.map((piece, index) =>
        piece.kind === 'text' ? (
          <Fragment key={index}>{upper(piece.text)}</Fragment>
        ) : piece.kind === 'missing' ? (
          <MissingRun key={index} label={piece.label} surface="paper" />
        ) : (
          <PendingRun key={index} label={piece.label} surface="paper" />
        ),
      )}
    </>
  )
}

function CostTable({
  resolved,
  language,
  currency,
  scope,
}: {
  resolved: ResolvedOffer
  language: 'en' | 'it'
  currency: 'CHF' | 'EUR'
  scope: string
}) {
  const g = usePaper()
  const w = words(language)
  const { columns, labels, showTotals, rows, result } = resolved.costs
  const unitLabel = labels.unit ?? w.unit(currency)
  const quantityLabel = labels.quantity ?? w.quantity
  const span = 1 + (columns.position ? 1 : 0) + (columns.unit ? 2 : 0)
  const key = `t:${scope}/cost`
  // the rows that print, in order: a row's index in the table is its place among them (the header is 0)
  const visible: { row: (typeof rows)[number]; out: (typeof result.rows)[number]; index: number }[] = []
  rows.forEach((row, index) => {
    const out = result.rows[index]
    if (!out) return
    if (row.type === 'total' ? showTotals && out.type === 'total' : out.type === 'line')
      visible.push({ row, out, index })
  })
  return (
    <FlowTable tableKey={key} after={g.spacing.costTableAfter}>
      <thead>
        <FlowRow tableKey={key} index={0} head>
          {columns.position ? (
            <FlowCell as="th" first>
              {w.position}
            </FlowCell>
          ) : null}
          <FlowCell as="th" first={!columns.position}>
            {w.item}
          </FlowCell>
          {columns.unit ? (
            <>
              <FlowCell as="th" className="text-right">
                <MarkedText text={unitLabel} surface="paper" />
              </FlowCell>
              <FlowCell as="th" className="text-right">
                <MarkedText text={quantityLabel} surface="paper" />
              </FlowCell>
            </>
          ) : null}
          <FlowCell as="th" className="text-right">
            {w.amount(currency)}
          </FlowCell>
        </FlowRow>
      </thead>
      <tbody>
        {visible.map(({ row, out, index }, at) => {
          if (row.type === 'total' && out.type === 'total') {
            return (
              <FlowRow key={index} tableKey={key} index={at + 1} className="font-semibold">
                <FlowCell colSpan={span} first>
                  <MarkedText text={row.label} surface="paper" />
                </FlowCell>
                <FlowCell className="text-right">
                  {out.state === 'ok' && out.totalCents !== null ? (
                    formatAmount(out.totalCents, currency)
                  ) : (
                    <>
                      –
                      {out.state === 'incomplete' ? (
                        <VisuallyHidden data-chrome="">{t.costs.spanIncomplete}</VisuallyHidden>
                      ) : null}
                    </>
                  )}
                </FlowCell>
              </FlowRow>
            )
          }
          if (row.type !== 'line' || out.type !== 'line') return null
          const discount = row.kind === 'discount'
          const percent = discount && row.percentBp !== null
          return (
            <FlowRow key={index} tableKey={key} index={at + 1}>
              {columns.position ? <FlowCell first>{out.position === null ? '' : String(out.position)}</FlowCell> : null}
              <FlowCell first={!columns.position}>
                {row.kind === 'option' ? '□ ' : null}
                <MarkedText text={row.description} surface="paper" />
                {percent && !columns.unit ? ` (${formatPercent(row.percentBp!)})` : null}
              </FlowCell>
              {columns.unit ? (
                <>
                  <FlowCell className="text-right">
                    {percent
                      ? formatPercent(row.percentBp!)
                      : row.unitCents === null
                        ? ''
                        : `${discount ? '- ' : ''}${formatAmount(row.unitCents, currency)}`}
                  </FlowCell>
                  <FlowCell className="text-right">{percent ? '' : String(row.quantity ?? 1)}</FlowCell>
                </>
              ) : null}
              <FlowCell className="text-right">
                {out.totalCents === null ? '–' : `${discount ? '- ' : ''}${formatAmount(out.totalCents, currency)}`}
              </FlowCell>
            </FlowRow>
          )
        })}
      </tbody>
    </FlowTable>
  )
}

function EffortAnnexTable({ annex, language }: { annex: EffortAnnexPreview; language: 'en' | 'it' }) {
  const g = usePaper()
  const w = words(language)
  const days = (tenths: number): string => formatNumber(`${Math.trunc(tenths / 10)}.${tenths % 10}`, language)
  const key = 't:effort'
  let index = 0
  return (
    <FlowTable tableKey={key} after={g.spacing.tableAfter}>
      <thead>
        <FlowRow tableKey={key} index={0} head>
          <FlowCell as="th" first>
            {w.release}
          </FlowCell>
          <FlowCell as="th">{w.epic}</FlowCell>
          <FlowCell as="th" className="text-right">
            {w.manDays}
          </FlowCell>
        </FlowRow>
      </thead>
      <tbody>
        {annex.releases.map((release, at) => (
          <Fragment key={at}>
            <FlowRow tableKey={key} index={++index} className="font-semibold">
              <FlowCell first>{release.name}</FlowCell>
              <FlowCell />
              <FlowCell className="text-right">{days(release.manDaysTenths)}</FlowCell>
            </FlowRow>
            {release.epics.map((epic, epicAt) => (
              <FlowRow key={epicAt} tableKey={key} index={++index}>
                <FlowCell first />
                <FlowCell>{epic.epic}</FlowCell>
                <FlowCell className="text-right">{days(epic.manDaysTenths)}</FlowCell>
              </FlowRow>
            ))}
          </Fragment>
        ))}
        <FlowRow tableKey={key} index={++index} className="font-semibold">
          <FlowCell colSpan={2} first>
            {w.annexTotal}
          </FlowCell>
          <FlowCell className="text-right">{days(annex.manDaysTenths)}</FlowCell>
        </FlowRow>
      </tbody>
    </FlowTable>
  )
}

function SectionView({
  section,
  numbered,
  resolved,
  language,
  currency,
  scope,
}: {
  section: ResolvedSection
  numbered: NumberedSection
  resolved: ResolvedOffer
  language: 'en' | 'it'
  currency: 'CHF' | 'EUR'
  scope: string
}) {
  const g = usePaper()
  const paged = useContext(PagedContext)
  const key = `h:${scope}`
  return (
    // the one block of the flow that paints (a rule on its left): it is cut where a page break would draw it in a gap
    <section
      className={section.handEdited ? 'border-l-2 border-paper-ink' : undefined}
      style={
        section.handEdited
          ? { paddingLeft: g.spacing.listIndent * 3, clipPath: clipPath(paged?.clip.get(key)) }
          : undefined
      }
      data-section={section.key}
      data-flow-paint={section.handEdited ? '' : undefined}
      data-flow-key={section.handEdited ? key : undefined}
    >
      <FlowText
        as="h4"
        role="heading"
        keep
        className="font-semibold"
        style={{ marginTop: g.spacing.sectionBefore, marginBottom: g.spacing.sectionHeadingAfter }}
      >
        <Heading number={`${numbered.number}. `} source={section.heading} whole={numbered.heading} />
      </FlowText>
      {section.handEdited ? (
        <FlowText role="note" keep className="text-paper-soft" data-chrome="">
          {t.preview.edited}
        </FlowText>
      ) : null}
      {section.costs ? <CostTable resolved={resolved} language={language} currency={currency} scope={scope} /> : null}
      <Markup source={section.body} labels={numbered.subheadings} scope={scope} />
    </section>
  )
}

/**
 * The document the answers make, drawn as the PDF will print it (design § Preview pane; AC-3.1, AC-3.2, AC-3.3,
 * AC-5.2): React elements from `ResolvedOffer` — numbers, letters and the index from `numberOffer`, cost rows from
 * `computeCosts`, amounts and dates in the document's formatting, fixed words in the offer's language — on the
 * `paper-*` tokens, which stay light in both themes. A value still missing is a highlighted "⟦Label⟧" with a hidden
 * "Missing:" prefix; the reference not yet assigned a dashed run. Plain surfaces (headings, annex titles, cost
 * descriptions) are split on the marker characters and never parsed as markup (DD-47). It catches up 250 ms after
 * the last change.
 *
 * PAGES (OA-3, DD-65, DD-69, DD-71): ONE flow of real text over a decorative page layer — N A4 boxes, each with the
 * same letterhead image while it is `shown`. Where a page ends a rail of empty floats at the start of the flow keeps
 * the dead zone free of text (CSS 2.1 § 9.5), so a sentence cut by a break is still one text run: found, selected and
 * read as one. Nothing inside the flow may be a block formatting context but a table and a cell (the invariant of
 * DD-70: no overflow, flex, grid, flow-root or inline-block in it, and no block but the hand-edited section paints).
 */
export default function DocumentPreview({
  ast,
  answers,
  context,
  effortAnnex = null,
  debounceMs = 250,
  heading = true,
  fit = false,
  fill = false,
  letterhead,
  issuerLabel,
}: DocumentPreviewProps) {
  const regionRef = useRef<HTMLDivElement>(null)
  const flowRef = useRef<HTMLElement>(null)
  const probeRef = useRef<HTMLSpanElement>(null)
  const fitHeight = useFitToScrollport(regionRef, fit)
  const [settled, setSettled] = useState<Inputs>({ ast, answers, context })
  const pending = settled.ast !== ast || settled.answers !== answers || settled.context !== context
  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => setSettled({ ast, answers, context }), debounceMs)
    return () => clearTimeout(timer)
  }, [pending, ast, answers, context, debounceMs])

  // the first preview mounted is the moment the letterhead is "first needed" (DD-54); the attempt is idempotent
  const requestLetterhead = letterhead?.request
  useEffect(() => {
    requestLetterhead?.()
  }, [requestLetterhead])

  const resolved = useMemo(() => resolveOffer(settled.ast, settled.answers, settled.context), [settled])
  const language = resolved.language
  const currency = settled.context.currency
  const w = words(language)

  const attachmentNames = useMemo(
    () =>
      resolved.attachmentIds.flatMap((id) => {
        const file = settled.context.attachments.find((candidate) => candidate.id === id)
        return file ? [file.fileName] : []
      }),
    [resolved, settled.context],
  )
  const numbered = useMemo(
    () =>
      numberOffer({
        language,
        sections: resolved.sections.map(({ key, heading: text, body }) => ({ key, heading: unmarked(text), body })),
        annexes: resolved.annexes.map((annex) => ({
          designation: annex.designation,
          title: unmarked(annex.title),
          sections: annex.sections.map(({ key, heading: text, body }) => ({ key, heading: unmarked(text), body })),
        })),
        effortAnnex: resolved.effortAnnex,
        attachmentNames,
      }),
    [resolved, language, attachmentNames],
  )

  // what the pages are laid out for: the settled resolution and the effort figures, never the letterhead (AC-11.4)
  const contentKey = useMemo(() => ({}), [resolved, effortAnnex, attachmentNames, numbered]) // eslint-disable-line react-hooks/exhaustive-deps
  const {
    geometry: g,
    layout,
    stage,
    wrapAnywhere,
    unpaged,
    version,
  } = usePagination({ regionRef, flowRef, probeRef, contentKey })
  const sp = g.spacing
  const pageNumber = pageNumberGeometry(g)
  const flowRail = useMemo(() => quantiseRail(layout?.rail ?? [], RAIL_EPS), [layout])

  const [titleBefore, titleAfter] = w.title(REFERENCE_SPOT).split(REFERENCE_SPOT)
  const { client } = resolved
  const printedDate = client.date === null ? '' : shortDate(client.date)

  const state = letterhead?.state ?? 'pending'
  const issuer = issuerLabel ?? settled.context.issuerLegalName
  // from the settled resolution, the one the pages print: the notice and its cause appear together (G16)
  const addressUnset =
    resolved.systemRead.includes('issuerAddress') &&
    settled.context.issuerAddressLines.every((line) => line.trim() === '')

  return (
    <div className={`flex flex-col gap-3${fill ? ' h-full min-h-0' : ''}`}>
      {heading ? (
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-disp text-base text-text">{t.preview.title}</h3>
          {resolved.missing.length > 0 ? (
            <Badge tone="warning" glyph={<Icon name="alert" />}>
              {t.preview.missingBadge(resolved.missing.length)}
            </Badge>
          ) : null}
        </div>
      ) : null}
      <p
        className="min-h-14 text-xs text-soft"
        data-chrome=""
        data-state={state}
        data-testid="crm-wizard-letterhead-band"
      >
        {state === 'shown' ? (
          t.preview.letterheadShown
        ) : state === 'unusable' ? (
          `${strings.offers.errors.letterheadUnusable(issuer)} ${t.preview.letterheadUnusableTail}`
        ) : (
          <>
            <span>
              {state === 'none'
                ? t.preview.letterheadNone(issuer)
                : state === 'failed'
                  ? t.preview.letterheadFailed(issuer)
                  : t.preview.letterhead(issuer)}
            </span>{' '}
            <span>{t.preview.note}</span>
          </>
        )}
      </p>
      {unpaged ? (
        <Banner tone="info" live="polite" compact data-testid="crm-wizard-unpaged-notice">
          {t.preview.unpagedNotice}
        </Banner>
      ) : null}
      {addressUnset ? (
        <Banner
          tone="warning"
          live="off"
          compact
          aria-label={t.preview.addressNoticeLabel}
          data-testid="crm-wizard-address-notice"
        >
          {t.preview.addressNotice(issuer)}
        </Banner>
      ) : null}
      <div
        ref={regionRef}
        role="region"
        aria-label={t.preview.title}
        tabIndex={0}
        aria-busy={pending}
        className={`relative overflow-auto overscroll-contain rounded-md border border-rule [scrollbar-gutter:stable]${fill ? ' min-h-0 flex-1' : fit ? '' : ' max-h-[80vh]'}`}
        style={fitHeight === null ? undefined : { height: fitHeight }}
        data-testid="crm-wizard-preview"
      >
        <PaperContext.Provider value={g}>
          <PagedContext.Provider value={layout}>
            <WrapContext.Provider value={wrapAnywhere}>
              <div
                className="relative bg-ink-mid"
                style={{ height: stage.stageHeight }}
                data-testid="crm-wizard-stage"
                data-pages={stage.pageBoxes.length}
                data-layout={version}
              >
                {/* the page layer: decorative, behind the flow, one A4 box per page and the same image on each (DD-71) */}
                <div aria-hidden="true" inert data-testid="crm-wizard-pages">
                  {stage.pageBoxes.map((box, index) => (
                    <div
                      key={index}
                      className="absolute border border-muted bg-paper"
                      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                      data-testid="crm-wizard-page"
                    >
                      {state === 'shown' && letterhead?.src ? (
                        <img
                          src={letterhead.src}
                          alt=""
                          aria-hidden="true"
                          draggable={false}
                          decoding="sync"
                          className="h-full w-full select-none object-fill pointer-events-none"
                          data-testid="crm-wizard-letterhead"
                        />
                      ) : null}
                      {/* the page number as the PDF prints it (D-2): the letterhead's own "1/1" covered in white, as the PDF paints it (the image is opaque white, so paper-coloured would show as a patch), then ours */}
                      {state === 'shown' && letterhead?.src ? (
                        <div
                          className="absolute bg-white"
                          style={pageNumber.corner}
                          data-testid="crm-wizard-page-number-cover"
                        />
                      ) : null}
                      <span
                        className="absolute whitespace-nowrap text-right font-body text-paper-soft"
                        style={{
                          right: pageNumber.right,
                          bottom: pageNumber.bottomPx,
                          fontSize: pageNumber.fontPx,
                          lineHeight: 1,
                        }}
                        data-testid="crm-wizard-page-number"
                      >
                        {`${index + 1}/${stage.pageBoxes.length}`}
                      </span>
                    </div>
                  ))}
                  {/* 1rem, so a change of the root font size reaches the layout (DD-69) */}
                  <span ref={probeRef} className="pointer-events-none invisible absolute left-0 top-0 h-0 w-4" />
                </div>
                <article
                  ref={flowRef}
                  lang={language}
                  className="flow-root absolute font-body text-paper-ink wrap-anywhere"
                  style={{
                    left: g.left + g.frame.left,
                    top: g.inset + g.frame.top,
                    width: g.width - g.frame.left - g.frame.right,
                    ...typeStyle(g, 'body'),
                  }}
                  data-testid="crm-wizard-flow"
                >
                  {flowRail.map((step, index) => (
                    <RailPair key={index} run={step.run} dead={step.dead} drawn />
                  ))}
                  <FlowText>{resolved.salutation}</FlowText>
                  {client.lines.map((line, index) => (
                    <FlowText
                      key={index}
                      className={index === 0 ? 'font-semibold' : undefined}
                      style={index === client.lines.length - 1 ? { marginBottom: sp.clientAfter } : undefined}
                    >
                      {line}
                    </FlowText>
                  ))}
                  {client.contacts.length > 0 ? (
                    <FlowText className="font-semibold" style={{ marginBottom: sp.contactsAfter }}>
                      {`${w.attn} ${client.contacts.join(', ')}`}
                    </FlowText>
                  ) : null}
                  <FlowText className="text-right" style={{ marginBottom: sp.dateAfter }}>
                    {client.place ? `${client.place}, ${printedDate}` : printedDate}
                  </FlowText>
                  <FlowText role="title" className="text-center font-semibold" style={{ marginBottom: sp.titleAfter }}>
                    {titleBefore}
                    <PendingRun label="" surface="paper" />
                    {titleAfter}
                  </FlowText>
                  {numbered.index ? (
                    <>
                      <FlowText keep className="font-semibold" style={{ marginBottom: sp.indexTitleAfter }}>
                        {w.index}
                      </FlowText>
                      <ul className="list-none" style={{ margin: 0, padding: 0, marginBottom: sp.indexAfter }}>
                        {numbered.index.map((entry) => (
                          <li key={entry.target}>
                            <FlowText as="div">{entry.label}</FlowText>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  <Markup source={resolved.opening} labels={null} scope="o" />
                  {resolved.sections.map((section, index) => (
                    <SectionView
                      key={section.key}
                      section={section}
                      numbered={numbered.sections[index]!}
                      resolved={resolved}
                      language={language}
                      currency={currency}
                      scope={`s${index}`}
                    />
                  ))}
                  <div data-flow="unit" style={{ marginTop: sp.acceptanceBefore }}>
                    <p
                      className="font-semibold"
                      style={{ ...typeStyle(g, 'body'), marginBottom: sp.acceptanceTitleAfter }}
                    >
                      {w.acceptance}
                    </p>
                    {resolved.acceptanceLabel ? (
                      <p className="font-semibold" style={typeStyle(g, 'body')}>
                        {resolved.acceptanceLabel}
                      </p>
                    ) : null}
                    {[w.place, w.signature].map((label) => (
                      <p
                        key={label}
                        className="border-b border-paper-rule"
                        style={{
                          ...typeStyle(g, 'body'),
                          marginTop: sp.acceptanceLineGap,
                          paddingBottom: Math.max(0, sp.acceptanceLineHeight - g.type.body.lineHeightPx),
                        }}
                      >
                        {label}
                      </p>
                    ))}
                  </div>
                  {numbered.annexList.length > 0 ? (
                    <div style={{ marginTop: sp.acceptanceBefore }}>
                      <FlowText keep className="font-semibold" style={{ marginBottom: sp.annexListTitleAfter }}>
                        {w.annexes}
                      </FlowText>
                      <ul className="list-none" style={{ margin: 0, padding: 0 }}>
                        {numbered.annexList.map((line, index) => (
                          <li key={index}>
                            <FlowText
                              as="div"
                              style={{
                                paddingLeft: sp.bulletTextIndent,
                                textIndent: -sp.bulletTextIndent + sp.bulletMarkerIndent,
                              }}
                            >
                              <span aria-hidden="true">• </span>
                              {line}
                            </FlowText>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {resolved.annexes.map((annex, index) => {
                    const entry = numbered.annexes[index]!
                    const withSubtitle = annex.subtitle !== null && annex.subtitle.trim() !== ''
                    return (
                      <section key={annex.designation}>
                        <FlowText
                          as="h4"
                          role="heading"
                          keep
                          breakBefore
                          className="font-semibold"
                          style={{
                            marginBottom: withSubtitle ? sp.annexHeadingAfterWithSubtitle : sp.annexHeadingAfter,
                          }}
                        >
                          <Heading
                            number={`${upper(w.annex)} ${annex.designation}${annex.title === '' ? '' : ' – '}`}
                            source={annex.title}
                            whole={entry.heading}
                          />
                        </FlowText>
                        {withSubtitle ? (
                          <FlowText className="italic" style={{ marginBottom: sp.annexSubtitleAfter }}>
                            <MarkedText text={annex.subtitle!.trim()} surface="paper" />
                          </FlowText>
                        ) : null}
                        <Markup source={annex.intro} labels={null} scope={`a${index}`} />
                        {annex.sections.map((section, at) => (
                          <SectionView
                            key={section.key}
                            section={section}
                            numbered={entry.sections[at]!}
                            resolved={resolved}
                            language={language}
                            currency={currency}
                            scope={`a${index}.${at}`}
                          />
                        ))}
                      </section>
                    )
                  })}
                  {resolved.effortAnnex && numbered.effortAnnexLetter ? (
                    <section>
                      <FlowText
                        as="h4"
                        role="heading"
                        keep
                        breakBefore
                        className="font-semibold"
                        style={{ marginBottom: sp.annexHeadingAfter }}
                      >
                        {w.annexHeading(numbered.effortAnnexLetter)}
                      </FlowText>
                      {resolved.aiAssisted ? (
                        <FlowText role="note" keep className="italic" style={{ marginBottom: sp.annexSubtitleAfter }}>
                          {w.aiNote}
                        </FlowText>
                      ) : null}
                      {effortAnnex ? <EffortAnnexTable annex={effortAnnex} language={language} /> : null}
                    </section>
                  ) : null}
                  {attachmentNames.map((name, index) => (
                    <FlowText
                      key={name + index}
                      role="note"
                      className="text-paper-soft"
                      style={{ marginTop: sp.paragraphAfterRatio * g.type.body.fontPx }}
                      data-chrome=""
                    >
                      {`${upper(w.annex)} ${numbered.attachmentLetters[index]} — ${t.preview.annexAppended(name)}`}
                    </FlowText>
                  ))}
                </article>
              </div>
            </WrapContext.Provider>
          </PagedContext.Provider>
        </PaperContext.Provider>
      </div>
    </div>
  )
}
