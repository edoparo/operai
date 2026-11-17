/**
 * Test fixtures of the configurator form (task T21; used by tests only): the answer of `GET /v1/catalog` as
 * letterhead-api builds it today (`api/src/routes/read.rs` `catalog_body`, `engine/src/config/default.rs`
 * for `defaultConfig`), and a configuration that uses every part of `LetterheadConfig` v1.
 */
import type { FormConfig, FormLine, FormVariant } from './formStateTypes'
import type { Catalog } from './types'

const line = (text: string, size: number, bold: boolean, color: string): FormLine => ({
  text: { it: text, en: text },
  size,
  bold,
  color,
})

const emptyFrame = (show: boolean): FormVariant['header'] => ({
  valign: 'top',
  rule: { show, thicknessPt: 0.5, color: 'c9cad1' },
  left: [],
  center: [],
  right: [],
})

/** `default_config()` of the engine: the starting values of an entity with no letterhead (G2). */
export const defaultConfigFixture = (): FormConfig => ({
  margins: { top: 25, bottom: 25, left: 25, right: 25 },
  fonts: { body: 'Noto Serif', heading: 'Ubuntu', frame: 'Ubuntu' },
  look: {
    headings: [
      { size: 15, bold: true, color: 'e50339' },
      { size: 12, bold: true, color: '1f2430' },
      { size: 10.5, bold: true, color: '595c69' },
    ],
    body: { size: 10.5, lineSpacing: 1.2 },
    table: { headerFill: 'f1f1f4', borders: true, borderColor: 'c9cad1' },
    bulletMarker: 'bullet',
  },
  variants: {
    default: {
      header: emptyFrame(false),
      footer: {
        valign: 'bottom',
        rule: { show: true, thicknessPt: 0.5, color: 'c9cad1' },
        left: [line('{legal_name}', 9, true, '1f2430'), line('{address}', 8, false, '595c69')],
        center: [],
        right: [line('{page} / {pages}', 8, false, '595c69')],
      },
      logo: null,
      background: null,
    },
    first: null,
    last: null,
  },
})

/** `GET /v1/catalog`, as the service answers it. */
export const catalogFixture = (): Catalog => ({
  layoutVersion: 1,
  entities: ['welld_it', 'welld_ch'],
  languages: ['it', 'en'],
  fonts: ['DM Sans', 'DM Mono', 'Syne', 'Ubuntu', 'Noto Serif'],
  placeholders: [
    { name: 'legal_name', perPage: false },
    { name: 'address', perPage: false },
    { name: 'vat', perPage: false },
    { name: 'iban', perPage: false },
    { name: 'contacts', perPage: false },
    { name: 'page', perPage: true },
    { name: 'pages', perPage: true },
  ],
  styles: ['plain', 'muted', 'small', 'right', 'center', 'title', 'missing'],
  escapes: [
    { type: '{{', prints: '{' },
    { type: '}}', prints: '}' },
    { type: '[[', prints: '[' },
    { type: ']]', prints: ']' },
  ],
  settingNames: [],
  bounds: {
    pageWidthMm: 210,
    pageHeightMm: 297,
    marginMm: { min: 5, max: 100 },
    bodyMinWidthMm: 100,
    bodyMinHeightMm: 150,
    maxLinesPerZone: 4,
    fitTestValueChars: 40,
    lineSizePt: { min: 6, max: 14 },
    ruleThicknessPt: { min: 0.1, max: 5 },
    headingLevels: 3,
    headingSizePt: { min: 8, max: 24 },
    bodySizePt: { min: 8, max: 14 },
    lineSpacing: { min: 1, max: 2 },
    logoHeightMm: { min: 5, max: 40 },
  },
  assets: { formats: ['png', 'jpeg', 'svg'], maxBytes: 2 * 1024 * 1024, maxPixels: 25_000_000, maxSvgElements: 10_000 },
  defaultConfig: defaultConfigFixture(),
})

const LOGO_ID = '3f2b8a52-9a5e-4e43-8b1d-0c5d1f2f7a10'
const BACKGROUND_ID = '9d7c6a41-52b3-4c0e-a7f4-6b1e2d3c4a55'

/** A frame with one line in each zone and a visible rule. */
const fullFrame = (name: string): FormVariant['header'] => ({
  valign: 'bottom',
  rule: { show: true, thicknessPt: 0.75, color: 'e50339' },
  left: [
    {
      text: { it: `${name} sinistra {legal_name}`, en: `${name} left {legal_name}` },
      size: 9,
      bold: true,
      color: '1f2430',
    },
  ],
  center: [{ text: { it: `${name} centro`, en: `${name} centre` }, size: 8, bold: false, color: '595c69' }],
  right: [
    { text: { it: 'Pagina {page} di {pages}', en: 'Page {page} of {pages}' }, size: 8, bold: false, color: '595c69' },
  ],
})

const fullVariant = (name: string): FormVariant => ({
  header: fullFrame(`${name} header`),
  footer: fullFrame(`${name} footer`),
  logo: { asset: LOGO_ID, position: 'center', heightMm: 12.7 },
  background: BACKGROUND_ID,
})

/** A configuration that uses everything: all three variants, a logo and a background on each, a line in every zone. */
export const fullConfigFixture = (): FormConfig => ({
  ...defaultConfigFixture(),
  variants: { default: fullVariant('default'), first: fullVariant('first'), last: fullVariant('last') },
})
