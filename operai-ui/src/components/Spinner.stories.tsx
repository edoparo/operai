import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './Button'
import { Spinner } from './Spinner'

/**
 * A small rotating ring in the current text colour. Decorative
 * (`aria-hidden`): the busy state is announced by the control's own label and
 * `aria-busy`, or by a polite live region. `Button busy` already includes
 * one. Stops under reduced motion. For a page or a list that loads, prefer
 * `SkeletonRows`.
 */
const meta = {
  title: 'Components/Feedback/Spinner',
  component: Spinner,
  tags: ['autodocs'],
  args: { size: 'md' },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] } },
} satisfies Meta<typeof Spinner>
export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center gap-6">
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <span key={size} className="flex items-center gap-2">
          <Spinner size={size} />
          <code className="font-mono text-xs text-soft">{size}</code>
        </span>
      ))}
    </div>
  ),
}

/** Inside a busy button (added by `Button busy`), and inline with a live text. */
export const InContext: Story = {
  name: 'In context',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <Button variant="primary" busy disabled>
        Saving…
      </Button>
      <p className="flex items-center gap-2 text-sm text-soft">
        <Spinner />
        <span aria-live="polite">Checking availability…</span>
      </p>
    </div>
  ),
}
