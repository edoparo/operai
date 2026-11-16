import { describe, expect, it } from 'vitest'
import resolveSource from './offerEngine/resolve.ts?raw'
import syntaxSource from './offerEngine/syntax.ts?raw'
import { en, it as italian } from '../strings'

/**
 * specs/20261115-crm-offer-wizard AC-8.3, AC-10.1, T14: a code the engine can report with no copy would render
 * `undefined` in the editor's problem list or the wizard's "to correct" list. The union types are read from the
 * engine's own source, so a code added to the engine (a change to both copies, DD-51) fails here until it has copy.
 */

/** The string members of `export type <name> = "a" | "b" …;` */
function codesOf(source: string, name: string): string[] {
  const declaration = new RegExp(`export type ${name} =([^;]+);`).exec(source)
  if (!declaration) throw new Error(`export type ${name} not found in the engine copy`)
  return [...declaration[1]!.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!)
}

const problemCodes = codesOf(syntaxSource, 'ProblemCode')
const invalidCodes = codesOf(resolveSource, 'InvalidCode')

describe.each([
  ['en', en],
  ['it', italian],
] as const)('every engine code has copy (%s)', (_language, catalog) => {
  it('every ProblemCode of syntax.ts has a templates.wizardEditor.problem message', () => {
    expect(problemCodes.length).toBeGreaterThan(30)
    const messages = catalog.templates.wizardEditor.problem as Record<string, unknown>
    for (const code of problemCodes) {
      expect(typeof messages[code], `templates.wizardEditor.problem.${code}`).toBe('function')
      expect((messages[code] as (name?: string) => string)('x').trim(), code).not.toBe('')
    }
  })

  it('every InvalidCode of resolve.ts has an offerWizard.invalid message', () => {
    expect(invalidCodes.length).toBeGreaterThan(10)
    const messages = catalog.offerWizard.invalid as Record<string, unknown>
    for (const code of invalidCodes) {
      expect(typeof messages[code], `offerWizard.invalid.${code}`).toBe('string')
      expect((messages[code] as string).trim(), code).not.toBe('')
    }
  })

  it('names the offending key of a malformed declaration (declaration_invalid, DD-40)', () => {
    const message = catalog.templates.wizardEditor.problem.declaration_invalid('kind')
    expect(message).toContain('kind')
  })
})

describe('the code lists are read, not assumed', () => {
  it('finds the codes the engine has today', () => {
    expect(problemCodes).toContain('declaration_invalid')
    expect(problemCodes).toContain('block_not_closed')
    expect(invalidCodes).toContain('section_too_long')
    expect(invalidCodes).toContain('no_counted_line')
  })

  it('a code without copy would be seen: the check is not vacuous', () => {
    const messages = en.templates.wizardEditor.problem as Record<string, unknown>
    expect(messages['made_up_code']).toBeUndefined()
  })
})
