import { describe, expect, it } from 'vitest'
import { initialAnswers, type WizardContext } from './offerEngine/answers'
import { resolveOffer, resolveSectionText } from './offerEngine/resolve'
import { MAX_TEMPLATE_CHARS, parseTemplate } from './offerEngine/syntax'
import answerVectors from './offerEngine/vectors/answers.json'

/**
 * specs/20261115-crm-offer-wizard QE D1 / security M-1, in the browser's copy of the engine: the preview resolves on
 * every change, so a template that repeats a 20 000-character answer 49 000 times froze the tab (hundreds of megabytes
 * of text) before the resolved text was bounded as it is built. The rule itself is the vectors' (resolve.json § bounds);
 * this holds the amplification and the preview that draws it.
 */
const context = answerVectors.context as unknown as WizardContext

const COSTS = ['', '## COSTI', '@@step costs', '@@costs', '@@line a one_off | A | unit=100 | qty=1', '@@total **T**', '@@end']
const FIELD = ['', '@@field D', 'label: Dd']
const amplifying = (references: number): string =>
  ['@@salutation S', '@@acceptance C', '', '## UNO', '@@step scope', '[D]'.repeat(references), ...COSTS, ...FIELD].join('\n')

describe('an amplifying template', () => {
  const source = amplifying(49_000)
  const { ast, problems } = parseTemplate(source)
  const answers = initialAnswers(ast, context)
  answers.fields.D = 'x'.repeat(20_000)

  it('is a valid template at the size limit', () => {
    expect(source.length).toBeLessThanOrEqual(MAX_TEMPLATE_CHARS)
    expect(source.length).toBeGreaterThan(MAX_TEMPLATE_CHARS - 5_000)
    expect(problems.filter((problem) => problem.severity === 'error')).toEqual([])
  })

  it('resolves to an invalid section and a small result, quickly', () => {
    const started = performance.now()
    const offer = resolveOffer(ast, answers, context)
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(offer.invalid.map((issue) => [issue.name, issue.code])).toEqual([['section:UNO#0', 'section_too_long']])
    expect(offer.sections[0]!.body.length).toBeLessThanOrEqual(21_000)
    expect(JSON.stringify(offer).length).toBeLessThan(100_000)
  })

  it('the hand-edit dialog starts from bounded text too', () => {
    const started = performance.now()
    const text = resolveSectionText(ast, answers, context, 'UNO#0')
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(text!.body.length).toBeLessThanOrEqual(21_000)
  })
})
