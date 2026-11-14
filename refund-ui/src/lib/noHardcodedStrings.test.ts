/**
 * AC-5.7 (as amended 2026-08-11) — "this feature's components introduce no
 * user-facing string literal inline, and every string this feature adds is
 * reachable through a key path on `strings.ts` and is typed against its
 * exported type" (T14, specs/20260811-motivo-autocomplete/tasks.md).
 *
 * Ported from `estimai-ui/src/lib/noHardcodedStrings.test.ts`, which specs/20260807-estimate-sharing
 * introduced for the same purpose. Deliberately a SOURCE-LEVEL grep rather
 * than a rendering test: the rendering assertions already live in
 * `MotivoSuggestField.test.tsx` / `ExpenseLineComposer.test.tsx`, whereas this
 * one inspects raw source text and so also catches copy that no test ever
 * exercises — a `title`, an `aria-label` on a rarely-reached branch, a
 * placeholder.
 *
 * Method: strip import lines and comments, extract every remaining quoted or
 * templated string literal, and assert each one is on an explicit, justified
 * allowlist of TECHNICAL tokens — CSS values and custom properties, Tailwind
 * class strings, ARIA attribute values, DOM/keyboard event names, wire-contract
 * enum values, `data-testid`s and derived-id templates. Anything not on the
 * list fails.
 *
 * When this test fails, there are exactly two correct fixes:
 *   1. the literal is real user-facing copy → move it into `strings.ts` under a
 *      namespaced key path and reference it as `strings.foo.bar`; or
 *   2. the literal is a genuinely new TECHNICAL token → add it below, in the
 *      right group, with a reason.
 *
 * Scope: this feature's three new source files plus the one existing file it
 * changed. `strings.ts` itself is, obviously, exempt — it is the destination.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

function extractStringLiterals(rawSource: string): string[] {
  const withoutImports = rawSource
    .split('\n')
    .filter((line) => !/^\s*import\b/.test(line))
    .join('\n')
  const withoutBlockComments = withoutImports.replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, '')

  const literalPattern = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g
  const matches = withoutLineComments.match(literalPattern) ?? []
  return matches.map((raw) => raw.slice(1, -1))
}

// A literal made only of utility classes (a className, or one branch of a
// conditional class) is styling, never copy: recognised by shape instead of
// being allowlisted string by string, so restyling a component cannot break
// this test (ADR 20261031-one-styling-dialect-token-utilities). Each class must start with a known utility family.
const UTILITY_CLASS =
  /^(?:[a-z-]+:)*-?(?:text|bg|border|font|p[xytblr]?|m[xytblr]?|gap|space|w|h|size|min|max|flex|grid|inline|items|justify|self|place|content|rounded|shadow|overflow|whitespace|leading|tracking|z|top|bottom|left|right|inset|opacity|cursor|transition|duration|ease|animate|ring|outline|fill|stroke|divide|col|row|order|tabular|line|list|object|aspect|basis|grow|shrink|break|decoration|underline|select|pointer|resize|align|sr|motion|truncate|tabular|btn|card|link|tab|badge|banner|dialog|field|form|page|tool|list|skeleton|spinner|state|fact|data)(?:-[a-z0-9./[\]%()#,_-]+)?$/
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
])
const isUtilityClassList = (literal: string): boolean => {
  const text = literal.replace(/\$\{[^}]*\}/g, ' ').trim()
  return text !== '' && text.split(/\s+/).every((token) => UTILITY_WORDS.has(token) || UTILITY_CLASS.test(token))
}

function assertOnlyAllowlisted(filePath: string, allowlist: Set<string>) {
  const source = readFileSync(fileURLToPath(new URL(filePath, import.meta.url)), 'utf-8')
  const literals = extractStringLiterals(source)
  const offenders = literals.filter((literal) => !allowlist.has(literal) && !isUtilityClassList(literal))
  expect(
    [...new Set(offenders)],
    `unexpected literal(s) in ${filePath} — move real copy into strings.ts and reference it as strings.<path>`,
  ).toEqual([])
}

/** CSS custom properties and values shared by both components below. */
const CSS_TOKENS = [
  'var(--acc)',
  'var(--acc-lo)',
  'var(--disp)',
  'var(--ink)',
  'var(--ink-mid)',
  'var(--ink-soft)',
  'var(--muted)',
  'var(--red)',
  'var(--rule)',
  'var(--soft)',
  'var(--text)',
  // Tone-as-text tokens and @operai/ui class names / Button variants
  // (ADR 20261031-shared-ui-library-consumed-as-source) — styling vocabulary, never copy.
  'var(--red-text)',
  'var(--org-text)',
  'var(--grn-text)',
  'card',
  'card-title',
  'primary',
  'secondary',
  'ghost',
  'danger',
  'sm',
]

describe('AC-5.7 — no hardcoded user-facing strings outside strings.ts (specs/20260811-motivo-autocomplete files)', () => {
  it('src/lib/tripSuggestions.ts contains only Unicode normalisation-form tokens', () => {
    assertOnlyAllowlisted(
      './tripSuggestions.ts',
      new Set([
        // `String.prototype.normalize` form arguments — a Unicode API
        // vocabulary, not copy. See the fold's step-order documentation.
        'NFD',
        'NFC',
        // The whitespace-collapse replacement and the empty accent-strip
        // replacement — punctuation the fold emits, never displayed.
        ' ',
        '',
      ]),
    )
  })

  it('src/lib/suggestionsApi.ts contains only the endpoint path and its wire enum', () => {
    assertOnlyAllowlisted(
      './suggestionsApi.ts',
      new Set([
        // refund-api's route + its single-member query enum (plan.md
        // "## API contracts"). A wire contract, never shown to anyone.
        '/line-suggestions?type=travel_km',
        'travel_km',
      ]),
    )
  })

  it('src/components/MotivoSuggestField.tsx contains only technical/CSS/ARIA literals', () => {
    assertOnlyAllowlisted(
      '../components/MotivoSuggestField.tsx',
      new Set([
        ...CSS_TOKENS,
        // ARIA and HTML attribute VALUES — a fixed a11y vocabulary the ARIA
        // spec defines, never translatable copy. (Every ARIA *label* in this
        // component comes from `strings.components.motivoSuggest`.)
        'combobox',
        'listbox',
        'option',
        'list',
        'polite',
        'off',
        'text',
        // DOM event name + `scrollIntoView` option value.
        'pointerdown',
        'nearest',
        // `KeyboardEvent.key` values — the keyboard contract (design.md
        // "Interaction and keyboard"), a UA vocabulary, not copy.
        'ArrowDown',
        'ArrowUp',
        'Enter',
        'Escape',
        'Home',
        'End',
        'Tab',
        // Derived element ids / `data-testid`s and the option React key —
        // test and a11y wiring hooks, never rendered as text.
        '${id}-listbox',
        '${id}-live',
        '${id}-option-${index}',
        '${id}-option-${activeIndex}',
        '${suggestion.normalisedMotivo}|${suggestion.km}|${suggestion.entity}',
        // Tailwind utility class strings.
        'relative',
        'sr-only',
        'text-sm px-2.5 py-1.5 border rounded',
        'absolute z-10 mt-1 border rounded-md shadow-lg overflow-y-auto',
        'px-3 py-2 cursor-pointer',
        'text-sm overflow-hidden text-ellipsis whitespace-nowrap',
        'flex items-center gap-2',
        'flex items-center justify-between gap-2 text-2xs',
        // Inline CSS values for the popup's size, anchoring and highlight.
        '100%',
        'max(100%, 20rem)',
        'calc(100vw - 1.5rem)',
        'min(18rem, 50vh)',
        'contain',
        'transparent',
        '3px solid transparent',
        '3px solid var(--acc)',
        'color-mix(in srgb, var(--acc) 6%, transparent)',
        // The empty live-region text — the deliberate silence AC-1.6 requires
        // (a "no suggestions" announcement would be the forbidden empty state
        // in the audio channel), so it is an absence of copy, not copy.
        '',
      ]),
    )
  })

  it('src/components/ExpenseLineComposer.tsx contains only technical/CSS/wire literals', () => {
    assertOnlyAllowlisted(
      '../components/ExpenseLineComposer.tsx',
      new Set([
        ...CSS_TOKENS,
        // Wire-contract enum values (specs/20260716-refund-service `Entity`/`Currency`), matched
        // and emitted, never displayed — their LABELS come from
        // `strings.badges.entity` / `strings.badges.currency`.
        'welld_it',
        'welld_ch',
        'EUR',
        'CHF',
        'USD',
        'GBP',
        // `data-testid`s and the ids their `<label htmlFor>` associations use.
        'expense-line-composer',
        'composer-add-button',
        'composer-amount',
        'composer-currency',
        'composer-date',
        'composer-entity',
        'composer-error',
        'composer-km',
        'composer-km-help',
        'composer-km-status',
        'composer-motivo',
        'composer-motivo-error',
        'composer-type',
        // `LineDraftField` keys passed to the validation hook (INC-16) — identifiers, not copy.
        'type',
        'motivo',
        'amount',
        'entity',
        'currency',
        'km',
        // The figure font class on the km input (INC-17).
        'input-figure',
        // HTML/ARIA attribute values.
        'text',
        'date',
        'number',
        'submit',
        'alert',
        'polite',
        'true',
        'dark',
        // `<input type="number">` step/min bounds — numeric constraints.
        '0',
        '0.01',
        '1',
        // Tailwind utility class strings + the grid template.
        'sr-only',
        'flex flex-col gap-1',
        'flex flex-col gap-3 rounded-md border p-4',
        'grid gap-3',
        'text-2xs',
        'text-xs',
        'text-xs font-medium',
        'text-sm font-semibold',
        'text-sm px-2.5 py-1.5 border rounded',
        'py-1.5 px-3 text-sm font-medium border transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed',
        'repeat(auto-fit, minmax(160px, 1fr))',
        // The empty-string draft sentinels (`type === ''`, `entity: ''`).
        '',
      ]),
    )
  })
})

// ─── Every component and page (INC-24) ────────────────────────────────────
//
// The allowlists above pin specs/20260811-motivo-autocomplete's files literal by literal. This second
// half covers EVERY non-test `.tsx` under src/ with the TypeScript parser, so a
// file added later is covered the moment it exists. It flags the only places
// JSX can carry copy: JSX text, a string-literal child, and a string value for
// a user-facing attribute (`aria-label`, `title`, `placeholder`, `alt`,
// `label`, …). Class names, test ids, roles and CSS values are other
// attributes; text with no letters (a "·" separator) is not copy. Same scanner
// as inventory-ui's.

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const USER_FACING_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
  'label',
  'retryLabel',
  'dismissLabel',
  'closeLabel',
  'confirmLabel',
  'cancelLabel',
  'description',
  'heading',
])

const HAS_LETTER = /\p{L}/u

export function findHardcodedStrings(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: string[] = []
  const at = (node: ts.Node) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    return `${fileName}:${line + 1}`
  }
  const stringValue = (node: ts.Expression | undefined): string | undefined =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim()
      if (HAS_LETTER.test(text)) found.push(`${at(node)}: JSX text "${text}"`)
    } else if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const text = stringValue(node.expression)
      if (text !== undefined && HAS_LETTER.test(text)) found.push(`${at(node)}: JSX string child "${text}"`)
    } else if (ts.isJsxAttribute(node) && USER_FACING_ATTRIBUTES.has(node.name.getText(sourceFile))) {
      const init = node.initializer
      const text =
        init && ts.isStringLiteral(init)
          ? init.text
          : init && ts.isJsxExpression(init)
            ? stringValue(init.expression)
            : undefined
      if (text !== undefined && HAS_LETTER.test(text)) {
        found.push(`${at(node)}: ${node.name.getText(sourceFile)}="${text}"`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

/** Every non-test `.tsx` under src/, except the federation shims. */
function listScannedFiles(dir = SRC_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'federation' ? [] : listScannedFiles(full)
    return entry.name.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(entry.name) ? [full] : []
  })
}

describe('findHardcodedStrings (the scanner itself can fail)', () => {
  it('flags JSX text', () => {
    expect(findHardcodedStrings('a.tsx', 'export const A = () => <p>Save changes</p>')).toHaveLength(1)
  })

  it('flags a string literal child and a template-literal child', () => {
    expect(findHardcodedStrings('a.tsx', "export const A = () => <p>{'Save'}{`Cancel`}</p>")).toHaveLength(2)
  })

  it.each(['aria-label', 'title', 'placeholder', 'alt', 'label'])('flags a hardcoded %s', (attr) => {
    expect(findHardcodedStrings('a.tsx', `export const A = () => <input ${attr}="Search" />`)).toHaveLength(1)
    expect(findHardcodedStrings('a.tsx', `export const A = () => <input ${attr}={'Search'} />`)).toHaveLength(1)
  })

  it('does not flag copy from strings, technical attributes, or separators', () => {
    const source = `
      export const A = ({ n }: { n: number }) => (
        <section className="flex gap-2" data-testid="refund-x" role="status" aria-label={strings.appTitle} id={\`row-\${n}\`}>
          <span>{strings.appTitle}</span>
          <span>·</span>
          <span>{'—'}</span>
        </section>
      )`
    expect(findHardcodedStrings('a.tsx', source)).toEqual([])
  })
})

describe('no hardcoded user-facing strings in any src/ .tsx (INC-24)', () => {
  const files = listScannedFiles()

  it('scans the components and pages it is supposed to (the walk is not silently empty)', () => {
    const relative = files.map((file) => path.relative(SRC_DIR, file))
    expect(relative).toEqual(
      expect.arrayContaining([
        'App.tsx',
        path.join('pages', 'MyRequestsPage.tsx'),
        path.join('components', 'ExpenseLineRow.tsx'),
      ]),
    )
    expect(relative.some((file) => file.startsWith('federation') || /\.test\.tsx$/.test(file))).toBe(false)
  })

  it.each(files.map((file) => [path.relative(SRC_DIR, file), file]))('%s has no inline copy', (_name, file) => {
    expect(findHardcodedStrings(path.relative(SRC_DIR, file), readFileSync(file, 'utf-8'))).toEqual([])
  })
})
