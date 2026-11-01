import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from './Badge'
import { Icon } from './Icon'

/**
 * A status, category or currency label: tone + glyph + text. Colour is never
 * the only signal, so a semantic tone always comes with a glyph. For a status,
 * prefer `StatusBadge`, which takes tone and icon from the status dictionary.
 * Metadata (a category, a currency) is always `neutral`.
 */
const meta = {
  title: 'Components/Content/Badge',
  component: Badge,
  tags: ['autodocs'],
  args: { tone: 'accent', children: 'On order', glyph: <Icon name="clock" /> },
  argTypes: {
    tone: { control: 'inline-radio', options: ['neutral', 'accent', 'success', 'warning', 'danger', 'muted'] },
    children: { control: 'text' },
    glyph: { control: false },
  },
} satisfies Meta<typeof Badge>
export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Tones: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge tone="neutral" glyph={<Icon name="pencil" />}>
        Neutral: draft
      </Badge>
      <Badge tone="accent" glyph={<Icon name="clock" />}>
        Accent: in progress
      </Badge>
      <Badge tone="success" glyph={<Icon name="check" />}>
        Success: done
      </Badge>
      <Badge tone="warning" glyph={<Icon name="wrench" />}>
        Warning: needs attention
      </Badge>
      <Badge tone="danger" glyph={<Icon name="x-circle" />}>
        Danger: failed
      </Badge>
      <Badge tone="muted" glyph={<Icon name="ban" />}>
        Muted: voided
      </Badge>
    </div>
  ),
}

/** Categories, currencies and codes are neutral metadata, never a semantic tone. */
export const Metadata: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge>EUR</Badge>
      <Badge>CHF</Badge>
      <Badge>Lighting</Badge>
      <Badge glyph={<Icon name="user" />}>Team north</Badge>
    </div>
  ),
}

/** In context: a badge beside a title or in a table cell keeps its own size. */
export const InContext: Story = {
  name: 'In context',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="font-disp text-lg font-bold">Oak desk lamp</span>
        <Badge tone="success" glyph={<Icon name="check" />}>
          Available
        </Badge>
      </div>
      <p className="text-sm">
        Priced in <Badge>EUR</Badge> and listed under <Badge>Lighting</Badge>.
      </p>
    </div>
  ),
}
