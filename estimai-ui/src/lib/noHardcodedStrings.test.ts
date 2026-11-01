/**
 * No user-visible copy outside the strings module (INC-24, AGENTS.md § All
 * services: "estimai-ui enforces this with a noHardcodedStrings test").
 *
 * Scans the source text of EVERY non-test `.tsx` under `src/`, plus the `.ts`
 * modules that produce copy shown to a person (health warnings, exports, the
 * local-project import errors, the import offer). For each file it extracts
 * every quoted / template string literal and every piece of JSX text, and
 * fails on anything that looks like copy:
 *   - JSX text containing a letter (`<h2>Model Parameters</h2>`);
 *   - a literal with a space between words, or a capitalised word
 *     (`'Close'`, `'Add activity'`), unless it is a known technical token;
 *   - a literal containing a non-ASCII symbol (`'×'`, `'✓'`, `'💬'`): glyphs
 *     and emoji are never icons (INC-31) — typographic punctuation (— – · …
 *     ’ ‘) is allowed.
 * Everything else — class lists, ids, test ids, event keys, MIME types, URL
 * paths — is technical and passes.
 *
 * Exempt on purpose (not scanned):
 *   - `src/strings.ts` and `src/strings/**` — the strings module itself
 *     (`strings/exportCopy.ts` is the English-only copy of exported files);
 *   - `lib/templates.ts` and `types.ts` PROFILES — template and profile names
 *     are DATA written into the estimate document, not UI copy;
 *   - API clients (`estimatesApi.ts`, `collaboratorsApi.ts`) — wire-contract
 *     vocabulary; the copy for their errors lives in strings.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** `.ts` modules that build copy a person sees; every other copy lives in components. */
const COPY_BEARING_TS = [
  'lib/healthWarnings.ts',
  'lib/pdfExport.ts',
  'lib/ganttChart.ts',
  'lib/projects.ts',
  'lib/identity.ts',
  'lib/figures.ts',
  'hooks/useImportOffer.ts',
  'hooks/useEstimator.ts',
]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const TSX_FILES = walk(SRC)
  .filter((file) => file.endsWith('.tsx') && !/\.test\.tsx$/.test(file) && !file.includes('__stubs__'))
  .map((file) => path.relative(SRC, file))
  .sort()

const stripComments = (source: string): string =>
  source
    .split('\n')
    .filter((line) => !/^\s*import\b/.test(line))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '')

const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g

function extract(rawSource: string, jsx = true): { literals: string[]; jsxText: string[] } {
  const code = stripComments(rawSource)
  const literals = (code.match(LITERAL) ?? []).map((raw) => raw.slice(1, -1))
  // JSX text: what sits between a tag's `>` and the next `<` (across lines),
  // once literals and one-line `{…}` expressions are blanked out.
  const blanked = code.replace(LITERAL, '""').replace(/\{[^{}\n]*\}/g, ' ')
  const jsxText = [...blanked.matchAll(/>([^<>{}=&|;()]*[A-Za-z][^<>{}=&|;()]*)</g)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim())
    // Not text: a generic's type argument (`Array<string>`) or a type
    // annotation ending in a generic (`navRef: React.MutableRefObject<…>`).
    .filter((text) => text !== '' && !/^[A-Za-z]+(\[\])?$/.test(text) && !/\w:\s*[A-Z][\w.]*$/.test(text))
  return { literals, jsxText: jsx ? jsxText : [] }
}

// A literal made only of utility classes (a className, or one branch of a
// conditional class) is styling, never copy (ADR-0051).
const UTILITY_CLASS =
  /^(?:[a-z-]+:)*-?(?:text|bg|border|font|p[xytblr]?|m[xytblr]?|gap|space|w|h|size|min|max|flex|grid|inline|items|justify|self|place|content|rounded|shadow|overflow|whitespace|leading|tracking|z|top|bottom|left|right|inset|opacity|cursor|transition|duration|ease|animate|ring|outline|fill|stroke|divide|col|row|order|tabular|line|list|object|aspect|basis|grow|shrink|break|decoration|underline|select|pointer|resize|align|sr|motion|truncate|btn|card|link|tab|badge|banner|dialog|field|form|page|tool|skeleton|spinner|state|fact|data|backdrop|translate|origin|group|touch|visually|is|active|focus|hover|placeholder|caret|accent|table|uppercase|normal-case|no)(?:-[a-z0-9./[\]%()#,_-]+)?$/
const UTILITY_WORDS = new Set([
  'flex',
  'grid',
  'block',
  'inline',
  'hidden',
  'border',
  'rounded',
  'truncate',
  'italic',
  'underline',
  'relative',
  'absolute',
  'fixed',
  'sticky',
  'grow',
  'shrink',
  'uppercase',
  'lowercase',
  'contents',
  'sr-only',
  'group',
  'shadow',
  'transition',
  'transition-opacity',
  'transition-colors',
])
const isUtilityClassList = (text: string): boolean =>
  text !== '' && text.split(/\s+/).every((token) => UTILITY_WORDS.has(token) || UTILITY_CLASS.test(token))

/** Capitalised technical tokens: DOM tag names, keyboard keys, HTTP headers, MIME types, library enums. */
const TECHNICAL = new Set([
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'Escape',
  'Enter',
  'Tab',
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'PNG',
  'Content-Type',
  'If-Match',
  // Developer messages (console, programming errors), never shown in the UI.
  'Save as a copy failed:',
  'useEstimatorContext must be used within EstimatorProvider',
])

/** A CSS value: a grid template, a canvas font (`600 13px system-ui, sans-serif`). */
const CSS_TOKEN = String.raw`(?:[\d.]+(?:px|fr|%|r?em)?|minmax\([^)]*\)|system-ui,?|sans-serif|bold|normal)`
const CSS_VALUE = new RegExp(String.raw`^${CSS_TOKEN}(?:\s+${CSS_TOKEN})*$`)

const ALLOWED_NON_ASCII = /[—–·…’‘]/g

function copyIn(literal: string): boolean {
  const text = literal.replace(/\$\{[^}]*\}/g, ' ').trim()
  if (text === '' || TECHNICAL.has(literal) || TECHNICAL.has(text)) return false
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(text.replace(ALLOWED_NON_ASCII, ''))) return true
  if (isUtilityClassList(text) || CSS_VALUE.test(text)) return false
  if (/^[a-z][\w.$/:-]*$/i.test(text) && !/^[A-Z][a-z]+$/.test(text)) return false // ids, keys, paths, camelCase
  if (/^[^A-Za-z]*$/.test(text)) return false // punctuation, digits, separators
  if (/[A-Za-z]{2,}\s+[A-Za-z]/.test(text)) return true // words separated by spaces
  return /^[A-Z][a-z]+/.test(text) // a capitalised word
}

function offendersIn(file: string): string[] {
  const { literals, jsxText } = extract(readFileSync(path.join(SRC, file), 'utf-8'), file.endsWith('.tsx'))
  return [...literals.filter(copyIn), ...jsxText.map((text) => `JSX text: ${text}`)]
}

describe('no hardcoded user-facing strings outside the strings module (INC-24)', () => {
  it('scans every non-test .tsx in src/', () => {
    expect(TSX_FILES.length).toBeGreaterThan(20)
    expect(TSX_FILES).toContain('EstimatorApp.tsx')
    expect(TSX_FILES).toContain(path.join('components', 'ActivityTable.tsx'))
  })

  it.each([...TSX_FILES, ...COPY_BEARING_TS])('%s has no inline copy or glyph', (file) => {
    expect(offendersIn(file), `${file}: move the copy into src/strings/ and read it from \`strings\``).toEqual([])
  })

  it('the detector itself catches copy, glyphs and JSX text', () => {
    expect(copyIn('Close')).toBe(true)
    expect(copyIn('Add activity')).toBe(true)
    expect(copyIn('×')).toBe(true)
    expect(copyIn('💬')).toBe(true)
    expect(copyIn('estimate-row-owned')).toBe(false)
    expect(copyIn('text-soft bg-ink-mid')).toBe(false)
    expect(copyIn('—')).toBe(false)
    expect(extract('<h2 className="x">Model Parameters</h2>').jsxText).toEqual(['Model Parameters'])
    expect(extract('<Button>\n  Add activity\n</Button>').jsxText).toEqual(['Add activity'])
    expect(extract('const m: Map<string, Row<Activity>> = new Map()').jsxText).toEqual([])
  })
})
