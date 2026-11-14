/**
 * The suite's one styling dialect, enforced (ADR 20261031-one-styling-dialect-token-utilities). Every frontend's
 * eslint.config.js spreads this into its config:
 *
 *   import { designTokenRules } from '../operai-ui/eslint/design-tokens.ts'
 *   export default defineConfig([..., designTokenRules])
 *
 * (Node 24 strips the types when ESLint loads this file, so it stays TypeScript
 * with no build step; keep it to erasable syntax.)
 *
 * Design tokens reach an element through a token utility (`text-soft`,
 * `bg-ink-mid`, `border-rule`, `bg-org/10`, `font-mono`) or a library
 * component class (`btn`, `card`, `badge-success`), never as a CSS value in
 * TypeScript. That covers the indirect form too: a status → `'var(--grn)'`
 * map passed to `style={{ color }}` becomes a status → `'text-grn'` map.
 * Inline `style` stays for values that are genuinely computed at runtime
 * (a width, a position, a transform) and never carries a colour.
 */

const MESSAGE =
  'Design tokens go through Tailwind token utilities (text-soft, bg-ink-mid, border-rule, bg-org/10, font-mono) or @operai/ui classes, never through var(--…) or a colour value in TypeScript (ADR 20261031-one-styling-dialect-token-utilities, operai-ui/docs/design-system.md § Styling).'

const TYPE_MESSAGE =
  'Font sizes come from the type scale: text-2xs (11px), text-xs (12), text-sm (14), text-base (16), text-lg (18), text-xl (20), text-2xl (24) — never an arbitrary text-[Npx] (INC-06, operai-ui/docs/design-system.md § Type).'

export const designTokenRules = {
  files: ['**/*.{ts,tsx}'],
  ignores: ['**/*.test.{ts,tsx}', '**/*.stories.{ts,tsx}', '**/test-setup.ts', '**/eslint/**'],
  rules: {
    'no-restricted-syntax': [
      'error',
      { selector: 'Literal[value=/var\\(--/]', message: MESSAGE },
      { selector: 'TemplateElement[value.raw=/var\\(--/]', message: MESSAGE },
      // Arbitrary font sizes (`text-[13px]`): use the type scale (text-2xs … text-2xl), INC-06.
      { selector: 'Literal[value=/(^|[\\s:])text-\\[\\d/]', message: TYPE_MESSAGE },
      { selector: 'TemplateElement[value.raw=/(^|[\\s:])text-\\[\\d/]', message: TYPE_MESSAGE },
      // Arbitrary colour values in a class name (`text-[#b47fff]`, `bg-[rgb(…)]`): add a token instead.
      { selector: 'Literal[value=/-\\[(#|rgba?\\(|hsla?\\(|oklch\\()/]', message: MESSAGE },
      { selector: 'TemplateElement[value.raw=/-\\[(#|rgba?\\(|hsla?\\(|oklch\\()/]', message: MESSAGE },
      {
        selector:
          "JSXAttribute[name.name='style'] Literal[value=/#[0-9a-fA-F]{3,8}\\b|rgba?\\(|hsla?\\(|color-mix\\(/]",
        message: MESSAGE,
      },
      {
        selector:
          "JSXAttribute[name.name='style'] TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b|rgba?\\(|hsla?\\(|color-mix\\(/]",
        message: MESSAGE,
      },
      {
        selector: "JSXAttribute[name.name='style'] Property[key.name='colorScheme']",
        message: `${MESSAGE} The colour scheme follows the theme from tokens.css; a fixed colorScheme is wrong in the other theme.`,
      },
    ],
  },
}
