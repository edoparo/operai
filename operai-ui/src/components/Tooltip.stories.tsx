import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './Button'
import { Tooltip } from './Tooltip'

/**
 * A short explanation of a control whose label cannot say everything: shown on
 * hover and on keyboard focus, dismissed with Escape. Spread the render
 * argument on the trigger so screen readers announce the text too. Never put
 * something the user must read to act only in a tooltip.
 */
const meta = {
  title: 'Components/Content/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
  args: {
    content: 'Lets this deal move to proposal without a ready estimate. The reason is kept on the deal.',
    align: 'start',
    children: (describedBy) => (
      <Button size="sm" variant="ghost" {...describedBy}>
        Override gate
      </Button>
    ),
  },
  argTypes: {
    content: { control: 'text' },
    align: { control: 'inline-radio', options: ['start', 'end'] },
    children: { control: false },
  },
} satisfies Meta<typeof Tooltip>
export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {}
