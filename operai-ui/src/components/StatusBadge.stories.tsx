import type { Meta, StoryObj } from '@storybook/react-vite'
import { STATUS, StatusBadge } from './StatusBadge'
import type { StatusMeaning } from './StatusBadge'

/**
 * A `Badge` whose tone and icon come from the status dictionary
 * (Foundations/Status dictionary). An app maps each of its own statuses to a
 * meaning once (`archived → 'voided'`) and passes its own label.
 */
const meta = {
  title: 'Components/Content/StatusBadge',
  component: StatusBadge,
  tags: ['autodocs'],
  args: { status: 'pending', children: 'On order' },
  argTypes: {
    status: { control: 'select', options: Object.keys(STATUS) },
    children: { control: 'text' },
  },
} satisfies Meta<typeof StatusBadge>
export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {}

const LABELS: Record<StatusMeaning, string> = {
  draft: 'Draft',
  pending: 'On order',
  active: 'Available',
  settled: 'Delivered',
  stored: 'In storage',
  attention: 'Needs review',
  failed: 'Rejected',
  missing: 'Missing',
  voided: 'Archived',
  info: 'Built-in',
}

export const EveryMeaning: Story = {
  name: 'Every meaning',
  parameters: { controls: { disable: true } },
  render: () => (
    <ul className="flex list-none flex-col gap-2 p-0">
      {(Object.keys(STATUS) as StatusMeaning[]).map((meaning) => (
        <li key={meaning} className="flex items-center gap-3">
          <code className="w-24 font-mono text-xs text-soft">{meaning}</code>
          <StatusBadge status={meaning}>{LABELS[meaning]}</StatusBadge>
        </li>
      ))}
    </ul>
  ),
}

/** One app-side mapping: the domain value picks a meaning, the app keeps its label. */
export const AppMapping: Story = {
  name: 'An app’s mapping',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-3">
      <pre className="overflow-x-auto rounded-md border border-rule bg-ink-soft p-3 font-mono text-xs">
        {`const ITEM_STATUS = {
  draft:     { meaning: 'draft',   label: 'Draft' },
  available: { meaning: 'active',  label: 'Available' },
  archived:  { meaning: 'voided',  label: 'Archived' },
}
<StatusBadge status={ITEM_STATUS[s].meaning}>{ITEM_STATUS[s].label}</StatusBadge>`}
      </pre>
      <div className="flex flex-wrap gap-2">
        <StatusBadge status="draft">Draft</StatusBadge>
        <StatusBadge status="active">Available</StatusBadge>
        <StatusBadge status="voided">Archived</StatusBadge>
      </div>
    </div>
  ),
}
