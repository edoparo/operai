/**
 * fieldPath (task T24; design S4, F7.3, § Accessibility; plan amendment G3 and its 2026-11-17 amendment): what a
 * refused value is called, and where its control is.
 *
 * The service refuses a configuration with `problems[] = { path, reason, name?, language? }`, `path` a JSON
 * Pointer into the configuration it was sent. Two things are made of that pair here, and nothing else reads it:
 * - **pointer → words**: `describeProblem` is the sentence the person reads next to the control and in the
 *   summary ("Footer, left zone, line 2, English text: uses {foo}, which is not a placeholder. …"), built from
 *   the setting's name (`strings.where`) and the reason. The sentence is chosen by `reason` alone; `name` only
 *   fills a gap in it (the placeholder), `language` and the catalog's bounds fill the others. A reason this
 *   build does not know, and the three shape reasons the form cannot cause, get the generic sentence, so a
 *   code is never shown;
 * - **pointer → control**: every control of the form carries `data-pointer` (T21), a zone `data-zone` and a
 *   frame `data-frame`. `findControl` finds the one for a pointer, else the first control of the zone or frame
 *   it names, else that of the nearest ancestor that has one; `comparePointers` orders pointers as the page
 *   shows them, so "the first refused control" is the first one a person reads.
 */
import { strings } from '../strings'
import { parentOf, segmentsOf } from './formState'
import type { FormCatalog, Problem } from './formStateTypes'

// ---------------------------------------------------------------------------------------------------------------
// The problems of an answer

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** `invalid_letterhead.problems`, read defensively: an entry that is not `{ path, reason }` strings is dropped. */
export function readProblems(value: unknown): Problem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): Problem[] => {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.reason !== 'string') return []
    return [
      {
        path: entry.path,
        reason: entry.reason,
        ...(typeof entry.name === 'string' ? { name: entry.name } : {}),
        ...(typeof entry.language === 'string' ? { language: entry.language } : {}),
      },
    ]
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Page order

/**
 * The order in which the members of the configuration appear on the page. One list serves every level:
 * the names that exist at two levels (`left`/`right` of the margins and of the zones, `body` of the fonts and
 * of the look, `color`) are in an order that is right at both.
 */
const PAGE_ORDER = [
  'margins',
  'fonts',
  'look',
  'variants',
  'headings',
  'body',
  'heading',
  'frame',
  'table',
  'bulletMarker',
  'default',
  'first',
  'last',
  'header',
  'footer',
  'logo',
  'background',
  'valign',
  'rule',
  'top',
  'bottom',
  'left',
  'center',
  'right',
  'text',
  'it',
  'en',
  'asset',
  'position',
  'heightMm',
  'show',
  'thicknessPt',
  'headerFill',
  'borders',
  'borderColor',
  'size',
  'lineSpacing',
  'bold',
  'color',
]

const compareSegments = (a: string, b: string): number => {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Number(a) - Number(b)
  const ra = PAGE_ORDER.indexOf(a)
  const rb = PAGE_ORDER.indexOf(b)
  if (ra !== -1 || rb !== -1) return (ra === -1 ? PAGE_ORDER.length : ra) - (rb === -1 ? PAGE_ORDER.length : rb)
  return a < b ? -1 : a > b ? 1 : 0
}

/** Orders two pointers as the page shows their values; a group's own pointer comes before what is inside it. */
export function comparePointers(a: string, b: string): number {
  const left = segmentsOf(a)
  const right = segmentsOf(b)
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return compareSegments(left[index], right[index])
  }
  return left.length - right.length
}

// ---------------------------------------------------------------------------------------------------------------
// Pointer → words

const own = <T extends object>(table: T, key: string | undefined): string | undefined =>
  key !== undefined && Object.prototype.hasOwnProperty.call(table, key)
    ? ((table as Record<string, unknown>)[key] as string)
    : undefined

/** The look's own members: a heading's, the body text's, the table's. */
function lookWords(segments: readonly string[]): string[] {
  const w = strings.where.look
  const [, member, a, b] = segments
  if (member === 'headings') {
    if (!/^\d+$/.test(a ?? '')) return []
    const heading = w.heading(Number(a) + 1)
    const leaf = b === 'size' ? w.size : b === 'bold' ? w.bold : b === 'color' ? w.colour : undefined
    return leaf === undefined ? [heading] : [heading, leaf]
  }
  if (member === 'body') {
    const leaf = a === 'size' ? w.size : a === 'lineSpacing' ? w.lineSpacing : undefined
    return leaf === undefined ? [w.body] : [w.body, leaf]
  }
  if (member === 'table') {
    const leaf = own({ headerFill: w.headerFill, borders: w.borders, borderColor: w.borderColour }, a)
    return leaf === undefined ? [w.table] : [w.table, leaf]
  }
  if (member === 'bulletMarker') return [w.bulletMarker]
  return []
}

/** A frame (header or footer) and what is in it: its alignment, its rule, a zone, a line and the line's values. */
function frameWords(segments: readonly string[], from: number): string[] {
  const w = strings.where
  const words: string[] = []
  const [member, a, b, c] = segments.slice(from)
  const frame = own(w.frame, segments[from - 1])
  if (frame === undefined) return words
  words.push(frame)
  if (member === 'valign') words.push(w.valign)
  else if (member === 'rule') {
    words.push(w.rule.rule)
    const leaf = own({ show: w.rule.show, thicknessPt: w.rule.thickness, color: w.rule.colour }, a)
    if (leaf !== undefined) words.push(leaf)
  } else {
    const zone = own(w.zone, member)
    if (zone === undefined) return words
    words.push(zone)
    if (!/^\d+$/.test(a ?? '')) return words
    words.push(w.line(Number(a) + 1))
    if (b === 'text') {
      const language = own(w.text, c)
      if (language !== undefined) words.push(language)
    } else {
      const leaf = own({ size: w.look.size, bold: w.look.bold, color: w.look.colour }, b)
      if (leaf !== undefined) words.push(leaf)
    }
  }
  return words
}

/** A variant ("default page") and what it holds: a frame, the logo, the background image. */
function variantWords(segments: readonly string[]): string[] {
  const w = strings.where
  const name = own(w.variant, segments[1])
  if (name === undefined) return []
  const [, , member, a] = segments
  if (member === 'header' || member === 'footer') return [name, ...frameWords(segments, 3)]
  if (member === 'logo') {
    const leaf = own({ asset: w.logo.file, position: w.logo.position, heightMm: w.logo.height }, a)
    return leaf === undefined ? [name, w.logo.logo] : [name, w.logo.logo, leaf]
  }
  if (member === 'background') return [name, w.background]
  return [name]
}

/**
 * The setting at `path` in words, lower case: "top margin", "default page, footer, left zone, line 2, English
 * text". `''` for the whole configuration and for a path the form has no words for.
 */
export function whereOf(path: string): string {
  const segments = segmentsOf(path)
  const w = strings.where
  switch (segments[0]) {
    case 'margins':
      return own(w.margins, segments[1]) ?? ''
    case 'fonts':
      return own(w.fonts, segments[1]) ?? ''
    case 'look':
      return lookWords(segments).join(', ')
    case 'variants':
      return variantWords(segments).join(', ')
    default:
      return ''
  }
}

const capitalise = (text: string): string => text.charAt(0).toLocaleUpperCase() + text.slice(1)

/** A sentence that follows "Setting:" starts in lower case ("Top margin: use a number…"), unless its first word is an acronym. */
const afterColon = (text: string): string =>
  /^\p{Lu}(?!\p{Lu})/u.test(text) ? text.charAt(0).toLocaleLowerCase() + text.slice(1) : text

// ---------------------------------------------------------------------------------------------------------------
// Reason → sentence

type Range = { min: number; max: number; unit: string }

/** The range the catalog fixes for the number at `path`, and its unit; `null` for a path that holds no bounded number. */
function rangeOf(path: string, bounds: FormCatalog['bounds']): Range | null {
  const [first, second, third, fourth, fifth, sixth] = segmentsOf(path)
  const mm = (range: { min: number; max: number }): Range => ({ ...range, unit: 'mm' })
  const pt = (range: { min: number; max: number }): Range => ({ ...range, unit: 'pt' })
  if (first === 'margins') return mm(bounds.marginMm)
  if (first === 'look' && second === 'headings' && fourth === 'size') return pt(bounds.headingSizePt)
  if (first === 'look' && second === 'body') {
    if (third === 'size') return pt(bounds.bodySizePt)
    if (third === 'lineSpacing') return { ...bounds.lineSpacing, unit: '' }
  }
  if (first === 'variants') {
    if (third === 'logo' && fourth === 'heightMm') return mm(bounds.logoHeightMm)
    if ((third === 'header' || third === 'footer') && fourth === 'rule' && fifth === 'thicknessPt') {
      return pt(bounds.ruleThicknessPt)
    }
    if ((third === 'header' || third === 'footer') && sixth === 'size') return pt(bounds.lineSizePt)
  }
  return null
}

const languageOf = (problem: Problem): string | null => {
  const named = problem.language ?? segmentsOf(problem.path).at(-1)
  return named === 'it' || named === 'en' ? strings.problem.language[named] : null
}

/** The sentence for the reason alone ("Use a number between 5 and 100 mm."), or the generic one. */
function reasonSentence(problem: Problem, catalog: FormCatalog): string {
  const r = strings.problem.reason
  const { bounds } = catalog
  switch (problem.reason) {
    case 'out_of_range': {
      const range = rangeOf(problem.path, bounds)
      return range === null ? strings.problem.refused : r.out_of_range(range.min, range.max, range.unit)
    }
    case 'not_a_number':
      return r.not_a_number
    case 'bad_colour':
      return r.bad_colour
    case 'unknown_font':
      return r.unknown_font
    case 'unknown_placeholder':
      return r.unknown_placeholder(problem.name ?? null)
    case 'unbalanced_brace':
      return r.unbalanced_brace
    case 'unbalanced_bracket':
      return r.unbalanced_bracket
    case 'segment_no_placeholder':
      return r.segment_no_placeholder
    case 'segment_nested':
      return r.segment_nested
    case 'too_many_lines':
      return r.too_many_lines(bounds.maxLinesPerZone)
    case 'language_missing': {
      const language = languageOf(problem)
      return language === null ? strings.problem.refused : r.language_missing(language)
    }
    case 'body_too_small':
      return r.body_too_small(bounds.bodyMinWidthMm, bounds.bodyMinHeightMm)
    case 'header_overflow':
      return r.frame_overflow(strings.problem.side.top, bounds.fitTestValueChars)
    case 'footer_overflow':
      return r.frame_overflow(strings.problem.side.bottom, bounds.fitTestValueChars)
    case 'asset_unknown':
      return r.asset_unknown
    default:
      // `wrong_type`, `missing_member`, `unknown_member` (the form cannot cause them) and any reason from a newer service.
      return strings.problem.refused
  }
}

/**
 * The sentence for a refused value, in words (design S4, AC-8.3): "{Setting}: {what is wrong and how to fix it}",
 * or the sentence alone for a value that has no name of its own (the whole configuration).
 */
export function describeProblem(problem: Problem, catalog: FormCatalog): string {
  const sentence = reasonSentence(problem, catalog)
  const where = whereOf(problem.path)
  return where === '' ? sentence : `${capitalise(where)}: ${afterColon(sentence)}`
}

// ---------------------------------------------------------------------------------------------------------------
// Pointer → control

const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'

const withAttribute = (root: ParentNode, attribute: string, value: string): HTMLElement | null =>
  Array.from(root.querySelectorAll<HTMLElement>(`[${attribute}]`)).find(
    (element) => element.getAttribute(attribute) === value,
  ) ?? null

/**
 * The control to go to for the value at `path`: the control that carries the pointer, else the first control of
 * the zone or the frame at that pointer, else the same for the nearest ancestor that has one. `null` when the
 * page holds nothing for it (the whole configuration; a value whose control is not shown).
 */
export function findControl(root: ParentNode, path: string): HTMLElement | null {
  let at = path
  for (;;) {
    const direct = withAttribute(root, 'data-pointer', at)
    if (direct !== null) return direct
    const group = withAttribute(root, 'data-zone', at) ?? withAttribute(root, 'data-frame', at)
    const first = group?.querySelector<HTMLElement>(FOCUSABLE)
    if (first) return first
    if (at === '') return null
    at = parentOf(at)
    if (at === '') return null
  }
}

/** The control of the first problem, in the page's order, that has one. */
export function firstRefusedControl(root: ParentNode, problems: readonly Problem[]): HTMLElement | null {
  const ordered = [...problems].sort((a, b) => comparePointers(a.path, b.path))
  for (const problem of ordered) {
    const control = findControl(root, problem.path)
    if (control !== null) return control
  }
  return null
}

/** Moves focus to `control` and brings it into the middle of the window (no animation: reduced motion is respected). */
export function focusControl(control: HTMLElement): void {
  control.focus({ preventScroll: true })
  control.scrollIntoView?.({ block: 'center', behavior: 'auto' })
}
