/**
 * @vitest-environment jsdom
 *
 * `collectFlowItems` is the one DOM reader of the pagination (T74, DD-69): it turns the marked elements of the real,
 * unpaged flow into the pure core's items. jsdom has no layout, so each element's box is given by `data-box="top,height"`
 * and `getBoundingClientRect` is stubbed to read it; the line height and padding are inline styles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectFlowItems } from './collectFlowItems'

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const [top = 0, height = 0, width = 100] = (this.getAttribute('data-box') ?? '0,0').split(',').map(Number)
    return { top, bottom: top + height, height, left: 0, right: 0, width, x: 0, y: top, toJSON: () => ({}) }
  })
})
afterEach(() => vi.restoreAllMocks())

function flowOf(html: string): HTMLElement {
  const flow = document.createElement('article')
  flow.setAttribute('data-box', '1000,0')
  flow.innerHTML = html
  document.body.append(flow)
  return flow
}

describe('collectFlowItems', () => {
  it('reads text items in document order, tops from the flow, lines from height / line height', () => {
    const flow = flowOf(`
      <p data-flow="text" data-box="1000,27" style="line-height:13.5px">a</p>
      <h4 data-flow="text" data-flow-keep="next" data-flow-break="before" data-box="1040,13.5" style="line-height:13.5px">b</h4>`)
    const { items } = collectFlowItems(flow)
    expect(items).toEqual([
      { kind: 'text', id: 1, top: 0, lineHeight: 13.5, lines: 2, keepNext: false, breakBefore: false },
      { kind: 'text', id: 2, top: 40, lineHeight: 13.5, lines: 1, keepNext: true, breakBefore: true },
    ])
  })

  it('an element of no height is zero lines, so the core drops it', () => {
    const { items } = collectFlowItems(flowOf('<p data-flow="text" data-box="1000,0" style="line-height:10px"></p>'))
    expect(items[0]).toMatchObject({ kind: 'text', lines: 0 })
  })

  it('reads a table with its rows, the header flagged, the cell padding and the line height', () => {
    const flow = flowOf(`
      <table data-flow="table" data-flow-key="t:a" data-box="1100,100">
        <tr data-flow="row" data-flow-head data-box="1100,30"><th style="padding:4px;line-height:12px">h</th></tr>
        <tr data-flow="row" data-box="1130,40"><td style="padding:4px;line-height:12px">x</td></tr>
      </table>`)
    const { items, keys } = collectFlowItems(flow)
    expect(items).toEqual([
      {
        kind: 'table',
        id: 1,
        breakBefore: false,
        keepNext: false,
        rows: [
          { top: 100, height: 30, head: true, lineHeight: 12, pad: 4 },
          { top: 130, height: 40, head: false, lineHeight: 12, pad: 4 },
        ],
      },
    ])
    expect(keys.get(1)).toBe('t:a')
  })

  it('names the tables wider than the flow, which the render then lets break anywhere', () => {
    const flow = flowOf(`
      <table data-flow="table" data-flow-key="t:wide" data-box="1000,50,300"></table>
      <table data-flow="table" data-flow-key="t:fits" data-box="1060,50,100"></table>`)
    flow.setAttribute('data-box', '1000,0,100')
    expect(collectFlowItems(flow).overflowing).toEqual(['t:wide'])
    expect(collectFlowItems(flowOf('<p data-flow="text" data-box="0,0"></p>')).overflowing).toEqual([])
  })

  it('reads a unit with the boxes of its children as parts', () => {
    const flow = flowOf(`
      <div data-flow="unit" data-box="1200,90">
        <p data-box="1200,20"></p><p data-box="1230,60"></p>
      </div>`)
    expect(collectFlowItems(flow).items).toEqual([
      {
        kind: 'unit',
        id: 1,
        top: 200,
        height: 90,
        parts: [
          { top: 200, height: 20 },
          { top: 230, height: 60 },
        ],
        keepNext: false,
        breakBefore: false,
      },
    ])
  })

  it('lists the elements that paint across a page, with their boxes and keys', () => {
    const flow = flowOf(
      `<section data-flow-paint data-flow-key="h:a" data-box="1010,80"><p data-flow="text" data-box="1010,13.5" style="line-height:13.5px"></p></section>`,
    )
    expect(collectFlowItems(flow).painted).toEqual([{ key: 'h:a', top: 10, height: 80 }])
  })
})
