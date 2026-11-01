import type { Meta, StoryObj } from '@storybook/react-vite'
import { FONT_TOKENS } from './tokens'

/**
 * The type scale is Tailwind's steps plus one, `text-2xs` (11px, the floor).
 * Arbitrary sizes (`text-[13px]`) are a lint error. Titles are Syne
 * (`font-disp`), body and labels DM Sans (`font-body`), figures DM Mono
 * (`font-mono`).
 */
const meta: Meta = {
  title: 'Foundations/Type scale',
  parameters: { controls: { disable: true } },
}
export default meta

const SCALE = [
  {
    cls: 'text-2xs',
    px: 11,
    use: 'Captions, badges, table headers, tags',
    component: 'Badge, DataTable header, FactList term',
  },
  { cls: 'text-xs', px: 12, use: 'Labels, hints, secondary text', component: 'Field label, list row meta' },
  { cls: 'text-sm', px: 14, use: 'Body text, controls', component: '—' },
  { cls: 'text-base', px: 16, use: 'Empty and denied state titles', component: 'StatePanel' },
  { cls: 'text-lg', px: 18, use: 'Page titles (h2)', component: 'PageHeader' },
  { cls: 'text-xl', px: 20, use: 'Tool titles (h1)', component: 'ToolLayout' },
  { cls: 'text-2xl', px: 24, use: 'Rare display figures', component: '—' },
] as const

const FAMILY_CLASS: Record<string, string> = { '--disp': 'font-disp', '--body': 'font-body', '--mono': 'font-mono' }
const FAMILY_SAMPLE: Record<string, string> = {
  '--disp': 'Catalogue settings',
  '--body': 'The quick brown fox jumps over the lazy dog.',
  '--mono': 'CAT-0104 · 31.10.2026 · EUR 1,234.50',
}

function ScaleView() {
  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <div role="region" aria-label="Type scale" tabIndex={0} className="table-region">
        <table className="data-table">
          <caption className="visually-hidden">The type scale</caption>
          <thead>
            <tr>
              <th scope="col">Class</th>
              <th scope="col" className="is-numeric">
                Size
              </th>
              <th scope="col">Sample</th>
              <th scope="col">Use</th>
              <th scope="col">Component</th>
            </tr>
          </thead>
          <tbody>
            {SCALE.map((step) => (
              <tr key={step.cls}>
                <th scope="row" className="font-mono">
                  {step.cls}
                </th>
                <td className="is-numeric">{step.px}px</td>
                <td>
                  <span className={step.cls}>Sample text</span>
                </td>
                <td className="text-soft">{step.use}</td>
                <td className="text-soft">{step.component}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-soft">
        Buttons are 13px (12px small) inside .btn: a component&apos;s own size, not a page choice.
      </p>
    </div>
  )
}

export const Scale: StoryObj = {
  render: () => <ScaleView />,
}

function FamiliesView() {
  return (
    <ul className="flex max-w-3xl list-none flex-col gap-4 p-0">
      {FONT_TOKENS.map((font) => (
        <li key={font.name} className="card">
          <span className="flex flex-wrap items-baseline gap-3">
            <span className="font-disp text-sm font-bold">{font.family}</span>
            <code className="font-mono text-xs text-soft">
              {FAMILY_CLASS[font.name]} · var({font.name})
            </code>
          </span>
          <span className={`${FAMILY_CLASS[font.name]} text-2xl`}>{FAMILY_SAMPLE[font.name]}</span>
          <span className="text-xs text-soft">{font.role}</span>
        </li>
      ))}
    </ul>
  )
}

export const Families: StoryObj = {
  render: () => <FamiliesView />,
}

function HierarchyView() {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-soft">
        The headings of a page, as the components render them: the tool title is the page&apos;s one h1, a page title
        h2, a card or dialog title h3.
      </p>
      <div className="flex flex-col gap-4 rounded-md border border-rule p-4">
        <h1 className="tool-title py-0">Tool title — h1, 20px Syne</h1>
        <h2 className="page-title">Page title — h2, 18px Syne</h2>
        <h3 className="card-title">Card or dialog title — h3, 14px Syne</h3>
        <p className="text-sm">Body — 14px DM Sans, the default for running text and controls.</p>
        <p className="text-xs text-soft">Secondary — 12px DM Sans in soft: labels, hints, meta lines.</p>
        <p className="font-mono text-2xs tracking-wider text-soft uppercase">Table header — 11px DM Mono</p>
        <p className="font-mono text-sm">Figures — DM Mono: 1,234.50 · 31.10.2026</p>
      </div>
    </div>
  )
}

export const Hierarchy: StoryObj = {
  name: 'Heading hierarchy',
  render: () => <HierarchyView />,
}
