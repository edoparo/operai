import { describe, expect, it } from 'vitest'
import { initialAnswers, type WizardContext } from './offerEngine/answers'
import { parseMarkup, type Block } from './offerEngine/markup'
import { resolveOffer } from './offerEngine/resolve'
import { parseTemplate } from './offerEngine/syntax'
import answerVectors from './offerEngine/vectors/answers.json'

const context = answerVectors.context as unknown as WizardContext

/** The body of the one section a template with a single field `V` (and `W`) prints, for the given answers. */
function bodyOf(lines: string[], values: Record<string, string>): string {
  const ast = parseTemplate(
    ['@@salutation S', '', '## S', ...lines, '', '@@field V', 'label: V', '', '@@field W', 'label: W'].join('\n'),
  ).ast
  const answers = initialAnswers(ast, context)
  Object.assign(answers.fields, values)
  return resolveOffer(ast, answers, context).sections[0]!.body
}

const paragraphs = (body: string) =>
  parseMarkup(body).filter((block): block is Extract<Block, { type: 'paragraph' }> => block.type === 'paragraph')
const textOf = (block: Extract<Block, { type: 'paragraph' }>) => block.runs.map((run) => run.text).join('')

/**
 * The paragraph alignment markers (`->` … `<-` centres, `->` … `->` right-aligns) belong to the template author: an answer
 * never forms one, whole or in part, at either end of a paragraph.
 */
describe('resolveOffer — an answer never becomes an alignment marker', () => {
  it('an answer that is a whole aligned paragraph is text, left aligned', () => {
    for (const value of ['->x<-', '->x->', '  ->x<-', '->\nx\n<-', 'a\n->x<-', '->x\n\n->y<-']) {
      const blocks = paragraphs(bodyOf(['[V]'], { V: value }))
      expect(blocks.length).toBeGreaterThan(0)
      for (const block of blocks) expect('align' in block).toBe(false)
      expect(blocks.map(textOf).join('\n\n')).toBe(value.trim())
    }
  })

  it('an answer cannot close the paragraph a template line opened (at the end of the line)', () => {
    for (const [value, expected] of [
      ['x<-', '->x<-'],
      ['x->', '->x->'],
      ['x <-  ', '->x <-'],
    ] as const) {
      const [block] = paragraphs(bodyOf(['->[V]'], { V: value }))
      expect('align' in block!).toBe(false)
      expect(textOf(block!)).toBe(expected)
    }
  })

  it('an answer that ends a middle line or a line of its own paragraph cannot close it either', () => {
    const blocks = paragraphs(bodyOf(['->[V]'], { V: 'one<-\n\ntwo' }))
    expect(blocks.map((block) => 'align' in block)).toEqual([false, false])
    expect(blocks.map(textOf)).toEqual(['->one<-', 'two'])
    const [continued] = paragraphs(bodyOf(['->first', '[V]'], { V: 'x<-' }))
    expect('align' in continued!).toBe(false)
    expect(textOf(continued!)).toBe('->first\nx<-')
  })

  it('an answer cannot complete a marker the template spells in part', () => {
    const [opened] = paragraphs(bodyOf(['-[V]'], { V: '> x <-' }))
    expect('align' in opened!).toBe(false)
    expect(textOf(opened!)).toBe('-> x <-')
    const [closed] = paragraphs(bodyOf(['->x <[V]'], { V: '-' }))
    expect('align' in closed!).toBe(false)
    expect(textOf(closed!)).toBe('->x <-')
  })

  it("the template's own markers around an answer still align, and the answer's own markers stay text", () => {
    const [centred] = paragraphs(bodyOf(['->[V]<-'], { V: 'a<-' }))
    expect(centred).toMatchObject({ align: 'center' })
    expect(textOf(centred!)).toBe('a<-')
    const [right] = paragraphs(bodyOf(['->[V] and [W]->'], { V: '->x', W: 'y<-' }))
    expect(right).toMatchObject({ align: 'right' })
    expect(textOf(right!)).toBe('->x and y<-')
  })

  it('a template paragraph of several lines is aligned by the template, whatever the answers hold', () => {
    const [block] = paragraphs(bodyOf(['->Dear [V],', 'welcome [W]<-'], { V: '->A', W: 'B<-' }))
    expect(block).toMatchObject({ align: 'center' })
    expect(textOf(block!)).toBe('Dear ->A,\nwelcome B<-')
  })

  it('an answer inside a list item or a table row is never aligned (those read no alignment)', () => {
    const blocks = parseMarkup(bodyOf(['- [V]', '', '| a |', '|---|', '| [V] |'], { V: '->x<-' }))
    expect(blocks.map((block) => block.type)).toEqual(['list', 'table'])
    expect(JSON.stringify(blocks)).not.toContain('"align"')
  })

  it('an escaped marker a template author writes stays literal', () => {
    const [block] = paragraphs(bodyOf(['\\->not centred<-'], {}))
    expect('align' in block!).toBe(false)
    expect(textOf(block!)).toBe('->not centred<-')
  })
  it('a line whose every part is conditional and off leaves no markers behind', () => {
    const body = bodyOf(['before', '', '->{{?W::[W]}}<-', '', 'after'], {})
    expect(body).toBe('before\n\nafter')
    expect(paragraphs(body).map(textOf)).toEqual(['before', 'after'])
    // with the field filled the same line is the author’s centred paragraph
    expect(paragraphs(bodyOf(['->{{?W::[W]}}<-'], { W: 'x' }))[0]).toMatchObject({ align: 'center' })
  })
})
