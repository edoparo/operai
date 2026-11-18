/**
 * The configurator's form state (design S1, § How the frame model is exposed; task T21): one reducer that
 * holds the configuration as it will be sent (`config`), the loaded version it is compared with
 * (`baseline`), the settings of a first or last page that is switched off (`kept`, design F6) and the
 * problems the service reported, keyed by the JSON Pointer of the value they concern (amendment G3).
 *
 * - **Dirty** is `config` differing from `baseline` by value, so typing a value back, or switching a variant
 *   on and off again, is clean again. Nothing is stored in the browser (design D-9).
 * - **Problems** replace one another as a whole (`problemsSet`: a preview or a save answer lists every
 *   problem), and a problem goes away on its own when the person changes the value it names, or anything
 *   above or below it (a frame that does not fit is fixed by any of its lines).
 * - The form has no rule engine and no client-side bound (design D-3): `set` stores what it is given.
 *
 * Seams for the later tasks: T22 reads `config` for the preview request and calls `problemsSet` with a
 * refused preview's problems; T24 sends `config` with `baseVersion`, calls `problemsSet` with a refused
 * save's problems and `saved` after a 201; T25 and the conflict reload call `loaded` with the version they
 * fetched.
 */
import { parseDecimal } from '@operai/ui'
import type {
  FormConfig,
  FormFrame,
  FormHeadingLook,
  FormLine,
  FormVariant,
  OptionalVariantName,
  Problem,
  Range,
} from './formStateTypes'
import { ZONES } from './formStateTypes'

// ---------------------------------------------------------------------------------------------------------------
// JSON Pointer (RFC 6901) over the configuration

const escapeSegment = (segment: string | number): string => String(segment).replace(/~/g, '~0').replace(/\//g, '~1')
const unescapeSegment = (segment: string): string => segment.replace(/~1/g, '/').replace(/~0/g, '~')

/** `pointer('variants', 'first', 'footer')` → `/variants/first/footer`. */
export const pointer = (...segments: readonly (string | number)[]): string =>
  segments.map((segment) => `/${escapeSegment(segment)}`).join('')

/** The segments of a pointer; `''` is the root. */
export const segmentsOf = (path: string): string[] => (path === '' ? [] : path.split('/').slice(1).map(unescapeSegment))

/** The pointer of the parent: `/a/b/c` → `/a/b`; the root stays the root. */
export const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))

/** Whether `path` is `ancestor` or lies below it. */
export const isWithin = (path: string, ancestor: string): boolean =>
  ancestor === '' || path === ancestor || path.startsWith(`${ancestor}/`)

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)

/** The value at `path`, or `undefined` when there is none. */
export function getAt(root: unknown, path: string): unknown {
  let current = root
  for (const segment of segmentsOf(path)) {
    if (typeof current !== 'object' || current === null || !hasOwn(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * A copy of `root` with `value` at `path`; everything off that path is shared. A path that does not exist
 * is not created: the root comes back unchanged (a control only edits what the form holds).
 */
export function setAt<T>(root: T, path: string, value: unknown): T {
  const walk = (node: unknown, rest: readonly string[]): unknown => {
    if (rest.length === 0) return value
    if (typeof node !== 'object' || node === null) return node
    const [head, ...tail] = rest
    if (!hasOwn(node, head)) return node
    const child = (node as Record<string, unknown>)[head]
    const next = walk(child, tail)
    if (Object.is(next, child)) return node
    if (Array.isArray(node)) return node.map((item, index) => (String(index) === head ? next : item))
    return { ...(node as Record<string, unknown>), [head]: next }
  }
  return walk(root, segmentsOf(path)) as T
}

/** Structural equality of two JSON values (key order does not matter). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => hasOwn(right, key) && deepEqual(left[key], right[key]))
}

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

// ---------------------------------------------------------------------------------------------------------------
// Numbers typed into the form

/**
 * What a person typed into a number field, as the form holds it: the number when the text is one (a dot or
 * a comma for the decimals, an optional minus), else the text itself, which the service refuses with
 * `not_a_number`. An empty field is the empty text. Nothing is clamped (design S1).
 */
export function parseNumber(text: string): number | string {
  const trimmed = text.trim()
  const negative = trimmed.startsWith('-')
  const magnitude = parseDecimal(negative ? trimmed.slice(1) : trimmed, PARSE_DECIMALS)
  if (magnitude === null) return text
  const value = magnitude / 10 ** PARSE_DECIMALS
  return negative ? -value : value
}

// `parseDecimal` returns integer minor units, which keeps the decimal text exact (25.4 → 25400000 → 25.4).
const PARSE_DECIMALS = 6

/** The text a number field shows for a value. */
export const numberText = (value: number | string): string => (typeof value === 'number' ? String(value) : value)

// ---------------------------------------------------------------------------------------------------------------
// The state

/** What a new line copies from its neighbours (design D-5). */
export interface LineLook {
  size: FormLine['size']
  bold: boolean
  color: string
}

export interface FormLimits {
  /** `bounds.maxLinesPerZone` of the catalog. */
  maxLines: number
  /** The distance of a frame from the body that a stored version without one has: the catalog's starting value. */
  defaultGapMm: number
  /** The look of the document title that a stored version without one has: the catalog's starting value. */
  defaultTitle: FormHeadingLook
  /** The look of a line when its frame has no line to copy from: taken from the catalog's `defaultConfig`. */
  fallbackLook: LineLook
}

export interface FormState {
  /** The configuration of the loaded version (or the catalog's starting values for an entity with none). */
  baseline: FormConfig
  /** What is shown, and what a preview or a save sends. A first or last page that is off is `null` here. */
  config: FormConfig
  /** The settings of a first or last page the person switched off, restored if it is switched on again. */
  kept: Record<OptionalVariantName, FormVariant | null>
  /** The problems of the last answer, by the pointer of the value they name. */
  problems: Readonly<Record<string, readonly Problem[]>>
  limits: FormLimits
}

export type FormAction =
  /** A control changed the value at `pointer`. */
  | { type: 'set'; pointer: string; value: unknown }
  /** "Add a line" in the zone at `zone` (e.g. `/variants/default/footer/left`). */
  | { type: 'lineAdded'; zone: string }
  /** "Remove" on line `index` of the zone at `zone`. */
  | { type: 'lineRemoved'; zone: string; index: number }
  /** "Use a different first / last page". */
  | { type: 'variantToggled'; variant: OptionalVariantName; on: boolean }
  /** The problems of a preview or save answer: replaces every earlier one. */
  | { type: 'problemsSet'; problems: readonly Problem[] }
  /** A version was loaded (first load, reload after a conflict, restore): config and baseline are replaced. */
  | { type: 'loaded'; config: FormConfig }
  /** The configuration was saved as the active version: the baseline becomes it, the form is left as it is. */
  | { type: 'saved'; config: FormConfig }

/** The look of the first line anywhere in `config`, for a line added where there is none to copy. */
function anyLineLook(config: FormConfig, fallback: LineLook): LineLook {
  for (const variant of [config.variants.default, config.variants.first, config.variants.last]) {
    for (const frame of variant ? [variant.footer, variant.header] : []) {
      for (const zone of ZONES) {
        const line = frame[zone].at(-1)
        if (line) return { size: line.size, bold: line.bold, color: line.color }
      }
    }
  }
  return fallback
}

/** The limits the form needs from the catalog: the line count, and a look for a line with nothing to copy. */
export function limitsFromCatalog(maxLinesPerZone: number, lineSizePt: Range, defaultConfig: FormConfig): FormLimits {
  const fallback: LineLook = { size: lineSizePt.min, bold: false, color: '000000' }
  const gap = defaultConfig.variants.default.header.gapMm
  const title = defaultConfig.look.title
  return {
    maxLines: maxLinesPerZone,
    defaultGapMm: typeof gap === 'number' ? gap : FALLBACK_GAP_MM,
    defaultTitle: title === undefined || title === null ? FALLBACK_TITLE : { ...title },
    fallbackLook: anyLineLook(defaultConfig, fallback),
  }
}

/** Only if the catalog's own starting configuration lacks a distance (it does not): what layout 1 always drew. */
const FALLBACK_GAP_MM = 3

/** Only if the catalog's own starting configuration lacks a title look (it does not): what layout 1 always drew. */
const FALLBACK_TITLE: FormHeadingLook = { size: 20, bold: true, color: '000000' }

/**
 * A version stored before frames had a distance from the body has none in its JSON, and the service reads
 * that as the starting value. The form shows that value and sends it, so the field is never empty and a
 * stored version is not "changed" by being opened: the baseline and the configuration are given it alike.
 */
export function withFrameGaps(config: FormConfig, gapMm: number): FormConfig {
  const frame = (value: FormFrame): FormFrame => (value.gapMm === undefined ? { ...value, gapMm } : value)
  const variant = (value: FormVariant | null): FormVariant | null =>
    value === null || value === undefined
      ? value
      : { ...value, header: frame(value.header), footer: frame(value.footer) }
  const { default: base, first, last } = config.variants
  return { ...config, variants: { default: variant(base) as FormVariant, first: variant(first), last: variant(last) } }
}

/**
 * A version stored before the document title had a look has no `look.title`, and the service reads that as the
 * starting look. The form shows that look and sends it, for the same reason as the frame distance above.
 */
export function withDocumentTitle(config: FormConfig, title: FormHeadingLook): FormConfig {
  return config.look.title === undefined || config.look.title === null
    ? { ...config, look: { ...config.look, title: { ...title } } }
    : config
}

/** What a stored version lacks and the service fills in: both are given to the baseline and the configuration alike. */
function withStoredDefaults(config: FormConfig, limits: FormLimits): FormConfig {
  return withDocumentTitle(withFrameGaps(config, limits.defaultGapMm), limits.defaultTitle)
}

export function createFormState(config: FormConfig, limits: FormLimits): FormState {
  const filled = withStoredDefaults(config, limits)
  return { baseline: filled, config: filled, kept: { first: null, last: null }, problems: {}, limits }
}

export const isDirty = (state: FormState): boolean => !deepEqual(state.config, state.baseline)

/** The problems at one pointer (none: an empty list, always the same one). */
const NO_PROBLEMS: readonly Problem[] = []
export const problemsAt = (state: FormState, path: string): readonly Problem[] => state.problems[path] ?? NO_PROBLEMS

/** `problems` without the ones related to `path`: the value itself, what is above it and what is below it. */
function withoutRelated(problems: FormState['problems'], path: string): FormState['problems'] {
  const keys = Object.keys(problems)
  const keep = keys.filter((key) => !isWithin(key, path) && !isWithin(path, key))
  if (keep.length === keys.length) return problems
  return Object.fromEntries(keep.map((key) => [key, problems[key]]))
}

function groupByPath(problems: readonly Problem[]): Record<string, Problem[]> {
  const grouped: Record<string, Problem[]> = {}
  for (const problem of problems) (grouped[problem.path] ??= []).push(problem)
  return grouped
}

/** The look a line added to the zone at `zone` starts from: the zone's last line, else its frame's. */
function lookForNewLine(state: FormState, zone: string): LineLook {
  const own = (getAt(state.config, zone) as FormLine[]).at(-1)
  if (own) return { size: own.size, bold: own.bold, color: own.color }
  const frame = getAt(state.config, parentOf(zone)) as FormFrame
  for (const name of ZONES) {
    const line = frame[name].at(-1)
    if (line) return { size: line.size, bold: line.bold, color: line.color }
  }
  return anyLineLook(state.config, state.limits.fallbackLook)
}

const isZone = (value: unknown): value is FormLine[] => Array.isArray(value)

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'set': {
      const config = setAt(state.config, action.pointer, action.value)
      if (config === state.config) return state
      return { ...state, config, problems: withoutRelated(state.problems, action.pointer) }
    }

    case 'lineAdded': {
      const lines = getAt(state.config, action.zone)
      if (!isZone(lines) || lines.length >= state.limits.maxLines) return state
      const { size, bold, color } = lookForNewLine(state, action.zone)
      const line: FormLine = { text: { it: '', en: '' }, size, bold, color }
      return { ...state, config: setAt(state.config, action.zone, [...lines, line]) }
    }

    case 'lineRemoved': {
      const lines = getAt(state.config, action.zone)
      if (!isZone(lines) || action.index < 0 || action.index >= lines.length) return state
      // The lines after the removed one move up, so the problems recorded for them no longer point at them.
      return {
        ...state,
        config: setAt(
          state.config,
          action.zone,
          lines.filter((_, index) => index !== action.index),
        ),
        problems: withoutRelated(state.problems, action.zone),
      }
    }

    case 'variantToggled': {
      const { variant, on } = action
      const current = state.config.variants[variant]
      if (on === (current !== null)) return state
      const at = pointer('variants', variant)
      // Switched on for the first time, a variant starts as a copy of the default page's settings (D-4);
      // switched on again, it comes back as it was left.
      const next = on ? (state.kept[variant] ?? cloneJson(state.config.variants.default)) : null
      return {
        ...state,
        config: setAt(state.config, at, next),
        kept: { ...state.kept, [variant]: on ? null : current },
        problems: withoutRelated(state.problems, at),
      }
    }

    case 'problemsSet':
      return { ...state, problems: groupByPath(action.problems) }

    case 'loaded': {
      const config = withStoredDefaults(action.config, state.limits)
      return {
        ...state,
        baseline: config,
        config,
        kept: { first: null, last: null },
        problems: {},
      }
    }

    case 'saved':
      return { ...state, baseline: action.config }
  }
}
