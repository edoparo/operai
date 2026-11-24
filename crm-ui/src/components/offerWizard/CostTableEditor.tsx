import { useMemo, useState, type ReactNode } from 'react'
import { Badge, Button, Card, Icon, StatePanel, VisuallyHidden, formatMoney } from '@operai/ui'
import type { CostLineAnswer, OfferLanguage, WizardAnswers } from '../../lib/offerEngine/answers'
import { MAX_COST_LINES, type CostRowOut } from '../../lib/offerEngine/costs'
import { formatAmount, formatPercent } from '../../lib/offerEngine/format'
import type { OutlineItem } from '../../lib/offerEngine/outline'
import type { InvalidCode, ResolvedCostRow } from '../../lib/offerEngine/resolve'
import type { CostLineAst, CostsAst, Inline } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'
import DraftInput from './CostInputs'
import { centsText, parseCents, parseCount, percentText } from './costValues'
import { MarkedText } from './MarkedText'
import { splitMarked } from './splitMarked'
import StepForm from './StepForm'
import type { StepPanelProps } from './StepPanel'
import TemplateText from './TemplateText'
import ValidityDaysInput from './ValidityDaysInput'
import { useFocusRequest } from './useFocusRequest'

const t = strings.offerWizard

type CostKind = ResolvedCostRow extends infer R ? (R extends { type: 'line'; kind: infer K } ? K : never) : never
type LineRow = Extract<ResolvedCostRow, { type: 'line' }>
type LineOut = Extract<CostRowOut, { type: 'line' }>
type Extra = WizardAnswers['costs']['extra'][number]
type CostTableItem = Extract<OutlineItem, { type: 'costTable' }>

const EXTRA_NAME = /^cost:extra:(.+)$/
const LINE_NAME = /^cost:([a-z][a-z0-9_]*)(?:#(\d+))?$/
const KINDS: readonly CostKind[] = ['one_off', 'yearly', 'discount', 'option']
const MAX_DESCRIPTION = 200

const isBlank = (value: string | number | undefined): boolean => value === undefined || String(value).trim() === ''

function newExtraId(): string {
  const random = globalThis.crypto?.randomUUID?.()
  return random ?? `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function flatten(items: readonly OutlineItem[]): OutlineItem[] {
  return items.flatMap((item) => (item.type === 'block' ? [item, ...flatten(item.children)] : [item]))
}

/** The field names an inline text reads, conditions included. */
function namesIn(nodes: readonly Inline[], into: string[]): string[] {
  for (const node of nodes) {
    if (node.type === 'field') {
      if (!into.includes(node.name)) into.push(node.name)
    } else if (node.type === 'cond') {
      namesIn(node.children, into)
    }
  }
  return into
}

/** A plain surface as a label: the text, a missing value as its label. */
const plainLabel = (text: string): string =>
  splitMarked(text)
    .map((piece) => (piece.kind === 'text' ? piece.text : piece.label))
    .join('')

/** Drops from the generic form the field items a cost line edits itself (and an emptied costTable). */
function prune(items: readonly OutlineItem[], taken: ReadonlySet<string>): OutlineItem[] {
  const kept: OutlineItem[] = []
  for (const item of items) {
    if (item.type === 'costTable' || (item.type === 'field' && taken.has(item.name))) continue
    kept.push(item.type === 'block' ? { ...item, children: prune(item.children, taken) } : item)
  }
  return kept
}

interface LineView {
  row: LineRow
  out: LineOut
  /** 1-based among the lines. */
  number: number
  source:
    { type: 'template'; item: CostLineAst; repeat: number | null } | { type: 'extra'; extra: Extra; index: number }
}

/**
 * The Costs step (design S5; AC-2.5, AC-4.1 to AC-4.4, AC-4.6, AC-4.7): the cost table the way the document
 * prints it — lines and total rows in order, from `ResolvedOffer.costs` — with each line's inputs in its card.
 * The unit or quantity a line is bound to IS that field (edited here, not repeated below); the lines a person adds
 * go before the last total row; every figure and position is the engine's, every error is an `invalid` entry shown
 * on the line it names. The step's other items are the generic form below.
 */
export default function CostTableEditor(props: StepPanelProps) {
  const { ast, answers, onAnswersChange, context, outline, resolved, onGoToStep } = props
  const [announcement, setAnnouncement] = useState('')
  const [ownPercent, setOwnPercent] = useState<ReadonlySet<string>>(() => new Set())
  const percentChosen = props.percentChosen ?? ownPercent
  const setPercentChosen = props.onPercentChosen ?? setOwnPercent
  const { root, request } = useFocusRequest<HTMLDivElement>()
  const language = context.language
  const currency = context.currency

  const costsAst: CostsAst | null = useMemo(
    () => ast.sections.find((section) => section.costs !== null)?.costs ?? null,
    [ast],
  )
  const everyItem = useMemo(() => flatten(outline.steps.flatMap((step) => step.items)), [outline])
  const stepItems = useMemo(
    () => outline.steps.find((step) => step.key === props.step)?.items ?? [],
    [outline, props.step],
  )
  const tableItem = everyItem.find((item): item is CostTableItem => item.type === 'costTable') ?? null

  const rows = resolved.costs.rows
  const outRows = resolved.costs.result.rows
  const totalRows = rows.filter((row) => row.type === 'total').length
  const lineCount = rows.length - totalRows

  const codes = useMemo(() => {
    const byName = new Map<string, InvalidCode[]>()
    for (const issue of resolved.invalid) byName.set(issue.name, [...(byName.get(issue.name) ?? []), issue.code])
    return byName
  }, [resolved])
  const missing = useMemo(() => new Set(resolved.missing.map((issue) => issue.name)), [resolved])
  const errorsOf = (name: string): string[] => (codes.get(name) ?? []).map((code) => t.invalid[code])

  // ─── the lines, and which field items each card edits ───
  const views = useMemo(() => {
    const found: (
      LineView | { total: Extract<ResolvedCostRow, { type: 'total' }>; out: Extract<CostRowOut, { type: 'total' }> }
    )[] = []
    let number = 0
    rows.forEach((row, index) => {
      const out = outRows[index]
      if (!out) return
      if (row.type === 'total') {
        if (out.type === 'total') found.push({ total: row, out })
        return
      }
      if (out.type !== 'line') return
      number += 1
      const extraMatch = EXTRA_NAME.exec(row.name)
      if (extraMatch) {
        const extraIndex = answers.costs.extra.findIndex((extra) => extra.id === extraMatch[1])
        if (extraIndex !== -1)
          found.push({
            row,
            out,
            number,
            source: { type: 'extra', extra: answers.costs.extra[extraIndex]!, index: extraIndex },
          })
        return
      }
      const lineMatch = LINE_NAME.exec(row.name)
      const item = lineMatch
        ? costsAst?.items.find((entry): entry is CostLineAst => entry.type === 'line' && entry.key === lineMatch[1])
        : undefined
      if (item)
        found.push({
          row,
          out,
          number,
          source: { type: 'template', item, repeat: lineMatch![2] ? Number(lineMatch![2]) : null },
        })
    })
    return found
  }, [rows, outRows, answers.costs.extra, costsAst])

  const fieldByName = useMemo(
    () => new Map(everyItem.filter((item) => item.type === 'field').map((item) => [item.name, item])),
    [everyItem],
  )
  const columnTables = useMemo(() => {
    const owner = new Map<string, string>()
    for (const table of ast.tables) for (const column of table.columns) owner.set(column, table.name)
    return owner
  }, [ast])

  /** The plain fields a template line reads, each handed to the FIRST card that shows it. */
  const cardFields = useMemo(() => {
    const shown = new Set<string>()
    const byRow = new Map<string, OutlineItem[]>()
    for (const view of views) {
      if (!('source' in view) || view.source.type !== 'template') continue
      const item = view.source.item
      const names = namesIn(item.description, [])
      if (item.unit.type === 'field' && !names.includes(item.unit.name)) names.push(item.unit.name)
      if (item.qty?.type === 'field' && !names.includes(item.qty.name)) names.push(item.qty.name)
      const mine: OutlineItem[] = []
      for (const name of names) {
        if (columnTables.has(name) || ast.lists.some((list) => list.name === name) || shown.has(name)) continue
        const field = fieldByName.get(name)
        if (field) {
          shown.add(name)
          mine.push(field)
        }
      }
      byRow.set(view.row.name, mine)
    }
    return { byRow, shown }
  }, [views, columnTables, fieldByName, ast.lists])

  const generic = useMemo(() => prune(stepItems, cardFields.shown), [stepItems, cardFields])
  const validityBound = everyItem.some((item) => item.type === 'field' && item.system === 'validityDays')

  // ─── changing the answers ───
  const patchCosts = (patch: Partial<WizardAnswers['costs']>) =>
    onAnswersChange({ ...answers, costs: { ...answers.costs, ...patch } })
  const patchLine = (key: string, patch: Partial<CostLineAnswer>) =>
    patchCosts({ lines: { ...answers.costs.lines, [key]: { ...answers.costs.lines[key], ...patch } } })
  const patchExtra = (id: string, patch: Partial<Extra>) =>
    patchCosts({ extra: answers.costs.extra.map((extra) => (extra.id === id ? { ...extra, ...patch } : extra)) })

  const atLimit = lineCount >= MAX_COST_LINES
  // "Add option line" (2026-11-24) is the same row with the kind `option` already chosen: printed with a box to tick,
  // counted in no total.
  const addExtra = (kind: CostKind = 'one_off') => {
    if (atLimit) return
    const id = newExtraId()
    request(`cost:extra:${id}`, 'description')
    patchCosts({
      extra: [
        ...answers.costs.extra,
        { id, description: '', kind, unitCents: null, percentBp: null, quantity: 1 },
      ],
    })
  }
  const removeExtra = (id: string) => {
    request(null, 'add')
    patchCosts({ extra: answers.costs.extra.filter((extra) => extra.id !== id) })
  }

  const setUnitColumns = (on: boolean) => {
    if (on) return patchCosts({ columns: { ...answers.costs.columns, unit: true } })
    // without the unit and quantity columns every entered quantity is 1 (as in the classic form)
    const lines = { ...answers.costs.lines }
    let forced = false
    for (const entry of costsAst?.items ?? []) {
      if (entry.type !== 'line' || (entry.qty?.type !== 'entered' && entry.qty?.type !== 'manDays')) continue
      const current = lines[entry.key]
      if (current && current.quantity !== 1 && current.quantity !== undefined) {
        lines[entry.key] = { ...current, quantity: 1 }
        forced = true
      }
    }
    const extra = answers.costs.extra.map((entry) => {
      if (entry.quantity === 1) return entry
      forced = true
      return { ...entry, quantity: 1 }
    })
    if (forced) setAnnouncement(t.costs.unitOffLive)
    patchCosts({ columns: { ...answers.costs.columns, unit: false }, lines, extra })
  }

  const blockStep = (block: string): { step: (typeof outline.steps)[number]['key']; name: string } | null => {
    for (const step of outline.steps) {
      for (const item of flatten(step.items)) {
        if (item.type === 'block' && item.name === block) return { step: step.key, name: item.name }
        if (item.type === 'choice' && item.options.some((option) => option.block === block))
          return { step: step.key, name: item.name }
      }
    }
    return null
  }
  const jumpTo = (step: (typeof outline.steps)[number]['key'], name: string) => {
    onGoToStep(step)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-wizard-field="${name}"]`)?.focus())
  }

  // ─── pieces of a card ───
  const unitLabel = t.costs.unit
  const money = (cents: number): string => formatMoney(cents, currency)

  /** Remembers that a discount line is (or no longer is) set to Percent: the answers hold no such state while it is empty. */
  const rememberPercent = (name: string, on: boolean) => {
    if (percentChosen.has(name) === on) return
    const next = new Set(percentChosen)
    if (on) next.add(name)
    else next.delete(name)
    setPercentChosen(next)
  }

  const amountOrPercent = (args: {
    name: string
    kind: CostKind
    percentBp: number | null
    unitCents: number | null
    allowPercent: boolean
    onAmount: (cents: number | null) => void
    onPercent: (bp: number | null) => void
    onMode: (mode: 'amount' | 'percent') => void
    missingValue: boolean
  }): ReactNode => {
    // the mode is the person's choice; a stored percentage is a choice too (a draft that was reloaded)
    const percent = args.kind === 'discount' && (args.percentBp !== null || percentChosen.has(args.name))
    const mode = percent ? 'percent' : 'amount'
    const toggle = args.kind === 'discount' && args.allowPercent && (totalRows < 2 || percent)
    return (
      <div className="flex flex-col gap-2">
        {toggle ? (
          <fieldset className="field m-0 min-w-0 border-0 p-0">
            <legend className="field-label">{t.costs.discountMode}</legend>
            <div className="radio-options">
              {(['amount', 'percent'] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`${args.name}-mode`}
                    checked={mode === value}
                    onChange={() => {
                      rememberPercent(args.name, value === 'percent')
                      args.onMode(value)
                    }}
                  />
                  {value === 'amount' ? t.costs.discountAmount : t.costs.discountPercent}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {mode === 'percent' ? (
          <DraftInput
            label={t.costs.discountPercentInput}
            value={args.percentBp}
            parse={parseCents}
            format={percentText}
            unreadable={t.invalid.not_a_number}
            onChange={(bp) => {
              // emptying the field is not choosing Amount
              rememberPercent(args.name, true)
              args.onPercent(bp)
            }}
            missing={args.missingValue}
            required
            money
            controlName="unit"
          />
        ) : (
          <DraftInput
            label={unitLabel}
            value={args.unitCents}
            parse={parseCents}
            format={centsText}
            unreadable={t.invalid.not_a_number}
            onChange={args.onAmount}
            missing={args.missingValue}
            required
            money
            controlName="unit"
          />
        )}
        {args.kind === 'discount' && !toggle ? <p className="field-hint">{t.costs.discountAmountOnly}</p> : null}
      </div>
    )
  }

  const fact = (label: string, value: string, note?: string): ReactNode => (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className="font-mono text-sm text-text">{value}</span>
      {note ? <span className="field-hint">{note}</span> : null}
    </div>
  )

  const lineTotal = (view: LineView): ReactNode => {
    const { row, out } = view
    const cents = out.totalCents
    const text = cents === null ? t.costs.spanEmpty : `${row.kind === 'discount' ? '−' : ''}${money(cents)}`
    return (
      <div className="field">
        <span className="field-label">{t.costs.total}</span>
        <span className="font-mono text-sm text-text">{text}</span>
        {cents === null ? <VisuallyHidden>{t.costs.spanIncomplete}</VisuallyHidden> : null}
      </div>
    )
  }

  const templateCard = (view: LineView & { source: { type: 'template' } }): ReactNode => {
    const { row, out } = view
    const { item, repeat } = view.source
    const key = item.key
    const entry = answers.costs.lines[key] ?? {}
    const lineErrors = errorsOf(row.name)
    const missingValue = missing.has(row.name)
    const block = tableItem?.lines.find((line) => line.key === key)?.block ?? null
    const where = block ? blockStep(block) : null
    const blockLabel = block ? (ast.blocks.find((entryBlock) => entryBlock.name === block)?.label ?? block) : null

    const tableName = item.each
    const table = tableName ? ast.tables.find((entryTable) => entryTable.name === tableName) : undefined
    const printed = table
      ? (answers.tables[table.name] ?? []).filter((r) => table.columns.some((column) => !isBlank(r.cells[column])))
      : []
    const tableRow = repeat !== null && table ? printed[repeat - 1] : undefined
    const heading = tableRow && table ? t.costs.row(String(tableRow.cells[table.columns[0]!] ?? '')) : null

    // unit
    let unit: ReactNode = null
    switch (item.unit.type) {
      case 'entered':
      case 'deal':
        unit = amountOrPercent({
          name: row.name,
          kind: row.kind,
          percentBp: entry.percentBp ?? null,
          unitCents: entry.unitCents ?? null,
          allowPercent: item.unit.type === 'entered' || item.unit.type === 'deal',
          onAmount: (cents) => patchLine(key, { unitCents: cents, percentBp: null }),
          onPercent: (bp) => patchLine(key, { percentBp: bp }),
          onMode: (mode) =>
            mode === 'percent'
              ? patchLine(key, { percentBp: null, unitCents: null })
              : patchLine(key, { percentBp: null }),
          missingValue,
        })
        break
      case 'perRelease': {
        const release = entry.releases?.[(repeat ?? 1) - 1]
        const releases = entry.releases ?? []
        unit = (
          <DraftInput
            label={unitLabel}
            value={release?.unitCents ?? null}
            parse={parseCents}
            format={centsText}
            unreadable={t.invalid.not_a_number}
            onChange={(cents) =>
              patchLine(key, {
                releases: releases.map((current, at) =>
                  at === (repeat ?? 1) - 1 ? { ...current, unitCents: cents } : current,
                ),
              })
            }
            missing={missingValue}
            required
            money
            controlName="unit"
          />
        )
        break
      }
      case 'field':
        if (columnTables.has(item.unit.name) && table)
          unit = fact(
            unitLabel,
            row.unitCents === null ? t.costs.spanEmpty : money(row.unitCents),
            t.costs.fromTable(table.label ?? table.name),
          )
        break
      case 'amount':
        unit = fact(unitLabel, money(item.unit.cents))
        break
      case 'percent':
        unit = fact(t.costs.discountPercentInput, formatPercent(item.unit.bp))
        break
    }

    // quantity
    let quantity: ReactNode = null
    const showQuantity = answers.costs.columns.unit
    switch (item.qty?.type) {
      case 'entered':
      case 'manDays':
        if (showQuantity) {
          quantity = (
            <DraftInput
              label={t.costs.quantity}
              value={entry.quantity ?? null}
              parse={parseCount}
              format={String}
              unreadable={t.invalid.not_integer}
              onChange={(value) => patchLine(key, { quantity: value })}
              missing={missingValue}
              required
              controlName="quantity"
            />
          )
        }
        break
      case 'field':
        if (columnTables.has(item.qty.name) && table)
          quantity = fact(t.costs.quantity, String(row.quantity ?? ''), t.costs.fromTable(table.label ?? table.name))
        break
      case 'literal':
        if (item.qty.value !== 1 && showQuantity) quantity = fact(t.costs.quantity, String(item.qty.value))
        break
      default:
        break
    }

    const releaseDescription =
      item.unit.type === 'perRelease' ? (
        <div className="field">
          <label className="field-label" htmlFor={`${row.name}-description`}>
            {t.costs.descriptionLabel}
          </label>
          <input
            id={`${row.name}-description`}
            type="text"
            value={entry.releases?.[(repeat ?? 1) - 1]?.description ?? ''}
            maxLength={MAX_DESCRIPTION}
            data-control="description"
            onChange={(event) => {
              const releases = entry.releases ?? []
              patchLine(key, {
                releases: releases.map((current, at) =>
                  at === (repeat ?? 1) - 1 ? { ...current, description: event.target.value } : current,
                ),
              })
            }}
          />
        </div>
      ) : null

    const fields = cardFields.byRow.get(row.name) ?? []
    return (
      <CardFrame
        name={row.name}
        label={plainLabel(row.description) || t.costs.lineNumber(view.number)}
        kind={row.kind}
        position={out.position}
        errors={lineErrors}
      >
        {heading ? <p className="text-xs text-soft">{heading}</p> : null}
        {blockLabel ? (
          <p className="text-xs text-soft">
            {where ? (
              <button type="button" className="link" onClick={() => jumpTo(where.step, where.name)}>
                {`${t.costs.comesWith(blockLabel)} (${t.steps[where.step]})`}
              </button>
            ) : (
              t.costs.comesWith(blockLabel)
            )}
          </p>
        ) : null}
        <p className="text-sm text-text">
          <TemplateText language={language as OfferLanguage}>
            <MarkedText text={row.description} />
          </TemplateText>
        </p>
        {fields.length > 0 ? <StepForm {...props} bare items={fields} /> : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {releaseDescription}
          {unit}
          {quantity}
          {lineTotal(view)}
        </div>
      </CardFrame>
    )
  }

  const extraCard = (view: LineView & { source: { type: 'extra' } }): ReactNode => {
    const { row } = view
    const { extra } = view.source
    const lineErrors = errorsOf(row.name)
    const missingValue = missing.has(row.name)
    return (
      <CardFrame
        name={row.name}
        label={extra.description.trim() === '' ? t.costs.lineNumber(view.number) : extra.description}
        kind={row.kind}
        position={view.out.position}
        errors={lineErrors}
        action={
          <Button
            variant="ghost"
            iconOnly
            aria-label={t.costs.remove(view.number)}
            onClick={() => removeExtra(extra.id)}
          >
            <Icon name="trash" />
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="field">
            <label className="field-label" htmlFor={`${row.name}-description`}>
              {t.costs.descriptionLabel}
              <span aria-hidden="true" className="field-required">
                *
              </span>
            </label>
            <input
              id={`${row.name}-description`}
              type="text"
              value={extra.description}
              maxLength={MAX_DESCRIPTION}
              aria-required="true"
              data-control="description"
              onChange={(event) => patchExtra(extra.id, { description: event.target.value })}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${row.name}-kind`}>
              {t.costs.kindLabel}
            </label>
            <select
              id={`${row.name}-kind`}
              value={extra.kind}
              onChange={(event) => {
                const kind = event.target.value as CostKind
                if (kind !== 'discount') rememberPercent(row.name, false)
                patchExtra(extra.id, { kind, ...(kind === 'discount' ? { quantity: 1 } : { percentBp: null }) })
              }}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t.costs.kind[kind]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {amountOrPercent({
            name: row.name,
            kind: extra.kind,
            percentBp: extra.kind === 'discount' ? extra.percentBp : null,
            unitCents: extra.unitCents,
            allowPercent: true,
            onAmount: (cents) => patchExtra(extra.id, { unitCents: cents, percentBp: null }),
            onPercent: (bp) => patchExtra(extra.id, { percentBp: bp, unitCents: null }),
            onMode: (mode) =>
              mode === 'percent'
                ? patchExtra(extra.id, { percentBp: null, unitCents: null })
                : patchExtra(extra.id, { percentBp: null }),
            missingValue,
          })}
          {extra.kind !== 'discount' && answers.costs.columns.unit ? (
            <DraftInput
              label={t.costs.quantity}
              value={extra.quantity}
              parse={parseCount}
              format={String}
              unreadable={t.invalid.not_integer}
              onChange={(value) => patchExtra(extra.id, { quantity: value ?? 0 })}
              emptyValue={0}
              required
              controlName="quantity"
            />
          ) : null}
          {lineTotal(view)}
        </div>
      </CardFrame>
    )
  }

  const wholeTableErrors = errorsOf('cost:*')

  return (
    <div className="flex flex-col gap-4">
      <div ref={root}>
        <Card
          title={t.costs.card}
          action={
            <span className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                data-control="add"
                aria-disabled={atLimit ? true : undefined}
                onClick={atLimit ? undefined : () => addExtra()}
              >
                <Icon name="plus" /> {t.costs.add}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-disabled={atLimit ? true : undefined}
                onClick={atLimit ? undefined : () => addExtra('option')}
                data-testid="offer-wizard-add-option"
              >
                <Icon name="plus" /> {t.costs.addOption}
              </Button>
            </span>
          }
        >
          <div data-wizard-field="cost:*" tabIndex={-1} className="outline-none">
            {wholeTableErrors.length > 0 ? (
              <div role="group" aria-label={t.costs.errorsTitle} className="mb-3 flex flex-col gap-1">
                {wholeTableErrors.map((message) => (
                  <p key={message} className="field-error">
                    {message}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          {atLimit ? <p className="mb-2 text-xs text-soft">{t.costs.addLimit}</p> : null}
          {views.length === 0 ? (
            <StatePanel title={t.costs.empty.title}>{t.costs.empty.body}</StatePanel>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {views.map((view) => {
                if ('total' in view) {
                  if (!resolved.costs.showTotals) return null
                  const state = view.out
                  return (
                    <li
                      key={`total:${state.spanIndex}`}
                      aria-label={t.costs.spanTotal(plainLabel(view.total.label))}
                      className="flex items-center justify-between gap-3 border-y-2 border-rule py-2 font-mono text-sm text-text"
                    >
                      <span className="font-semibold">
                        <TemplateText language={language as OfferLanguage}>
                          <MarkedText text={view.total.label} />
                        </TemplateText>
                      </span>
                      <span>
                        {state.state === 'ok' && state.totalCents !== null ? (
                          formatAmount(state.totalCents, currency)
                        ) : (
                          <>
                            <span aria-hidden="true">{t.costs.spanEmpty}</span>
                            <VisuallyHidden>
                              {state.state === 'empty' ? t.costs.spanEmptyLive : t.costs.spanIncomplete}
                            </VisuallyHidden>
                          </>
                        )}
                      </span>
                    </li>
                  )
                }
                return (
                  <li key={view.row.name} data-item-key={view.row.name}>
                    {view.source.type === 'template'
                      ? templateCard(view as LineView & { source: { type: 'template' } })
                      : extraCard(view as LineView & { source: { type: 'extra' } })}
                  </li>
                )
              })}
            </ol>
          )}
        </Card>
      </div>
      <Card title={t.costs.layout}>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={answers.costs.columns.position}
              onChange={(event) =>
                patchCosts({ columns: { ...answers.costs.columns, position: event.target.checked } })
              }
            />
            {t.costs.position}
          </label>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={answers.costs.columns.unit}
              onChange={(event) => setUnitColumns(event.target.checked)}
            />
            {t.costs.unitCols}
          </label>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={answers.costs.showTotals}
              onChange={(event) => patchCosts({ showTotals: event.target.checked })}
            />
            {t.costs.showTotals}
          </label>
        </div>
        {validityBound ? null : (
          <ValidityDaysInput
            answers={answers}
            onAnswersChange={onAnswersChange}
            entry={props.validityEntry}
            onEntryChange={props.onValidityEntry}
          />
        )}
      </Card>
      {generic.length > 0 ? <StepForm {...props} items={generic} /> : null}
      <VisuallyHidden live>{announcement}</VisuallyHidden>
    </div>
  )
}

/** The frame of one line: kind badge, position, errors, and the line's own remove button when it has one. */
function CardFrame({
  name,
  label,
  kind,
  position,
  errors,
  action,
  children,
}: {
  name: string
  label: string
  kind: CostKind
  position: number | null
  errors: readonly string[]
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-wizard-field={name}
      tabIndex={-1}
      className="flex flex-col gap-3 rounded-md border border-rule bg-ink p-3 outline-none"
    >
      <div className="flex items-center gap-2">
        {position !== null ? <span className="font-mono text-xs text-soft">{position}</span> : null}
        <Badge tone={kind === 'discount' ? 'success' : kind === 'option' ? 'muted' : 'neutral'}>
          {t.costs.kind[kind]}
        </Badge>
        {kind === 'option' ? <span className="text-xs text-soft">{t.costs.optionNote}</span> : null}
        <span className="flex-1" />
        {action}
      </div>
      {children}
      {errors.map((message) => (
        <p key={message} className="field-error">
          {message}
        </p>
      ))}
    </div>
  )
}
