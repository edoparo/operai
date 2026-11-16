/**
 * A tiny builder of unpaged flows for the pagination's tests and its timing: items stacked from y = 0 with explicit
 * gaps, so a vector reads as "9 lines, 5 px of margin, a 3-line block". Not used by the app.
 */
import type { FlowItem } from './types'

interface Opts {
  keepNext?: boolean
  breakBefore?: boolean
}

export class FlowBuilder {
  y = 0
  readonly items: FlowItem[] = []
  private nextId = 1

  readonly lineHeight: number

  constructor(lineHeight = 10) {
    this.lineHeight = lineHeight
  }

  gap(px: number): this {
    this.y += px
    return this
  }

  text(lines: number, opts: Opts = {}): number {
    const id = this.nextId++
    this.items.push({
      kind: 'text',
      id,
      top: this.y,
      lineHeight: this.lineHeight,
      lines,
      keepNext: opts.keepNext ?? false,
      breakBefore: opts.breakBefore ?? false,
    })
    this.y += lines * this.lineHeight
    return id
  }

  heading(lines = 1, opts: Opts = {}): number {
    return this.text(lines, { ...opts, keepNext: true })
  }

  unit(height: number, opts: Opts & { parts?: readonly number[] } = {}): number {
    const id = this.nextId++
    let at = this.y
    const parts = opts.parts?.map((h) => {
      const part = { top: at, height: h }
      at += h
      return part
    })
    this.items.push({
      kind: 'unit',
      id,
      top: this.y,
      height,
      ...(parts ? { parts } : {}),
      keepNext: opts.keepNext ?? false,
      breakBefore: opts.breakBefore ?? false,
    })
    this.y += height
    return id
  }

  /** Rows of `lines` lines each (row height = 2 * pad + lines * lineHeight), contiguous. */
  table(
    rows: readonly { lines: number; head?: boolean }[],
    opts: { pad?: number; breakBefore?: boolean } = {},
  ): number {
    const id = this.nextId++
    const pad = opts.pad ?? 0
    const built = rows.map((row) => {
      const height = 2 * pad + row.lines * this.lineHeight
      const made = { top: this.y, height, head: row.head ?? false, lineHeight: this.lineHeight, pad }
      this.y += height
      return made
    })
    this.items.push({ kind: 'table', id, breakBefore: opts.breakBefore ?? false, rows: built })
    return id
  }
}

const keeps = (item: FlowItem): boolean => item.kind !== 'table' && item.keepNext

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A seeded random flow of headings, text, tables and units (always with parts, as T74 collects them), annex starts and the odd empty item. */
export function randomFlow(rand: () => number, lineHeight: number): FlowBuilder {
  const f = new FlowBuilder(lineHeight)
  const pick = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1))
  const count = pick(1, 45)
  for (let i = 0; i < count; i++) {
    if (f.y > 0 && rand() < 0.5) f.gap(rand() * 12)
    const r = rand()
    const afterKeep = f.items.length > 0 && keeps(f.items[f.items.length - 1]!)
    const annex = !afterKeep && rand() < 0.06
    if (r < 0.2) {
      f.heading(pick(1, 2))
    } else if (r < 0.62) {
      f.text(rand() < 0.05 ? 0 : rand() < 0.15 ? pick(14, 70) : pick(1, 8), { breakBefore: annex })
    } else if (r < 0.82) {
      const rows = [{ lines: 1, head: rand() < 0.8 }]
      for (let k = pick(1, 16); k > 0; k--) rows.push({ lines: rand() < 0.08 ? pick(15, 60) : pick(1, 4), head: false })
      f.table(rows, { pad: rand() * 5, breakBefore: annex })
    } else {
      const parts = Array.from({ length: pick(1, 7) }, () => 4 + rand() * 40)
      f.unit(
        parts.reduce((a, b) => a + b, 0),
        { parts, breakBefore: annex },
      )
    }
  }
  return f
}
