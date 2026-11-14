/**
 * offerRules — the offer document's client-side rules (specs/20261102-crm-offer-document AC-3.3), the
 * same limits crm-api enforces on a template and on a generate body, so a form
 * never submits what the server will refuse. Pure: no React, no I/O. The
 * server stays the authority.
 *
 * Money is integer cents; a percentage discount is basis points. The totals use
 * the server's rules (`crm-api/src/offers/costs.ts`): line = unit × quantity,
 * percentage discount = round half up of (one-off sum × bp / 10 000).
 */
import { parseDecimal } from '@operai/ui'
import { centsToInput } from './money'
import type { CostColumns, CostKind, DraftCostLine, OfferSection, TemplateCostLine } from './types'

export const LIMITS = {
  sections: { min: 1, max: 15 },
  heading: 120,
  body: 20_000,
  opening: 5_000,
  salutation: 100,
  costLines: { min: 1, max: 10 },
  description: 200,
  quantity: 100_000,
  cents: 10_000_000_000_000,
  clientLines: { min: 1, max: 8 },
  clientLine: 200,
  acceptance: 100,
  contacts: 5,
  attachments: 5,
  name: 80,
  validity: { min: 1, max: 365 },
} as const

export const COST_KINDS: readonly CostKind[] = ['one_off', 'yearly', 'discount']

// ─── Sections ───────────────────────────────────────────────────────────────

export const blankSection = (): OfferSection => ({ heading: '', body: '', costs: false })

export type SectionIssue = 'headingRequired' | 'headingTooLong' | 'bodyTooLong'
export type SectionsCheck = {
  /** A problem with the list as a whole. */
  list: 'count' | 'costsSection' | null
  items: (SectionIssue | null)[]
}

export function checkSections(sections: readonly OfferSection[]): SectionsCheck {
  const costs = sections.filter((section) => section.costs).length
  return {
    list:
      sections.length < LIMITS.sections.min || sections.length > LIMITS.sections.max
        ? 'count'
        : costs !== 1
          ? 'costsSection'
          : null,
    items: sections.map((section) => {
      const heading = section.heading.trim()
      if (heading === '') return 'headingRequired'
      if (heading.length > LIMITS.heading) return 'headingTooLong'
      if (section.body.length > LIMITS.body) return 'bodyTooLong'
      return null
    }),
  }
}

export const sectionsValid = (check: SectionsCheck): boolean => check.list === null && check.items.every((item) => item === null)

// ─── Amount text ↔ cents / basis points ─────────────────────────────────────

/** Cents from the text of an amount field, within the server's ceiling; null when not a valid amount. */
export function centsOfText(text: string): number | null {
  const cents = parseDecimal(text)
  return cents !== null && cents <= LIMITS.cents ? cents : null
}

/** Basis points from a percentage text ("12.5" → 1250), 1–10 000; null otherwise. */
export function basisPointsOfText(text: string): number | null {
  const bp = parseDecimal(text)
  return bp !== null && bp >= 1 && bp <= 10_000 ? bp : null
}

/** The text of a basis-points value: 1000 → "10", 1250 → "12.50". */
export const basisPointsToText = (bp: number): string => centsToInput(bp)

/** A whole quantity 1–100 000 from text; null otherwise. */
export function quantityOfText(text: string): number | null {
  return /^\d+$/.test(text.trim()) && Number(text) >= 1 && Number(text) <= LIMITS.quantity ? Number(text) : null
}

// ─── Template cost lines (editor state) ─────────────────────────────────────

export type AmountMode = 'deal' | 'perRelease' | 'fixed' | 'percent'

export type TemplateLineDraft = {
  description: string
  kind: CostKind
  mode: AmountMode
  /** Decimal text: major units for `fixed`, percent for `percent`. */
  amount: string
  quantityMode: 'number' | 'manDays'
  quantity: string
}

export const blankTemplateLine = (): TemplateLineDraft => ({
  description: '',
  kind: 'one_off',
  mode: 'fixed',
  amount: '',
  quantityMode: 'number',
  quantity: '1',
})

export function templateLineToDraft(line: TemplateCostLine): TemplateLineDraft {
  const amount = line.amount
  const base = {
    description: line.description,
    kind: line.kind,
    quantityMode: line.quantity === 'manDays' ? ('manDays' as const) : ('number' as const),
    quantity: line.quantity === 'manDays' ? '1' : String(line.quantity),
  }
  if (amount === 'deal' || amount === 'perRelease') return { ...base, mode: amount, amount: '' }
  if ('percentBp' in amount) return { ...base, mode: 'percent', amount: basisPointsToText(amount.percentBp) }
  return { ...base, mode: 'fixed', amount: centsToInput(amount.cents) }
}

/** Which amount modes a kind allows: a per-release split is one-off only, a percentage is for discounts, a discount has no deal amount. */
export function modesFor(kind: CostKind): readonly AmountMode[] {
  if (kind === 'discount') return ['fixed', 'percent']
  if (kind === 'one_off') return ['deal', 'perRelease', 'fixed']
  return ['deal', 'fixed']
}

export type LineIssue = 'descriptionRequired' | 'descriptionTooLong' | 'amountInvalid' | 'quantityInvalid' | 'quantityOne'
export type LinesCheck = { list: 'count' | 'oneOff' | null; items: (LineIssue | null)[] }

type LineLike = { description: string; quantityOk: boolean; amountOk: boolean; quantityIsOne: boolean }

function checkLineShape(line: LineLike, unitColumns: boolean): LineIssue | null {
  const description = line.description.trim()
  if (description === '') return 'descriptionRequired'
  if (description.length > LIMITS.description) return 'descriptionTooLong'
  if (!line.amountOk) return 'amountInvalid'
  if (!line.quantityOk) return 'quantityInvalid'
  if (!unitColumns && !line.quantityIsOne) return 'quantityOne'
  return null
}

const countIssue = (length: number) => (length < LIMITS.costLines.min || length > LIMITS.costLines.max ? 'count' : null)

export function checkTemplateLines(lines: readonly TemplateLineDraft[], columns: CostColumns): LinesCheck {
  const items = lines.map((line) =>
    checkLineShape(
      {
        description: line.description,
        amountOk:
          line.mode === 'fixed'
            ? centsOfText(line.amount) !== null
            : line.mode === 'percent'
              ? basisPointsOfText(line.amount) !== null
              : true,
        quantityOk: line.quantityMode === 'manDays' || quantityOfText(line.quantity) !== null,
        quantityIsOne:
          line.mode === 'percent' ? true : line.quantityMode === 'number' && quantityOfText(line.quantity) === 1,
      },
      columns.unit,
    ),
  )
  const oneOff = lines.some((line) => line.kind === 'one_off')
  return { list: countIssue(lines.length) ?? (oneOff ? null : 'oneOff'), items }
}

export function templateLineToWire(line: TemplateLineDraft): TemplateCostLine {
  const amount =
    line.mode === 'deal' || line.mode === 'perRelease'
      ? line.mode
      : line.mode === 'percent'
        ? { percentBp: basisPointsOfText(line.amount)! }
        : { cents: centsOfText(line.amount)! }
  return {
    description: line.description.trim(),
    kind: line.kind,
    amount,
    quantity: line.mode === 'percent' ? 1 : line.quantityMode === 'manDays' ? 'manDays' : Number(line.quantity),
  }
}

// ─── Offer cost lines (dialog state) ────────────────────────────────────────

export type OfferLineDraft = {
  description: string
  kind: CostKind
  /** A percentage is for discounts only. */
  mode: 'fixed' | 'percent'
  amount: string
  quantity: string
}

export const blankOfferLine = (): OfferLineDraft => ({
  description: '',
  kind: 'one_off',
  mode: 'fixed',
  amount: '',
  quantity: '1',
})

export function draftLineToState(line: DraftCostLine): OfferLineDraft {
  return {
    description: line.description,
    kind: line.kind,
    mode: line.percentBp !== null ? 'percent' : 'fixed',
    amount:
      line.percentBp !== null
        ? basisPointsToText(line.percentBp)
        : line.unitCents !== null
          ? centsToInput(line.unitCents)
          : '',
    quantity: String(line.quantity),
  }
}

export function checkOfferLines(lines: readonly OfferLineDraft[], columns: CostColumns): LinesCheck {
  const items = lines.map((line) =>
    checkLineShape(
      {
        description: line.description,
        amountOk: line.mode === 'percent' ? basisPointsOfText(line.amount) !== null : centsOfText(line.amount) !== null,
        quantityOk: quantityOfText(line.quantity) !== null,
        quantityIsOne: line.mode === 'percent' ? true : quantityOfText(line.quantity) === 1,
      },
      columns.unit,
    ),
  )
  const oneOff = lines.some((line) => line.kind === 'one_off')
  return { list: countIssue(lines.length) ?? (oneOff ? null : 'oneOff'), items }
}

export const linesValid = (check: LinesCheck): boolean => check.list === null && check.items.every((item) => item === null)

/** What the dialog sends for a valid line: a discount carries `unitCents` OR `percentBp`, never both and never null. */
export function offerLineToWire(line: OfferLineDraft): {
  description: string
  kind: CostKind
  unitCents?: number
  percentBp?: number
  quantity: number
} {
  const description = line.description.trim()
  if (line.mode === 'percent') return { description, kind: line.kind, percentBp: basisPointsOfText(line.amount)!, quantity: 1 }
  return { description, kind: line.kind, unitCents: centsOfText(line.amount)!, quantity: Number(line.quantity) }
}

// ─── Totals (the server's rules, for the live preview) ──────────────────────

export type Totals = { oneOffCents: number; yearlyCents: number; discountsExceed: boolean }

/** Totals of lines that are individually valid; invalid lines count as zero. */
export function computeTotals(lines: readonly OfferLineDraft[]): Totals {
  const fixed = lines.map((line) => {
    if (line.mode === 'percent') return null
    const unit = centsOfText(line.amount)
    const quantity = quantityOfText(line.quantity)
    return unit === null || quantity === null ? 0n : BigInt(unit) * BigInt(quantity)
  })
  const oneOffSum = lines.reduce((sum, line, index) => (line.kind === 'one_off' ? sum + (fixed[index] ?? 0n) : sum), 0n)
  const totals = lines.map((line, index) => {
    if (line.mode !== 'percent') return fixed[index]!
    const bp = basisPointsOfText(line.amount)
    return bp === null ? 0n : (oneOffSum * BigInt(bp) + 5_000n) / 10_000n
  })
  const sumOf = (kind: CostKind) => lines.reduce((sum, line, index) => (line.kind === kind ? sum + totals[index]! : sum), 0n)
  const discounts = sumOf('discount')
  return {
    oneOffCents: Number(oneOffSum - discounts),
    yearlyCents: Number(sumOf('yearly')),
    discountsExceed: discounts > oneOffSum,
  }
}
