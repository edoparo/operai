import { describe, expect, it } from 'vitest'
import { textBlocks } from './textBlocks'

describe('textBlocks', () => {
  it('keeps prose as paragraphs, split at blank lines', () => {
    expect(textBlocks('One line.\nSame paragraph.\n\nSecond.')).toEqual([
      { kind: 'paragraph', text: 'One line.\nSame paragraph.' },
      { kind: 'paragraph', text: 'Second.' },
    ])
  })

  it('turns consecutive "- " and "• " lines into one bulleted list', () => {
    expect(textBlocks('- First\n• Second\n* Third')).toEqual([{ kind: 'list', ordered: false, items: ['First', 'Second', 'Third'] }])
  })

  it('turns numbered lines into an ordered list, separate from a bulleted one', () => {
    expect(textBlocks('1. Uno\n2) Due\n- Altro')).toEqual([
      { kind: 'list', ordered: true, items: ['Uno', 'Due'] },
      { kind: 'list', ordered: false, items: ['Altro'] },
    ])
  })

  it('mixes a lead-in paragraph, a list and a closing paragraph in order', () => {
    expect(textBlocks('Intro:\n- a\n- b\nClosing.')).toEqual([
      { kind: 'paragraph', text: 'Intro:' },
      { kind: 'list', ordered: false, items: ['a', 'b'] },
      { kind: 'paragraph', text: 'Closing.' },
    ])
  })

  it('interprets no markup: an item is its text, verbatim', () => {
    expect(textBlocks('- <b>x</b> [link](http://e.test)')).toEqual([
      { kind: 'list', ordered: false, items: ['<b>x</b> [link](http://e.test)'] },
    ])
  })

  it('a hyphen inside a sentence or a negative number is not a list', () => {
    expect(textBlocks('Costs -5% vs plan\n-10 is a number')).toEqual([{ kind: 'paragraph', text: 'Costs -5% vs plan\n-10 is a number' }])
  })
})
