/**
 * The shapes the configurator form works on (plan § LetterheadConfig v1 and amendments G2, G3; the Rust
 * model is `letterhead-api/engine/src/config/model.rs`, the answer of `GET /v1/catalog` is
 * `letterhead-api/api/src/routes/read.rs`).
 *
 * The form holds the configuration exactly as it will be sent. The one difference from the stored shape
 * is a number field: it holds a `number` while the text typed is a number, and the text as typed while it
 * is not (`NumberValue`), so that the service, not the browser, refuses it (`not_a_number`, design D-3: the
 * form has no rules of its own and never clamps).
 */
import type { Catalog } from './types'

/** A number the person typed: the number, or the text when it is not one (the service refuses that). */
export type NumberValue = number | string

export const ZONES = ['left', 'center', 'right'] as const
export type ZoneName = (typeof ZONES)[number]

export const FRAMES = ['header', 'footer'] as const
export type FrameName = (typeof FRAMES)[number]

export const VARIANTS = ['default', 'first', 'last'] as const
export type VariantName = (typeof VARIANTS)[number]

/** The variants that can be switched off (AC-5.4, 5.5). */
export type OptionalVariantName = Exclude<VariantName, 'default'>

export type Valign = 'top' | 'bottom'
export type LogoPosition = 'left' | 'center' | 'right'
export type BulletMarker = 'bullet' | 'dash'
export type Language = 'it' | 'en'

export interface FormLine {
  text: Record<Language, string>
  size: NumberValue
  bold: boolean
  color: string
}

export interface FormRule {
  show: boolean
  thicknessPt: NumberValue
  color: string
}

export interface FormFrame {
  valign: Valign
  /** The distance between the frame and the body, in mm. */
  gapMm: NumberValue
  rule: FormRule
  left: FormLine[]
  center: FormLine[]
  right: FormLine[]
}

export interface FormLogo {
  asset: string
  position: LogoPosition
  heightMm: NumberValue
}

export interface FormVariant {
  header: FormFrame
  footer: FormFrame
  logo: FormLogo | null
  background: string | null
}

export interface FormHeadingLook {
  size: NumberValue
  bold: boolean
  color: string
}

/** `LetterheadConfig` v1, as the form holds and sends it. */
export interface FormConfig {
  margins: { top: NumberValue; bottom: NumberValue; left: NumberValue; right: NumberValue }
  fonts: { body: string; heading: string; frame: string }
  look: {
    headings: FormHeadingLook[]
    body: { size: NumberValue; lineSpacing: NumberValue }
    table: { headerFill: string; borders: boolean; borderColor: string }
    bulletMarker: BulletMarker
  }
  variants: { default: FormVariant; first: FormVariant | null; last: FormVariant | null }
}

/** One refused value: `invalid_letterhead.problems[]` (amendment G3). `path` is a JSON Pointer into the config. */
export interface Problem {
  path: string
  reason: string
  name?: string
  language?: string
}

export interface Range {
  min: number
  max: number
}

/** `GET /v1/catalog` `bounds`: every numeric limit the form shows or applies, in the unit its name says. */
export interface CatalogBounds {
  marginMm: Range
  bodyMinWidthMm: number
  bodyMinHeightMm: number
  maxLinesPerZone: number
  fitTestValueChars: number
  lineSizePt: Range
  ruleThicknessPt: Range
  gapMm: Range
  headingLevels: number
  headingSizePt: Range
  bodySizePt: Range
  lineSpacing: Range
  logoHeightMm: Range
}

/** What the form reads of `GET /v1/catalog`. */
export interface FormCatalog {
  layoutVersion: number
  fonts: readonly string[]
  placeholders: readonly { name: string; perPage: boolean }[]
  /** What to type to print a literal brace or bracket (AC-6.2): `{ type: '{{', prints: '{' }`. */
  escapes: readonly { type: string; prints: string }[]
  bounds: CatalogBounds
  defaultConfig: FormConfig
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const isRange = (value: unknown): value is Range => isRecord(value) && isNumber(value.min) && isNumber(value.max)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const RANGE_BOUNDS = [
  'marginMm',
  'lineSizePt',
  'ruleThicknessPt',
  'gapMm',
  'headingSizePt',
  'bodySizePt',
  'lineSpacing',
  'logoHeightMm',
] as const

const NUMBER_BOUNDS = [
  'bodyMinWidthMm',
  'bodyMinHeightMm',
  'maxLinesPerZone',
  'fitTestValueChars',
  'headingLevels',
] as const

/**
 * Narrows the catalog answer to what the form reads (the frame holds it as `Catalog`, a bag of unknowns).
 * Returns `null` when a member the form needs is missing or of the wrong type, so a service that answers
 * something else (an older build, a proxy page) is shown as a failure to load rather than as a broken form.
 * The configuration inside `defaultConfig` is the service's own valid one (G2) and is taken as it is.
 */
export function readCatalog(catalog: Catalog): FormCatalog | null {
  const { bounds, fonts, placeholders, escapes, defaultConfig, layoutVersion } = catalog
  if (!isRecord(bounds) || !isStringArray(fonts) || !Array.isArray(placeholders) || !Array.isArray(escapes)) return null
  if (!isRecord(defaultConfig) || !isNumber(layoutVersion)) return null
  if (!RANGE_BOUNDS.every((key) => isRange(bounds[key])) || !NUMBER_BOUNDS.every((key) => isNumber(bounds[key]))) {
    return null
  }
  const named = placeholders.every((p) => isRecord(p) && typeof p.name === 'string' && typeof p.perPage === 'boolean')
  const typed = escapes.every((e) => isRecord(e) && typeof e.type === 'string' && typeof e.prints === 'string')
  if (!named || !typed) return null
  const variants = defaultConfig.variants
  if (!isRecord(variants) || !isRecord(variants.default)) return null
  return {
    layoutVersion,
    fonts,
    placeholders: placeholders as FormCatalog['placeholders'],
    escapes: escapes as FormCatalog['escapes'],
    bounds: bounds as unknown as CatalogBounds,
    defaultConfig: defaultConfig as unknown as FormConfig,
  }
}
