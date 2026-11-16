/**
 * Page geometry (specs/20261115-crm-offer-wizard T73, DD-66, AC-11.10, AC-11.13): pure numbers, no DOM.
 */
import { describe, expect, it } from 'vitest'
import { FRAME, HEADING_SIZE, LINE, NUMBER_BASELINE, NUMBER_CORNER, NUMBER_RIGHT_INSET, NUMBER_SIZE, PAGE, SIZE, SPACING, TABLE_SIZE, TITLE_SIZE } from '../../../lib/offerPaper/paper'
import { FLOOR_PX, PAGE_GAP, PAGE_MAX_WIDTH, pageGeometry, pageNumberGeometry } from './geometry'

describe('pageGeometry: the page', () => {
  it('a wide pane gets the maximum page, centred', () => {
    const g = pageGeometry(1200, 16)
    expect(g.width).toBe(PAGE_MAX_WIDTH)
    expect(g.width).toBe(794)
    expect(g.inset).toBe(16)
    expect(g.left).toBeCloseTo((1200 - 794) / 2, 9)
  })

  it('a narrow pane gets its width minus an inset on each side, and never more than the available width', () => {
    const g = pageGeometry(488, 16)
    expect(g.inset).toBeCloseTo(16, 9)
    expect(g.width).toBeCloseTo(488 - 32, 9)
    expect(g.left).toBeCloseTo(16, 9)
    expect(g.left + g.width + g.inset).toBeLessThanOrEqual(488 + 1e-9)
  })

  it('at 320 CSS px nothing exceeds the available width (AC-11.13)', () => {
    const g = pageGeometry(320, 16)
    expect(g.inset).toBe(16)
    expect(g.width).toBe(288)
    expect(g.left * 2 + g.width).toBeLessThanOrEqual(320)
  })

  it('a tiny pane shrinks the inset with it: inset = min(16, available / 20)', () => {
    const g = pageGeometry(100, 16)
    expect(g.inset).toBe(5)
    expect(g.width).toBe(90)
  })

  it('keeps the A4 proportions (297 / 210) and the PDF frame as proportions (AC-11.10)', () => {
    for (const available of [320, 488, 640, 900, 1600]) {
      const g = pageGeometry(available, 16)
      expect(g.height / g.width).toBeCloseTo(297 / 210, 9)
      expect(g.scale).toBeCloseTo(g.width / PAGE.width, 12)
      expect(g.frame.top / g.height).toBeCloseTo(FRAME.top / PAGE.height, 3)
      expect(g.frame.bottom / g.height).toBeCloseTo(FRAME.bottom / PAGE.height, 3)
      expect(g.frame.left / g.width).toBeCloseTo(FRAME.left / PAGE.width, 12)
      expect(g.frame.right / g.width).toBeCloseTo(FRAME.right / PAGE.width, 12)
      expect(g.frame.top).toBeCloseTo(FRAME.top * g.scale, 9)
    }
  })

  it('the page body is the height minus the top and bottom frame, the gap is 16', () => {
    const g = pageGeometry(794 + 32, 16)
    expect(g.scale).toBeCloseTo(794 / PAGE.width, 12)
    expect(g.body).toBeCloseTo(g.height - (FRAME.top + FRAME.bottom) * g.scale, 9)
    expect(g.gap).toBe(PAGE_GAP)
    expect(PAGE_GAP).toBe(16)
  })

  it('never returns a negative or non-finite size for hostile input', () => {
    for (const [a, r] of [
      [0, 16],
      [-5, 16],
      [Number.NaN, 16],
      [300, 0],
      [300, Number.NaN],
      [300, -3],
    ] as const) {
      const g = pageGeometry(a, r)
      for (const v of [
        g.width,
        g.height,
        g.body,
        g.inset,
        g.left,
        g.unit,
        g.type.body.fontPx,
        g.type.body.lineHeightPx,
      ]) {
        expect(Number.isFinite(v)).toBe(true)
      }
      expect(g.width).toBeGreaterThan(0)
      expect(g.body).toBeGreaterThan(0)
    }
  })
})

describe('pageGeometry: type scaling and the 10 px floor (AC-11.13, D-36 G21)', () => {
  it('the floor is 10 CSS px at the default 16 px root', () => {
    expect(FLOOR_PX).toBe(10)
    const g = pageGeometry(320, 16)
    // s = 288 / 595.28 = 0.484: every PDF size is under 10 px, so every size sits on the floor.
    expect(g.type.body.fontPx).toBe(10)
    expect(g.type.table.fontPx).toBe(10)
    expect(g.type.heading.fontPx).toBe(10)
    expect(g.type.title.fontPx).toBe(10)
    expect(g.type.note.fontPx).toBe(10)
  })

  it("the default 1280 x 800 pane (about 488 px) draws 10 px body text, not the plan's old 12", () => {
    const g = pageGeometry(488, 16)
    expect(g.type.body.fontPx).toBe(10)
    expect(g.type.body.lineHeightPx).toBeCloseTo(13.5, 9)
  })

  it('a wide page scales the PDF sizes with the page above the floor', () => {
    const g = pageGeometry(1200, 16)
    const s = 794 / PAGE.width
    expect(g.type.body.fontPx).toBeCloseTo(SIZE * s, 9)
    expect(g.type.heading.fontPx).toBeCloseTo(HEADING_SIZE * s, 9)
    expect(g.type.title.fontPx).toBeCloseTo(TITLE_SIZE * s, 9)
    expect(g.type.table.fontPx).toBeCloseTo(TABLE_SIZE * s, 9)
    expect(g.type.subheading.fontPx).toBeCloseTo(SIZE * s, 9)
  })

  it("the floor tracks the person's text size: root 32 gives a 20 px floor, root 12 keeps 10", () => {
    expect(pageGeometry(488, 32).type.body.fontPx).toBeCloseTo(20, 9)
    expect(pageGeometry(488, 24).type.body.fontPx).toBeCloseTo(15, 9)
    expect(pageGeometry(488, 12).type.body.fontPx).toBe(10)
  })

  it('every size is max(floor, pt * s) and never under 10 px at any width or root', () => {
    for (const available of [160, 320, 488, 600, 794, 1000, 2000]) {
      for (const root of [10, 16, 20, 32]) {
        const g = pageGeometry(available, root)
        const floor = Math.max(10, (10 / 16) * root)
        for (const [pt, key] of [
          [SIZE, 'body'],
          [SIZE, 'subheading'],
          [HEADING_SIZE, 'heading'],
          [TITLE_SIZE, 'title'],
          [TABLE_SIZE, 'table'],
        ] as const) {
          expect(g.type[key].fontPx).toBeGreaterThanOrEqual(10)
          expect(g.type[key].fontPx).toBeCloseTo(Math.max(floor, pt * g.scale), 9)
        }
      }
    }
  })

  it("the line height is the PDF's 1.35 times the drawn size, in px", () => {
    const g = pageGeometry(1200, 16)
    for (const t of Object.values(g.type)) expect(t.lineHeightPx).toBeCloseTo(t.fontPx * LINE, 9)
  })

  it("spacing, indent and cell padding are the PDF's points times the floored body size / 10", () => {
    const g = pageGeometry(488, 16)
    expect(g.unit).toBeCloseTo(1, 9)
    expect(g.spacing.sectionBefore).toBeCloseTo(SPACING.sectionBefore * g.unit, 9)
    expect(g.spacing.listIndent).toBeCloseTo(SPACING.listIndent * g.unit, 9)
    expect(g.cellPad).toBeCloseTo(4 * g.unit, 9)
    const big = pageGeometry(488, 32)
    expect(big.unit).toBeCloseTo(2, 9)
    expect(big.spacing.acceptanceLineHeight).toBeCloseTo(SPACING.acceptanceLineHeight * 2, 9)
    // a ratio is a multiple of a type size, not points: passed through
    expect(big.spacing.paragraphAfterRatio).toBe(SPACING.paragraphAfterRatio)
  })
})

describe('pageNumberGeometry: the PDF\'s page number, scaled (D-2)', () => {
  it('is the PDF constants times the page scale, not floored', () => {
    for (const available of [320, 488, 900, 1600]) {
      const g = pageGeometry(available, 16)
      const n = pageNumberGeometry(g)
      expect(n.fontPx).toBeCloseTo(NUMBER_SIZE * g.scale, 12)
      expect(parseFloat(n.corner.left) / 100).toBeCloseTo(NUMBER_CORNER.x / PAGE.width, 12)
      expect(parseFloat(n.corner.bottom) / 100).toBeCloseTo(NUMBER_CORNER.y / PAGE.height, 12)
      expect(parseFloat(n.corner.width) / 100).toBeCloseTo(NUMBER_CORNER.width / PAGE.width, 12)
      expect(parseFloat(n.corner.height) / 100).toBeCloseTo(NUMBER_CORNER.height / PAGE.height, 12)
      expect(parseFloat(n.right) / 100).toBeCloseTo(NUMBER_RIGHT_INSET / PAGE.width, 12)
      // the baseline sits at NUMBER_BASELINE points from the bottom, within a tenth of a pixel
      expect(Math.abs(n.bottomPx + 0.155 * n.fontPx - NUMBER_BASELINE * g.scale)).toBeLessThan(1e-9)
      expect(n.bottomPx).toBeGreaterThan(0)
    }
  })

  it('at the widest page the number is 8.5 pt in CSS px', () => {
    const g = pageGeometry(1600, 16)
    expect(pageNumberGeometry(g).fontPx).toBeCloseTo((8.5 * 794) / 595.28, 9)
  })
})
