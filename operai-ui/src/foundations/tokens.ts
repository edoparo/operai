/**
 * The design tokens' NAMES and roles, for code that needs them as data
 * (Storybook's foundations pages, a chart picking series colours). The VALUES
 * live only in styles/tokens.css — read them at runtime with
 * `getComputedStyle(document.documentElement).getPropertyValue(name)`, never
 * copy a hex value into TypeScript.
 */

export type ColorToken = {
  name: `--${string}`
  role: string
  /** Allowed as small text (WCAG AA 4.5:1 on --ink and --ink-soft, both themes). */
  text: boolean
}

export const COLOR_TOKENS: readonly ColorToken[] = [
  { name: '--ink', role: 'Page background', text: false },
  { name: '--ink-soft', role: 'Panel, card, dialog background', text: false },
  { name: '--ink-mid', role: 'Control background', text: false },
  { name: '--rule', role: 'Dividers, card and control borders', text: false },
  { name: '--dim', role: 'Strong borders, scrollbar thumb', text: false },
  { name: '--text', role: 'Primary text', text: true },
  {
    name: '--soft',
    role: 'Secondary text: labels, descriptions, meta',
    text: true,
  },
  {
    name: '--muted',
    role: 'Decorative only (2.8–3.2:1): never for text a user must read',
    text: false,
  },
  {
    name: '--acc',
    role: 'Accent: focus rings, active tab border, tints',
    text: false,
  },
  { name: '--acc-hi', role: 'Accent, high: focus outlines', text: false },
  { name: '--acc-lo', role: 'Accent tint background', text: false },
  {
    name: '--acc-solid',
    role: 'Filled accent under white text (primary button)',
    text: false,
  },
  {
    name: '--acc-text',
    role: 'Accent as text: links, active tab label',
    text: true,
  },
  { name: '--grn', role: 'Success: border, tint, glyph', text: false },
  { name: '--grn-text', role: 'Success as text', text: true },
  {
    name: '--org',
    role: 'Warning / recoverable error: border, tint, glyph',
    text: false,
  },
  { name: '--org-text', role: 'Warning as text', text: true },
  { name: '--red', role: 'Danger / error: border, tint, glyph', text: false },
  { name: '--red-text', role: 'Danger as text: field errors', text: true },
  { name: '--ai', role: 'EstimAI\'s AI accent: AI-assisted figures', text: true },
]

export type FontToken = {
  name: `--${string}`
  family: string
  role: string
}

export const FONT_TOKENS: readonly FontToken[] = [
  {
    name: '--disp',
    family: 'Syne 700/800',
    role: 'Display: tool, page, card and dialog titles',
  },
  {
    name: '--body',
    family: 'DM Sans 300/400/500',
    role: 'Body: everything else',
  },
  {
    name: '--mono',
    family: 'DM Mono 400/500',
    role: 'Figures: amounts, ids, table headers, numeric inputs',
  },
]
