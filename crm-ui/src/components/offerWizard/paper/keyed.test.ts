import { describe, expect, it } from 'vitest'
import { clipPath, keyLayout } from './keyed'
import type { PagedLayout } from './types'

const layout: PagedLayout = {
  pages: 2,
  pageBoxes: [],
  flowBox: { left: 0, top: 0, width: 0 },
  rail: [],
  rowShift: new Map([['3:2', 40]]),
  tableExtra: new Map([['3', 40]]),
  rowFirstOnPage: new Set(['3:2']),
  cellRail: new Map([['3:1', [{ run: 5, dead: 9 }]]]),
  clip: new Map([
    ['3:1', [{ from: 5, to: 14 }]],
    ['h:a', [{ from: 1, to: 2 }]],
  ]),
  stageHeight: 0,
}

describe('keyLayout', () => {
  it('re-keys what the pure core keyed by item id to the table keys the render knows', () => {
    const keyed = keyLayout(layout, new Map([[3, 't:x']]))
    expect(keyed.rowShift.get('t:x:2')).toBe(40)
    expect(keyed.tableExtra.get('t:x')).toBe(40)
    expect(keyed.rowFirstOnPage.has('t:x:2')).toBe(true)
    expect(keyed.cellRail.get('t:x:1')).toEqual([{ run: 5, dead: 9 }])
    expect(keyed.clip.get('t:x:1')).toEqual([{ from: 5, to: 14 }])
    // a painted element is keyed by its own name already
    expect(keyed.clip.get('h:a')).toEqual([{ from: 1, to: 2 }])
  })
})

describe('clipPath', () => {
  it('keeps everything but the dead bands', () => {
    expect(
      clipPath([
        { from: 10, to: 20 },
        { from: 30, to: 35 },
      ]),
    ).toBe('path("M-10000 -10000H100000V10H-10000Z M-10000 20H100000V30H-10000Z M-10000 35H100000V100000H-10000Z")')
  })
  it('is none without bands', () => expect(clipPath(undefined)).toBeUndefined())
})
