/**
 * The value of a derived (`compute:`) field, to show it read-only (AC-4.5). `ResolvedOffer` does not carry
 * derived values and the engine is frozen (DD-51), so this evaluates the field's expression with the engine's own
 * `evaluateCompute`, over the same inputs the resolver gives it: an empty input makes the result empty, a field no
 * shown item reaches counts 0, a table column sums over its non-empty rows. It only DISPLAYS a value — what is
 * printed, checked and saved is always the resolver's. Drift candidate: expose the value on `ResolvedOffer`.
 */
import type { WizardAnswers } from '../../lib/offerEngine/answers'
import { evaluateCompute } from '../../lib/offerEngine/compute'
import { outline, type OutlineItem } from '../../lib/offerEngine/outline'
import type { TemplateAst } from '../../lib/offerEngine/syntax'

const isBlank = (value: string | number | null | undefined): boolean =>
  value === undefined || value === null || String(value).trim() === ''

function namesOf(items: readonly OutlineItem[], into: Set<string>): void {
  for (const item of items) {
    if (item.type === 'costTable') continue
    into.add(item.name)
    if (item.type === 'block') namesOf(item.children, into)
  }
}

/** A function from a derived field's name to its canonical decimal text, or null when an input is empty. */
export function derivedValues(ast: TemplateAst, answers: WizardAnswers): (name: string) => string | null {
  const fields = new Map(ast.fields.map((field) => [field.name, field]))
  const shown = new Set<string>()
  for (const step of outline(ast, answers).steps) namesOf(step.items, shown)
  const every = new Set<string>()
  for (const step of outline(ast, null).steps) namesOf(step.items, every)
  const inactive = (name: string): boolean => every.has(name) && !shown.has(name)

  const tableOf = (column: string) => ast.tables.find((table) => table.columns.includes(column))
  const sumOf = (column: string): string | null => {
    const table = tableOf(column)
    if (!table || table.columns[0] === column) return null
    let total = 0n
    for (const row of answers.tables[table.name] ?? []) {
      if (!table.columns.some((name) => !isBlank(row.cells[name]))) continue
      const cell = row.cells[column]
      if (isBlank(cell)) continue
      const match = /^(-?)(\d{1,15})(?:\.(\d{1,6}))?$/.exec(String(cell).trim())
      if (!match) return null
      const scaled = BigInt(match[2]!) * 1_000_000n + BigInt((match[3] ?? '').padEnd(6, '0'))
      total += match[1] === '-' ? -scaled : scaled
    }
    const abs = total < 0n ? -total : total
    const fraction = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
    return `${total < 0n ? '-' : ''}${abs / 1_000_000n}${fraction === '' ? '' : `.${fraction}`}`
  }

  const cache = new Map<string, string | null>()
  const active = new Set<string>()
  const valueOf = (name: string): string | null => {
    const field = fields.get(name)
    if (!field?.compute) return null
    if (cache.has(name)) return cache.get(name)!
    if (active.has(name)) return null
    active.add(name)
    const result = evaluateCompute(field.compute.expr, {
      value: (input) => {
        const declared = fields.get(input)
        if (!declared) return null
        if (inactive(input)) return '0'
        const raw = declared.compute
          ? valueOf(input)
          : declared.source === 'validityDays'
            ? String(answers.validityDays)
            : declared.source === null || declared.source === 'deal' || declared.source === 'manDays'
              ? answers.fields[input]
              : null
        return isBlank(raw) ? null : raw!
      },
      sum: sumOf,
    })
    active.delete(name)
    cache.set(name, result)
    return result
  }
  return valueOf
}
