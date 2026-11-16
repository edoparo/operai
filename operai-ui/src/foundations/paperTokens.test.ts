import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The preview paper (specs/20261115-crm-offer-wizard design § Preview pane): a
 * light page that represents the print, so it stays light in BOTH themes.
 * Read straight from tokens.css, like the Colours story does at runtime.
 */
const css = readFileSync(resolve(__dirname, '../styles/tokens.css'), 'utf8')

const TOKENS = ['paper', 'paper-ink', 'paper-soft', 'paper-rule', 'paper-head', 'paper-mark', 'paper-mark-ink'] as const

/** The body of the first block opened by `selector` (these blocks hold no nested braces). */
function block(selector: string, from = 0): string {
  const start = css.indexOf(`${selector} {`, from)
  expect(start, `selector ${selector}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

const value = (scope: string, token: string): string | undefined =>
  new RegExp(`--${token}:\\s*([^;]+);`).exec(scope)?.[1].trim()

const channel = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  expect(m, `${hex} is a 6-digit hex`).not.toBeNull()
  const n = parseInt(m![1], 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('paper-* tokens', () => {
  const dark = block(':root')
  const light = block("[data-theme='light']")
  const system = block(":root:not([data-theme='dark'])", css.indexOf('@media (prefers-color-scheme: light) {'))

  it.each(TOKENS)('--%s is defined in the base block', (token) => {
    expect(value(dark, token)).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it.each(TOKENS)('--%s has the same value in every theme (the print is not recoloured)', (token) => {
    const base = value(dark, token)
    expect(value(light, token)).toBe(base)
    expect(value(system, token)).toBe(base)
  })

  it.each(TOKENS)('--%s has a Tailwind @theme inline line', (token) => {
    expect(css).toContain(`--color-${token}: var(--${token});`)
  })

  it('meets the contrast floors of design § Accessibility', () => {
    const v = (t: string) => value(dark, t)!
    expect(contrast(v('paper-ink'), v('paper'))).toBeGreaterThanOrEqual(15)
    expect(contrast(v('paper-soft'), v('paper'))).toBeGreaterThanOrEqual(6)
    expect(contrast(v('paper-mark-ink'), v('paper-mark'))).toBeGreaterThanOrEqual(7)
  })

  it('keeps text readable on the table-head tint too', () => {
    const v = (t: string) => value(dark, t)!
    expect(contrast(v('paper-ink'), v('paper-head'))).toBeGreaterThanOrEqual(15)
    expect(contrast(v('paper-soft'), v('paper-head'))).toBeGreaterThanOrEqual(4.5)
  })
})
