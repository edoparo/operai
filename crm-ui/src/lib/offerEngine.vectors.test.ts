/**
 * The offer engine's shared vectors, run through crm-ui's byte-identical copy of the engine
 * (specs/20261115-crm-offer-wizard AC-3.2, DD-6, DD-51, T14). The same cases, with the same expectations, as
 * crm-api/src/offers/engine/*.test.ts: the server's check and the browser's preview cannot disagree while both
 * copies pass the same vectors. Every group of every `vectors/*.json` file is consumed below, and the last block
 * fails when a file or a group exists that nothing here runs.
 */
import { describe, expect, it } from 'vitest'
import {
  checkAnswers,
  chooseOption,
  initialAnswers,
  setBlock,
  setField,
  type WizardAnswers,
  type WizardContext,
} from './offerEngine/answers'
import { computeRefs, evaluateCompute, parseCompute } from './offerEngine/compute'
import { computeCosts, type CostRowIn } from './offerEngine/costs'
import { findTokens, resolveSectionForEdit } from './offerEngine/edit'
import { formatAmount, formatNumber, formatPercent, shortDate } from './offerEngine/format'
import { parseInline, parseMarkup, type Block, type CellLine, type Run } from './offerEngine/markup'
import { numberOffer, type NumberingInput } from './offerEngine/numbering'
import { outline, suppliedFields, type Outline, type OutlineItem } from './offerEngine/outline'
import { resolveOffer, type ResolvedOffer } from './offerEngine/resolve'
import { parseTemplate, type ProblemCode } from './offerEngine/syntax'
import answerVectors from './offerEngine/vectors/answers.json'
import computeVectors from './offerEngine/vectors/compute.json'
import costSpanVectors from './offerEngine/vectors/costs.spans.json'
import declarationVectors from './offerEngine/vectors/declarations.json'
import editVectors from './offerEngine/vectors/edit.json'
import formatVectors from './offerEngine/vectors/format.json'
import issuerVectors from './offerEngine/vectors/issuer.json'
import markupVectors from './offerEngine/vectors/markup.json'
import numberingVectors from './offerEngine/vectors/numbering.json'
import outlineVectors from './offerEngine/vectors/outline.json'
import resolveCostVectors from './offerEngine/vectors/resolve.costs.json'
import resolveVectors from './offerEngine/vectors/resolve.json'
import syntaxVectors from './offerEngine/vectors/syntax.json'

const context = answerVectors.context as unknown as WizardContext
const parse = (lines: readonly string[]) => parseTemplate(lines.join('\n')).ast

// ─── compute.json ───────────────────────────────────────────────────────────────

describe('vectors/compute.json', () => {
  interface Valid {
    expr: string
    values: Record<string, string | number | null>
    sums: Record<string, string | number | null>
    result: string | null
  }
  for (const vector of computeVectors.valid as unknown as Valid[]) {
    it(`${vector.expr.trim() || '(blank)'} with ${JSON.stringify(vector.values)} ${JSON.stringify(vector.sums)} → ${vector.result}`, () => {
      const expr = parseCompute(vector.expr)
      expect(expr).not.toBeNull()
      const result = evaluateCompute(expr!, {
        value: (name) => vector.values[name] ?? null,
        sum: (column) => vector.sums[column] ?? null,
      })
      expect(result).toBe(vector.result)
    })
  }

  for (const source of computeVectors.invalid) {
    it(`rejects ${JSON.stringify(source)}`, () => {
      expect(parseCompute(source)).toBeNull()
    })
  }

  for (const vector of computeVectors.refs) {
    it(`reads the names of ${vector.expr}`, () => {
      expect(computeRefs(parseCompute(vector.expr)!)).toEqual({ names: vector.names, sums: vector.sums })
    })
  }
})

// ─── format.json ────────────────────────────────────────────────────────────────

describe('vectors/format.json', () => {
  for (const v of formatVectors.formatAmount) {
    it(`formatAmount(${v.cents}, ${v.currency}) = ${v.expected}`, () => {
      expect(formatAmount(v.cents, v.currency as 'CHF' | 'EUR')).toBe(v.expected)
    })
  }
  for (const v of formatVectors.shortDate) {
    it(`shortDate(${JSON.stringify(v.date)}) = ${JSON.stringify(v.expected)}`, () => {
      expect(shortDate(v.date)).toBe(v.expected)
    })
  }
  for (const v of formatVectors.formatPercent) {
    it(`formatPercent(${v.bp}) = ${v.expected}`, () => {
      expect(formatPercent(v.bp)).toBe(v.expected)
    })
  }
  for (const v of formatVectors.formatNumber) {
    it(`formatNumber(${JSON.stringify(v.value)}, ${v.language}) = ${JSON.stringify(v.expected)}`, () => {
      expect(formatNumber(v.value, v.language as 'en' | 'it')).toBe(v.expected)
    })
  }
})

// ─── markup.json ────────────────────────────────────────────────────────────────

describe('vectors/markup.json', () => {
  type CompactRun = string | { t: string; b?: boolean; i?: boolean; u?: boolean; mark?: 'missing' | 'pending' }

  const expandRun = (run: CompactRun) => {
    if (typeof run === 'string') return { text: run, bold: false, italic: false, underline: false }
    return {
      text: run.t,
      bold: run.b === true,
      italic: run.i === true,
      underline: run.u === true,
      ...(run.mark ? { mark: run.mark } : {}),
    }
  }

  const expandBlock = (block: Record<string, unknown>): unknown => {
    if (block.type === 'paragraph') return { type: 'paragraph', runs: (block.runs as CompactRun[]).map(expandRun) }
    if (block.type === 'heading') return block
    if (block.type === 'list') {
      const items = block.items as { marker: string; runs: CompactRun[]; children: Record<string, unknown>[] }[]
      return {
        type: 'list',
        ordered: block.ordered,
        items: items.map((item) => ({
          marker: item.marker,
          runs: item.runs.map(expandRun),
          children: item.children.map(expandBlock),
        })),
      }
    }
    const cells = (rows: { bullet: boolean; runs: CompactRun[] }[][][]) =>
      rows.map((row) =>
        row.map((cell) => cell.map((line) => ({ bullet: line.bullet, runs: line.runs.map(expandRun) }))),
      )
    return {
      type: 'table',
      header: cells([block.header as never])[0],
      rows: cells(block.rows as never),
    }
  }

  for (const vector of markupVectors.inline) {
    it(`parseInline: ${vector.name}`, () => {
      const runs = parseInline(vector.source)
      const expected = (vector.runs as CompactRun[]).map(expandRun)
      if ('joined' in vector) {
        // A stray marker character is dropped; the text around it stays (possibly as separate runs).
        expect(runs.map((r) => r.text).join('')).toBe(vector.joined as string)
        expect(runs.every((r) => r.mark === undefined)).toBe(true)
      } else {
        expect(runs).toEqual(expected)
      }
    })
  }
  for (const vector of markupVectors.markup) {
    it(`parseMarkup: ${vector.name}`, () => {
      expect(parseMarkup(vector.source) as unknown).toEqual(
        (vector.blocks as Record<string, unknown>[]).map(expandBlock),
      )
    })
  }

  it('never throws on any prefix of every vector source', () => {
    for (const source of [...markupVectors.inline.map((v) => v.source), ...markupVectors.markup.map((v) => v.source)]) {
      for (let end = 0; end <= source.length; end += 1) expect(() => parseMarkup(source.slice(0, end))).not.toThrow()
    }
  })
})

// ─── syntax.json and declarations.json ──────────────────────────────────────────

describe('vectors/syntax.json', () => {
  type Entry = string | { repeat: number; line: string }
  interface Vector {
    name: string
    lines: Entry[]
    problems: { line: number; severity: 'error' | 'warning'; code: ProblemCode; name?: string }[]
  }

  /** `{x<n>}` stands for n times "x"; `{i}` for the 1-based repetition number. */
  function expand(entries: Entry[]): string {
    const out: string[] = []
    const fill = (text: string, i: number) =>
      text.replace(/\{x(\d+)\}/g, (_, n: string) => 'x'.repeat(Number(n))).replace(/\{i\}/g, String(i))
    for (const entry of entries) {
      if (typeof entry === 'string') out.push(fill(entry, 1))
      else for (let i = 1; i <= entry.repeat; i++) out.push(fill(entry.line, i))
    }
    return out.join('\n')
  }

  /** The problems about declarations belong to declarations.json; these vectors pin the structure. */
  const DECLARATION_CODES = new Set<string>([
    'field_undeclared',
    'label_missing',
    'declared_unused',
    'choice_too_few_options',
    'choice_option_unknown',
    'name_duplicate',
    'table_column_unknown',
    'column_in_two_tables',
    'compute_invalid',
    'compute_cycle',
    'fills_unknown',
    'source_unknown',
    'optional_heading_not_last',
    'declaration_invalid',
  ])
  const structural = (problems: readonly { code: string }[]) =>
    problems.filter((problem) => !DECLARATION_CODES.has(problem.code))

  const cases = syntaxVectors.cases as unknown as Vector[]
  for (const vector of cases) {
    it(vector.name, () => {
      expect(structural(parseTemplate(expand(vector.lines)).problems)).toEqual(vector.problems)
    })
  }

  it('has a vector for every structural code', () => {
    const codes = new Set<string>(cases.flatMap((vector) => vector.problems.map((problem) => problem.code)))
    for (const code of [
      'block_not_closed',
      'unexpected_close',
      'no_costs_section',
      'costs_not_first',
      'costs_not_closed',
      'cost_line_invalid',
      'cost_key_duplicate',
      'cost_line_after_last_total',
      'percent_discount_multi_total',
      'annex_designation_invalid',
      'annex_designation_duplicate',
      'salutation_missing',
      'too_many_sections',
      'too_many_annexes',
      'too_many_annex_sections',
      'heading_too_long',
      'too_large',
      'nesting_too_deep',
      'reserved_character',
      'non_printable_character',
      'step_unknown',
    ]) {
      expect(codes.has(code), code).toBe(true)
    }
  })
})

describe('vectors/declarations.json', () => {
  interface Vector {
    name: string
    lines: string[]
    problems: { line: number; severity: 'error' | 'warning'; code: ProblemCode; name?: string }[]
  }
  const cases = declarationVectors.cases as unknown as Vector[]
  for (const vector of cases) {
    it(vector.name, () => {
      expect(parseTemplate(vector.lines.join('\n')).problems).toEqual(vector.problems)
    })
  }

  it('has a vector for every declaration code', () => {
    const codes = new Set<string>(cases.flatMap((vector) => vector.problems.map((problem) => problem.code)))
    for (const code of [
      'field_undeclared',
      'label_missing',
      'declared_unused',
      'choice_too_few_options',
      'choice_option_unknown',
      'name_duplicate',
      'table_column_unknown',
      'column_in_two_tables',
      'compute_invalid',
      'compute_cycle',
      'fills_unknown',
      'source_unknown',
      'step_unknown',
      'optional_heading_not_last',
      'declaration_invalid',
    ]) {
      expect(codes.has(code), code).toBe(true)
    }
  })
})

// ─── costs.spans.json ───────────────────────────────────────────────────────────

describe('vectors/costs.spans.json', () => {
  interface Vector {
    name: string
    group?: string
    rows: CostRowIn[]
    expected: ReturnType<typeof computeCosts>
  }
  const cases = costSpanVectors.cases as unknown as Vector[]

  for (const vector of cases) {
    it(vector.name, () => {
      expect(computeCosts(vector.rows)).toEqual(vector.expected)
    })
  }

  it('placement invariance: cases of one group agree on the stored figures (AC-4.6)', () => {
    const group = cases.filter((vector) => vector.group === 'placement')
    expect(group.length).toBeGreaterThanOrEqual(4)
    const [first] = group
    for (const vector of group) {
      const result = computeCosts(vector.rows)
      expect([result.oneOffCents, result.yearlyCents]).toEqual([
        first!.expected.oneOffCents,
        first!.expected.yearlyCents,
      ])
    }
    // the group covers 0, 1, 2 and 3 total rows
    expect(group.map((vector) => vector.rows.filter((row) => row.type === 'total').length).sort()).toEqual([0, 1, 2, 3])
  })
})

// ─── numbering.json ─────────────────────────────────────────────────────────────

describe('vectors/numbering.json', () => {
  for (const vector of numberingVectors.cases) {
    it(vector.name, () => {
      expect(numberOffer(vector.input as NumberingInput)).toEqual(vector.expect as never)
    })
  }
})

// ─── answers.json ───────────────────────────────────────────────────────────────

describe('vectors/answers.json', () => {
  const ast = parse(answerVectors.template)
  const initial = () => initialAnswers(ast, context)

  type Step =
    | { op: 'field'; name: string; value: string }
    | { op: 'block'; name: string; on: boolean }
    | { op: 'choose'; choice: string; option: string }

  function run(template: typeof ast, from: WizardAnswers, steps: Step[]): WizardAnswers {
    let answers = from
    for (const step of steps) {
      if (step.op === 'field') answers = setField(template, answers, step.name, step.value)
      else if (step.op === 'block') answers = setBlock(template, answers, step.name, step.on)
      else answers = chooseOption(template, answers, step.choice, step.option)
    }
    return answers
  }

  it('builds the defaults, the client block and the system prefills of the vectors', () => {
    expect(initial()).toEqual(answerVectors.initial as unknown as WizardAnswers)
  })

  interface OpVector {
    name: string
    template?: string[]
    steps: Step[]
    fields: Record<string, string | number>
    blocks?: Record<string, boolean>
    absent?: string[]
    then?: Omit<OpVector, 'name' | 'then'>[]
  }
  for (const vector of answerVectors.ops as unknown as OpVector[]) {
    it(`the fills rule: ${vector.name}`, () => {
      const template = vector.template ? parse(vector.template) : ast
      const start = initialAnswers(template, context)
      for (const variant of [vector, ...(vector.then ?? [])]) {
        const result = run(template, start, variant.steps)
        expect(result.fields).toMatchObject(variant.fields)
        if (variant.blocks) expect(result.blocks).toMatchObject(variant.blocks)
        for (const name of variant.absent ?? []) expect(result.fields).not.toHaveProperty(name)
      }
    })
  }

  function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.')
    let node = target
    for (const part of parts.slice(0, -1)) node = node[part] as Record<string, unknown>
    node[parts[parts.length - 1]!] = value
  }

  interface CheckVector {
    name: string
    set: { path: string; value: unknown }[]
    issues: { path: string; code: string }[]
  }
  for (const vector of answerVectors.checks as unknown as CheckVector[]) {
    it(`checkAnswers: ${vector.name}`, () => {
      const answers = JSON.parse(JSON.stringify(initial())) as Record<string, unknown>
      for (const change of vector.set) setPath(answers, change.path, change.value)
      expect(checkAnswers(ast, answers as unknown as WizardAnswers)).toEqual(vector.issues as never)
    })
  }
})

// ─── outline.json ───────────────────────────────────────────────────────────────

describe('vectors/outline.json', () => {
  const ast = parse(outlineVectors.template)

  function summarize(item: OutlineItem): string {
    switch (item.type) {
      case 'field':
      case 'list':
      case 'table':
      case 'choice':
        return `${item.type}:${item.name}`
      case 'block':
        return `block:${item.name}${item.children.length > 0 ? `(${item.children.map(summarize).join(',')})` : ''}`
      case 'costTable':
        return `costs(${item.lines.map((line) => line.key).join(',')}|${item.totals.join(',')})`
    }
  }
  const sectionsOf = (step: Outline['steps'][number] | undefined) =>
    step ? step.sections.map((section) => `${section.heading}${section.annex ? `@${section.annex}` : ''}`) : []
  const stepOf = (result: Outline, key: string) => result.steps.find((step) => step.key === key)
  const itemsOf = (result: Outline, key: string) => (stepOf(result, key)?.items ?? []).map(summarize)

  it("the editor's outline lists every item, per step, in text order, nested under its block", () => {
    const editor = outline(ast, null)
    expect(editor.steps.map((step) => step.key)).toEqual(['scope', 'conditions', 'costs', 'annexes'])
    for (const key of ['scope', 'conditions', 'costs', 'annexes'] as const) {
      const expected = outlineVectors.editor[key]
      expect(itemsOf(editor, key)).toEqual(expected.items)
      expect(sectionsOf(stepOf(editor, key))).toEqual(expected.sections)
    }
  })

  for (const variant of outlineVectors.wizard) {
    it(`the wizard's outline: ${variant.name}`, () => {
      const answers = initialAnswers(ast, context)
      Object.assign(answers.blocks, variant.blocks)
      const wizard = outline(ast, answers)
      expect(itemsOf(wizard, 'scope')).toEqual(variant.scope)
      expect(itemsOf(wizard, 'conditions')).toEqual(variant.conditions)
      expect(itemsOf(wizard, 'costs')).toEqual(variant.costs)
      expect(itemsOf(wizard, 'annexes')).toEqual(variant.annexes)
      expect(sectionsOf(stepOf(wizard, 'annexes'))).toEqual(variant.annexSections)
    })
  }
})

// ─── resolve.json ───────────────────────────────────────────────────────────────

describe('vectors/resolve.json', () => {
  const ast = parse(resolveVectors.template)

  interface Patch {
    fields?: WizardAnswers['fields']
    blocks?: WizardAnswers['blocks']
    lists?: WizardAnswers['lists']
    tables?: WizardAnswers['tables']
    client?: Partial<WizardAnswers['client']>
  }
  interface Expect {
    opening?: string
    sections?: Record<string, string>
    absent?: string[]
    annexes?: {
      designation: string
      title: string
      subtitle: string | null
      intro: string
      sections: Record<string, string>
    }[]
    missing?: string[][]
    clientDate?: string
  }

  function answersWith(patch: Patch, ctx: WizardContext): WizardAnswers {
    const answers = initialAnswers(ast, ctx)
    Object.assign(answers.fields, patch.fields)
    Object.assign(answers.blocks, patch.blocks)
    Object.assign(answers.lists, patch.lists)
    Object.assign(answers.tables, patch.tables)
    Object.assign(answers.client, patch.client)
    return answers
  }
  const byHeading = (offer: ResolvedOffer, heading: string) =>
    offer.sections.find((section) => section.heading === heading)

  for (const vector of resolveVectors.cases as unknown as {
    name: string
    patch: Patch
    context?: Partial<WizardContext>
    expect: Expect
  }[]) {
    it(vector.name, () => {
      const ctx = { ...context, ...vector.context } as WizardContext
      const offer = resolveOffer(ast, answersWith(vector.patch, ctx), ctx)
      const expected = vector.expect
      if (expected.opening !== undefined) expect(offer.opening).toBe(expected.opening)
      for (const [heading, body] of Object.entries(expected.sections ?? {})) {
        expect(byHeading(offer, heading)?.body).toBe(body)
      }
      for (const heading of expected.absent ?? []) expect(byHeading(offer, heading)).toBeUndefined()
      if (expected.annexes) {
        expect(
          offer.annexes.map((annex) => ({
            designation: annex.designation,
            title: annex.title,
            subtitle: annex.subtitle,
            intro: annex.intro,
            sections: Object.fromEntries(annex.sections.map((section) => [section.heading, section.body])),
          })),
        ).toEqual(expected.annexes)
      }
      if (expected.missing)
        expect(offer.missing.map((issue) => [issue.name, issue.label, issue.step])).toEqual(expected.missing)
      if (expected.clientDate) expect(offer.client.date).toBe(expected.clientDate)
      expect(JSON.stringify(offer)).not.toMatch(/[⟪⟫]/) // DD-52: the reference token never reaches a resolved offer
    })
  }

  describe('referenceToken (DD-52)', () => {
    const group = resolveVectors.referenceToken
    const templates = {
      template: parse(group.template),
      templateWithoutReference: parse(group.templateWithoutReference),
    }

    function resolve(
      template: typeof ast,
      body: string,
      options: { reference?: string | null; mode?: 'markers' | 'tokens'; section?: string } = {},
    ): ResolvedOffer {
      const answers = initialAnswers(template, context)
      const heading = options.section ?? 'OGGETTO'
      const key = template.sections.find((section) => section.heading === heading)!.key
      answers.handEdits[key] = { heading, body, sourceHeading: heading }
      return resolveOffer(template, answers, context, {
        ...(options.reference !== undefined ? { reference: options.reference } : {}),
        ...(options.mode !== undefined ? { mode: options.mode } : {}),
      })
    }

    for (const vector of group.cases as {
      name: string
      template?: keyof typeof templates
      reference?: string
      mode?: 'tokens'
      section?: string
      body: string
      expect: string
    }[]) {
      it(vector.name, () => {
        const offer = resolve(templates[vector.template ?? 'template'], vector.body, {
          ...(vector.reference !== undefined ? { reference: vector.reference } : {}),
          ...(vector.mode !== undefined ? { mode: vector.mode } : {}),
          ...(vector.section !== undefined ? { section: vector.section } : {}),
        })
        expect(offer.sections.find((section) => section.heading === (vector.section ?? 'OGGETTO'))?.body).toBe(
          vector.expect,
        )
        if (vector.mode !== 'tokens') {
          const everything = JSON.stringify(offer)
          expect(everything).not.toContain('⟪')
          expect(everything).not.toContain('⟫')
        }
      })
    }
  })
})

// ─── resolve.json § bounds (QE D1) ──────────────────────────────────────────────

describe('vectors/resolve.json § bounds', () => {
  const group = resolveVectors.bounds
  const bounded = parse(group.template)

  for (const vector of group.cases as unknown as {
    name: string
    template?: string[]
    fill: Record<string, [string, number]>
    expect: { invalid: unknown[]; lengths?: Record<string, number>; atMost?: number }
  }[]) {
    it(vector.name, () => {
      const ast = vector.template ? parse(vector.template) : bounded
      const answers = initialAnswers(ast, context)
      for (const [name, [text, times]] of Object.entries(vector.fill)) answers.fields[name] = text.repeat(times)
      const offer = resolveOffer(ast, answers, context)
      expect(offer.invalid.map((issue) => [issue.name, issue.label, issue.step, issue.code])).toEqual(
        vector.expect.invalid as never,
      )
      const bodies: [string, string][] = [
        ['', offer.opening],
        ...offer.sections.map((section): [string, string] => [section.heading, section.body]),
        ...offer.annexes.flatMap((annex): [string, string][] => [
          ['#intro', annex.intro],
          ...annex.sections.map((section): [string, string] => [section.heading, section.body]),
        ]),
      ]
      for (const [heading, length] of Object.entries(vector.expect.lengths ?? {})) {
        expect(bodies.find(([name]) => name === heading)?.[1].length, heading || 'opening').toBe(length)
      }
      if (vector.expect.atMost !== undefined) {
        for (const [heading, body] of bodies) {
          expect(body.length, heading || 'opening').toBeLessThanOrEqual(vector.expect.atMost)
        }
      }
    })
  }
})

// ─── resolve.costs.json ─────────────────────────────────────────────────────────

describe('vectors/resolve.costs.json', () => {
  const templates = {
    main: parse(resolveCostVectors.templates.main),
    edge: parse(resolveCostVectors.templates.edge),
  }

  interface Patch {
    fields?: WizardAnswers['fields']
    blocks?: WizardAnswers['blocks']
    tables?: WizardAnswers['tables']
    client?: Partial<WizardAnswers['client']>
    costs?: { lines?: WizardAnswers['costs']['lines']; extra?: WizardAnswers['costs']['extra'] }
  }

  function answersFor(ast: (typeof templates)['main'], patch: Patch): WizardAnswers {
    const answers = initialAnswers(ast, context)
    Object.assign(answers.fields, patch.fields)
    Object.assign(answers.blocks, patch.blocks)
    Object.assign(answers.tables, patch.tables)
    Object.assign(answers.client, patch.client)
    Object.assign(answers.costs.lines, patch.costs?.lines)
    if (patch.costs?.extra) answers.costs.extra = patch.costs.extra
    return answers
  }

  const rowTuple = (row: ResolvedOffer['costs']['rows'][number]) =>
    row.type === 'total'
      ? ['total', row.label]
      : [row.name, row.kind, row.unitCents, row.percentBp, row.quantity, row.description]

  for (const vector of resolveCostVectors.cases as {
    name: string
    template: 'main' | 'edge'
    patch: Patch
    expect: { rows?: unknown[]; missing?: unknown[]; invalid?: unknown[]; price?: number[] }
  }[]) {
    it(vector.name, () => {
      const ast = templates[vector.template]
      const offer = resolveOffer(ast, answersFor(ast, vector.patch), context)
      if (vector.expect.rows) expect(offer.costs.rows.map(rowTuple)).toEqual(vector.expect.rows as never)
      if (vector.expect.missing)
        expect(offer.missing.map((issue) => [issue.name, issue.label, issue.step])).toEqual(
          vector.expect.missing as never,
        )
      if (vector.expect.invalid)
        expect(offer.invalid.map((issue) => [issue.name, issue.label, issue.step, issue.code])).toEqual(
          vector.expect.invalid as never,
        )
      if (vector.expect.price)
        expect([offer.costs.result.oneOffCents, offer.costs.result.yearlyCents]).toEqual(vector.expect.price as never)
    })
  }
})

// ─── edit.json ──────────────────────────────────────────────────────────────────

describe('vectors/edit.json', () => {
  const ast = parse(resolveVectors.template)
  const optional = parse(editVectors.optionalTemplate)

  interface Patch {
    fields?: WizardAnswers['fields']
    lists?: WizardAnswers['lists']
    tables?: WizardAnswers['tables']
    handEdit?: WizardAnswers['handEdits']
  }

  const sectionKey = (template: typeof ast, heading: string): string =>
    [...template.sections, ...template.annexes.flatMap((annex) => annex.sections)].find(
      (section) => section.heading === heading,
    )?.key ?? `${heading}#9`

  function answersWith(template: typeof ast, patch: Patch): WizardAnswers {
    const answers = initialAnswers(template, context)
    Object.assign(answers.fields, patch.fields)
    Object.assign(answers.lists, patch.lists)
    Object.assign(answers.tables, patch.tables)
    for (const [heading, edit] of Object.entries(patch.handEdit ?? {}))
      answers.handEdits[sectionKey(template, heading)] = edit
    return answers
  }

  for (const vector of editVectors.cases as {
    name: string
    section: string
    template?: string
    patch: Patch
    expect: unknown
  }[]) {
    it(`resolveSectionForEdit: ${vector.name}`, () => {
      const template = vector.template === 'optional' ? optional : ast
      const result = resolveSectionForEdit(
        template,
        answersWith(template, vector.patch),
        context,
        sectionKey(template, vector.section),
      )
      const expected = vector.expect as { heading: string; body: string; tokens: [string, string][] } | null
      expect(result).toEqual(
        expected === null
          ? null
          : {
              heading: expected.heading,
              body: expected.body,
              tokens: expected.tokens.map(([name, label]) => ({ name, label })),
            },
      )
    })
  }

  for (const vector of editVectors.findTokens as {
    text: string
    where?: 'body' | 'heading'
    expect: [number, number, string][]
  }[]) {
    it(`findTokens: ${vector.where ?? 'body'} ${JSON.stringify(vector.text)}`, () => {
      expect(findTokens(vector.text, vector.where).map((token) => [token.start, token.end, token.label])).toEqual(
        vector.expect,
      )
    })
  }
})

// ─── issuer.json (DD-57, DD-58) ─────────────────────────────────────────────────

describe('vectors/issuer.json', () => {
  const parseChecked = (lines: readonly string[]) => {
    const { ast, problems } = parseTemplate(lines.join('\n'))
    // a template without a cost table is fine here: only the mistakes of the vectors themselves are refused
    expect(problems.filter((problem) => problem.severity === 'error' && problem.code !== 'no_costs_section')).toEqual([])
    return ast
  }
  const contextWith = (patch: Partial<WizardContext> | undefined) => ({ ...context, ...patch }) as WizardContext
  const bodyOf = (offer: ResolvedOffer, heading: string) =>
    offer.sections.find((section) => section.heading === heading)?.body

  describe('cases', () => {
    const ast = parseChecked(issuerVectors.template)
    for (const vector of issuerVectors.cases as unknown as {
      name: string
      context: Partial<WizardContext>
      expect: {
        opening: string
        sections: Record<string, string>
        absent?: string[]
        missing: unknown[]
        invalid: unknown[]
        systemRead: string[]
      }
    }[]) {
      it(vector.name, () => {
        const ctx = contextWith(vector.context)
        const offer = resolveOffer(ast, initialAnswers(ast, ctx), ctx)
        expect(offer.opening).toBe(vector.expect.opening)
        for (const [heading, body] of Object.entries(vector.expect.sections)) expect(bodyOf(offer, heading)).toBe(body)
        for (const heading of vector.expect.absent ?? []) expect(bodyOf(offer, heading)).toBeUndefined()
        expect(offer.missing).toEqual(vector.expect.missing)
        expect(offer.invalid).toEqual(vector.expect.invalid)
        expect(offer.systemRead).toEqual(vector.expect.systemRead)
      })
    }
  })

  describe('hostile names and addresses are text, never structure (AC-12.2, AC-12.9)', () => {
    const ast = parseChecked(issuerVectors.hostileTemplate)
    const textOf = (runs: readonly Run[]) => runs.map((run) => run.text).join('')
    const plain = (runs: readonly Run[]) =>
      runs.every((run) => !run.bold && !run.italic && !run.underline && run.mark === undefined)
    const cellText = (lines: readonly CellLine[]) => lines.map((line) => textOf(line.runs)).join('\n')

    for (const vector of issuerVectors.hostile as {
      name: string
      legalName: string
      addressLines: string[]
      printedName: string
      printedAddress: string
      printed: string
    }[]) {
      it(vector.name, () => {
        const ctx = contextWith({ issuerLegalName: vector.legalName, issuerAddressLines: vector.addressLines })
        const offer = resolveOffer(ast, initialAnswers(ast, ctx), ctx)
        expect(offer.missing).toEqual([])

        const paragraph = parseMarkup(bodyOf(offer, 'PARAGRAFO')!)
        expect(paragraph.map((block) => block.type)).toEqual(['paragraph'])
        const runs = (paragraph[0] as Extract<Block, { type: 'paragraph' }>).runs
        expect(plain(runs)).toBe(true)
        expect(textOf(runs)).toBe(vector.printed)

        const list = parseMarkup(bodyOf(offer, 'ELENCO')!)
        expect(list.map((block) => block.type)).toEqual(['list'])
        const items = (list[0] as Extract<Block, { type: 'list' }>).items
        expect(items).toHaveLength(1)
        expect(items[0]!.children).toEqual([])
        expect(plain(items[0]!.runs)).toBe(true)
        expect(textOf(items[0]!.runs)).toBe(vector.printed)

        const table = parseMarkup(bodyOf(offer, 'TABELLA')!)
        expect(table.map((block) => block.type)).toEqual(['table'])
        const { header, rows } = table[0] as Extract<Block, { type: 'table' }>
        expect(header).toHaveLength(2)
        expect(rows).toHaveLength(2)
        for (const row of rows) expect(row).toHaveLength(2)
        for (const cell of [...rows[0]!, rows[1]![1]!]) {
          expect(cell.every((line) => !line.bullet && plain(line.runs))).toBe(true)
          expect(cell).toHaveLength(1)
        }
        expect(cellText(rows[0]![0]!)).toBe(vector.printedName)
        expect(cellText(rows[0]![1]!)).toBe(vector.printedAddress)
        expect(cellText(rows[1]![1]!)).toBe(vector.printed)
      })
    }
  })

  describe('systemRead (DD-58)', () => {
    interface Read {
      name: string
      template: string[]
      context?: Partial<WizardContext>
      patch?: { blocks?: WizardAnswers['blocks']; fields?: WizardAnswers['fields'] }
      handEdit?: { heading: string; body: string }
      expect: {
        systemRead: string[]
        missing?: unknown[]
        costRows?: [string, string][]
        sections?: Record<string, string>
      }
    }
    for (const vector of issuerVectors.reads as unknown as Read[]) {
      it(vector.name, () => {
        const ast = parseChecked(vector.template)
        const ctx = contextWith(vector.context)
        const answers = initialAnswers(ast, ctx)
        Object.assign(answers.blocks, vector.patch?.blocks)
        Object.assign(answers.fields, vector.patch?.fields)
        if (vector.handEdit) {
          const section = ast.sections.find((candidate) => candidate.heading === vector.handEdit!.heading)!
          answers.handEdits[section.key] = {
            heading: vector.handEdit.heading,
            body: vector.handEdit.body,
            sourceHeading: vector.handEdit.heading,
          }
        }
        const offer = resolveOffer(ast, answers, ctx)
        expect(offer.systemRead).toEqual(vector.expect.systemRead)
        for (const [heading, body] of Object.entries(vector.expect.sections ?? {})) {
          expect(bodyOf(offer, heading)).toBe(body)
        }
        if (vector.expect.missing) expect(offer.missing).toEqual(vector.expect.missing)
        if (vector.expect.costRows) {
          expect(
            offer.costs.rows.map((row) => [
              row.type === 'total' ? 'total' : row.name,
              row.type === 'total' ? row.label : row.description,
            ]),
          ).toEqual(vector.expect.costRows)
        }
      })
    }
  })

  describe('suppliedFields (DD-58, AC-12.1, AC-12.9)', () => {
    for (const vector of issuerVectors.supplied as unknown as {
      name: string
      template: string[]
      expect: unknown[]
      items: string[]
    }[]) {
      it(vector.name, () => {
        const ast = parseChecked(vector.template)
        expect(suppliedFields(ast)).toEqual(vector.expect)
        // never an item the wizard or the editor asks: the outline stays as it was
        const names = (items: readonly OutlineItem[]): string[] =>
          items.flatMap((item) => ('name' in item ? [item.name] : []))
        expect(outline(ast, null).steps.flatMap((step) => names(step.items))).toEqual(vector.items)
      })
    }
  })
})

// ─── every vector file and group is consumed ────────────────────────────────────

describe('the runner consumes every vector', () => {
  /** What this file runs, by vector file. A file or a group missing here fails below; `_doc` is prose. */
  const CONSUMED: Record<string, string[]> = {
    'answers.json': ['template', 'context', 'initial', 'ops', 'checks'],
    'compute.json': ['valid', 'refs', 'invalid'],
    'costs.spans.json': ['cases'],
    'declarations.json': ['cases'],
    'edit.json': ['optionalTemplate', 'cases', 'findTokens'],
    'format.json': ['formatAmount', 'shortDate', 'formatPercent', 'formatNumber'],
    'issuer.json': ['template', 'cases', 'hostileTemplate', 'hostile', 'reads', 'supplied'],
    'markup.json': ['inline', 'markup'],
    'numbering.json': ['cases'],
    'outline.json': ['template', 'editor', 'wizard'],
    'resolve.costs.json': ['templates', 'cases'],
    'resolve.json': ['template', 'cases', 'referenceToken', 'bounds'],
    'syntax.json': ['cases'],
  }

  const files = import.meta.glob<Record<string, unknown>>('./offerEngine/vectors/*.json', {
    eager: true,
    import: 'default',
  })

  it('has a runner for every vectors/*.json file of the copy', () => {
    const present = Object.keys(files)
      .map((path) => path.split('/').pop()!)
      .sort()
    expect(present).toEqual(Object.keys(CONSUMED).sort())
  })

  it('has a runner for every group of every file', () => {
    for (const [path, content] of Object.entries(files)) {
      const name = path.split('/').pop()!
      const groups = Object.keys(content).filter((key) => key !== '_doc')
      expect(groups.sort(), name).toEqual([...(CONSUMED[name] ?? [])].sort())
    }
  })

  it('every group holds cases (an emptied group would pass its loop with nothing run)', () => {
    for (const [path, content] of Object.entries(files)) {
      for (const [group, value] of Object.entries(content)) {
        if (group === '_doc') continue
        const size = Array.isArray(value) ? value.length : Object.keys(value as object).length
        expect(size, `${path}:${group}`).toBeGreaterThan(0)
      }
    }
  })
})
