/**
 * The preview's page geometry: pure numbers from the width the pane gives and the browser's root font size
 * (specs/20261115-crm-offer-wizard T73, plan DD-66, AC-11.10, AC-11.13). No DOM, no React.
 *
 * Every number a page is drawn from comes from `lib/offerPaper/paper.ts` (the PDF's own constants, DD-67) scaled
 * to CSS px; none is copied here except the three the preview alone owns: the widest page, the gap between pages
 * and the text floor.
 */
import {
  CELL_PAD,
  FRAME,
  HEADING_SIZE,
  LINE,
  NUMBER_BASELINE,
  NUMBER_CORNER,
  NUMBER_RIGHT_INSET,
  NUMBER_SIZE,
  PAGE,
  SIZE,
  SPACING,
  TABLE_SIZE,
  TITLE_SIZE,
} from '../../../lib/offerPaper/paper'

/** 210 mm at 96 px per inch: a wider pane centres a page of this width. */
export const PAGE_MAX_WIDTH = 794
/** The space between two pages, CSS px. */
export const PAGE_GAP = 16
/** The side margin around the stack of pages never exceeds this, CSS px. */
export const INSET_MAX = 16
/**
 * The smallest text the preview draws, CSS px, at the default 16 px root (AC-11.13, owner delegation 2026-11-15:
 * 10 px, superseding 12). It is a floor on the DRAWN size only: a page narrower than the PDF scales the text no
 * further down than this, so the breaks differ from the PDF's.
 */
export const FLOOR_PX = 10
/** The browser's default root font size: the floor's reference (design D-36, finding G21). */
const DEFAULT_ROOT_PX = 16

export interface TypeMetrics {
  /** The drawn size, CSS px. */
  fontPx: number
  /** `LINE` times the drawn size, CSS px: an explicit line height, so a text's lines are exact multiples of it. */
  lineHeightPx: number
}

export type TypeRole = 'body' | 'subheading' | 'heading' | 'title' | 'table' | 'note'

export interface PageGeometry {
  /** The pane width the geometry was made for (sanitised). */
  available: number
  /** A page's width, W = min(794, available - 2 * inset), and its height, W * 297 / 210. CSS px. */
  width: number
  height: number
  /** W / 595.28: px per PDF point at the page's own scale. */
  scale: number
  /** The margin around the stack, min(16, available / 20), and the gap between pages. */
  inset: number
  gap: number
  /** The page box's left edge in the stage: pages are centred in a pane wider than the maximum. */
  left: number
  /** The frame the text may use on each page, CSS px (the PDF's FRAME times `scale`). */
  frame: { top: number; bottom: number; left: number; right: number }
  /** A page's body: the height of the frame, H - (top + bottom). */
  body: number
  /** Px per PDF point of spacing: the floored body size / 10 (spacing grows with the text, not with the page). */
  unit: number
  type: Record<TypeRole, TypeMetrics>
  /** `SPACING` in px: every fixed value is points times `unit`; a name ending `Ratio` is a multiple, left as it is. */
  spacing: { -readonly [K in keyof typeof SPACING]: number }
  /** Padding inside a table cell, every side, CSS px. */
  cellPad: number
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** The floor at this root size: 10 px at 16 px, and 10/16 of the root beyond it (doubled text doubles the floor). */
export function floorPx(rootFontPx: number): number {
  return Math.max(FLOOR_PX, (FLOOR_PX / DEFAULT_ROOT_PX) * finitePositive(rootFontPx, DEFAULT_ROOT_PX))
}

export function pageGeometry(available: number, rootFontPx: number): PageGeometry {
  const avail = finitePositive(available, 1)
  const inset = Math.min(INSET_MAX, avail / 20)
  const width = Math.max(1, Math.min(PAGE_MAX_WIDTH, avail - 2 * inset))
  const scale = width / PAGE.width
  const height = (width * 297) / 210
  const frame = {
    top: FRAME.top * scale,
    bottom: FRAME.bottom * scale,
    left: FRAME.left * scale,
    right: FRAME.right * scale,
  }
  const floor = floorPx(rootFontPx)
  const metrics = (pt: number): TypeMetrics => {
    const fontPx = Math.max(floor, pt * scale)
    return { fontPx, lineHeightPx: fontPx * LINE }
  }
  const type: Record<TypeRole, TypeMetrics> = {
    body: metrics(SIZE),
    subheading: metrics(SIZE),
    heading: metrics(HEADING_SIZE),
    title: metrics(TITLE_SIZE),
    table: metrics(TABLE_SIZE),
    // The effort annex's AI note is drawn at the table size.
    note: metrics(TABLE_SIZE),
  }
  const unit = type.body.fontPx / SIZE
  const spacing = {} as { -readonly [K in keyof typeof SPACING]: number }
  for (const key of Object.keys(SPACING) as (keyof typeof SPACING)[]) {
    spacing[key] = key.endsWith('Ratio') ? SPACING[key] : SPACING[key] * unit
  }
  return {
    available: avail,
    width,
    height,
    scale,
    inset,
    gap: PAGE_GAP,
    left: Math.max(inset, (avail - width) / 2),
    frame,
    body: height - frame.top - frame.bottom,
    unit,
    type,
    spacing,
    cellPad: CELL_PAD * unit,
  }
}

/**
 * Where the page number goes on a page, and the white box over the letterhead's own number (D-2, owner 2026-11-15):
 * the PDF's `NUMBER_*` points scaled by the page's own scale, as percentages of the page's box for the box and the
 * right edge (the letterhead image is stretched over the same box) and CSS px for the size. The number is page
 * chrome, part of the page as drawn, like the letterhead's own: it is NOT floored (a 10 px floor would make it larger
 * than the PDF's on a narrow page, and it is decoration, aria-hidden, never body text a person must read).
 */
export interface PageNumberGeometry {
  /** The corner painted in white over the letterhead's own number, % of the page box. */
  corner: { left: string; bottom: string; width: string; height: string }
  /** The number's right edge from the page box's right edge, %. */
  right: string
  /** The number's drawn size, CSS px: `NUMBER_SIZE` times the page's scale. */
  fontPx: number
  /** The text box's bottom edge from the page box's bottom, CSS px, such that the baseline lands on `NUMBER_BASELINE`. */
  bottomPx: number
}

/**
 * The distance from a line box's bottom edge to its baseline, as a multiple of the font size, for a line box one em
 * tall: (1 - ascent + descent) / 2 for the body face (DM Sans, 0.992 and 0.31) is 0.159; common fallbacks give 0.15-0.16,
 * so the baseline is placed within 0.1 px of the PDF's at every page size.
 */
const BASELINE_FROM_BOTTOM_EM = 0.155

export function pageNumberGeometry(g: Pick<PageGeometry, 'scale'>): PageNumberGeometry {
  const pct = (points: number, of: number) => `${(points / of) * 100}%`
  const fontPx = NUMBER_SIZE * g.scale
  return {
    corner: {
      left: pct(NUMBER_CORNER.x, PAGE.width),
      bottom: pct(NUMBER_CORNER.y, PAGE.height),
      width: pct(NUMBER_CORNER.width, PAGE.width),
      height: pct(NUMBER_CORNER.height, PAGE.height),
    },
    right: pct(NUMBER_RIGHT_INSET, PAGE.width),
    fontPx,
    bottomPx: NUMBER_BASELINE * g.scale - BASELINE_FROM_BOTTOM_EM * fontPx,
  }
}
