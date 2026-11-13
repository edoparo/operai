import type { Meta, StoryObj } from '@storybook/react-vite'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { ToolLayout } from '../components/ToolLayout'

/**
 * Spacing comes from Tailwind's 4px scale (`gap-2` = 8px, `p-4` = 16px); the
 * library's components carry their own inner spacing. A tool picks ONE column
 * width on `ToolLayout`: `narrow` (40rem) for a single form or profile,
 * `default` (80rem) for lists and detail pages, `wide` (full width) for
 * data-dense workspaces.
 */
const meta: Meta = {
  title: 'Foundations/Spacing and layout',
  parameters: { controls: { disable: true } },
}
export default meta

const STEPS = [
  { cls: 'w-1', name: '1', px: 4, use: 'Icon to label' },
  { cls: 'w-2', name: '2', px: 8, use: 'Between buttons, list rows, badges' },
  { cls: 'w-3', name: '3', px: 12, use: 'Inside a row: status, meta, figure' },
  { cls: 'w-4', name: '4', px: 16, use: 'Between cards; card padding' },
  { cls: 'w-6', name: '6', px: 24, use: 'Column side gutter (tool-container)' },
  { cls: 'w-8', name: '8', px: 32, use: 'Above and below the page (tool-main)' },
  { cls: 'w-16', name: '16', px: 64, use: 'StatePanel vertical padding' },
] as const

function ScaleView() {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <ul className="flex list-none flex-col gap-3 p-0">
        {STEPS.map((step) => (
          <li key={step.name} className="grid grid-cols-[4rem_5rem_1fr] items-center gap-3">
            <code className="font-mono text-xs">{step.name}</code>
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className={`block h-3 rounded-sm bg-acc ${step.cls}`} />
              <span className="font-mono text-2xs text-soft">{step.px}px</span>
            </span>
            <span className="text-xs text-soft">{step.use}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-soft">
        Layout utilities (margin, padding, gap, width, flex, grid) are free to use on a page. Colour, border and radius
        on a library component are not: add a variant instead.
      </p>
    </div>
  )
}

export const Scale: StoryObj = {
  name: 'Spacing scale',
  render: () => <ScaleView />,
}

const WIDTHS = [
  { width: 'narrow', size: '40rem', cls: 'max-w-[40rem]', use: 'A single form or profile' },
  { width: 'default', size: '80rem', cls: 'max-w-[80rem]', use: 'Lists and detail pages: most tools' },
  { width: 'wide', size: 'full width', cls: 'max-w-none', use: 'Data-dense workspaces' },
] as const

function WidthsView() {
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-soft">
        The three columns of <code className="font-mono">ToolLayout width</code>, to scale. Each has a 24px gutter and
        is centred in the space the shell leaves for the tool.
      </p>
      <ul className="flex list-none flex-col gap-3 p-0">
        {WIDTHS.map((entry) => (
          <li key={entry.width} className={`w-full ${entry.cls}`}>
            <span className="flex items-center justify-between gap-3 rounded-md border border-acc bg-acc/10 px-3 py-2">
              <code className="font-mono text-xs text-acc-text">width=&quot;{entry.width}&quot;</code>
              <span className="text-xs text-soft">
                {entry.size} · {entry.use}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export const ColumnWidths: StoryObj = {
  name: 'Column widths',
  render: () => <WidthsView />,
}

type FrameArgs = { width: 'narrow' | 'default' | 'wide' }

/** A tool frame at the chosen width: change it in Controls. */
export const InAToolFrame: StoryObj<FrameArgs> = {
  name: 'In a tool frame',
  args: { width: 'default' },
  argTypes: { width: { control: 'inline-radio', options: ['narrow', 'default', 'wide'] } },
  parameters: { controls: { disable: false }, frame: 'page' },
  render: ({ width }) => (
    <ToolLayout title="Catalogue" width={width}>
      <PageHeader title="A page" description={`The ${width} column. Resize the canvas to see the gutter.`} />
      <div className="flex flex-col gap-4">
        <Card title="First card">
          <p className="text-sm text-soft">Cards stack with a 16px gap (gap-4).</p>
        </Card>
        <Card title="Second card">
          <p className="text-sm text-soft">The column never exceeds its width; on a phone it fills the screen.</p>
        </Card>
      </div>
    </ToolLayout>
  ),
}
