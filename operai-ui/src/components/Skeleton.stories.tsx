import type { Meta, StoryObj } from '@storybook/react-vite'
import { Skeleton, SkeletonRows } from './Skeleton'
import { VisuallyHidden } from './VisuallyHidden'

/**
 * Placeholders while a page loads. `SkeletonRows` is the loading shape of a
 * list page (title, meta line, trailing actions); `Skeleton` is one bar for
 * any other shape. Both are `aria-hidden`: pair the loading view with a
 * polite `<VisuallyHidden live>` line ("Loading items…"). The pulse stops
 * under reduced motion.
 */
const meta = {
  title: 'Components/Feedback/Skeleton',
  component: SkeletonRows,
  tags: ['autodocs'],
  args: { rows: 3, actions: 2 },
  argTypes: {
    rows: { control: { type: 'number', min: 1, max: 10 } },
    actions: { control: { type: 'number', min: 0, max: 4 } },
  },
} satisfies Meta<typeof SkeletonRows>
export default meta

type Story = StoryObj<typeof meta>

/** SkeletonRows: change rows and actions in Controls. */
export const Rows: Story = {
  name: 'SkeletonRows',
  render: (args) => (
    <div className="max-w-3xl">
      <VisuallyHidden live>Loading items…</VisuallyHidden>
      <SkeletonRows {...args} />
    </div>
  ),
}

/** Single bars, sized for the shape they stand in for (a card of facts here). */
export const Bars: Story = {
  name: 'Skeleton bars',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="card max-w-md">
      <VisuallyHidden live>Loading item details…</VisuallyHidden>
      <Skeleton width="40%" height={16} />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton width="60%" height={10} />
        <Skeleton width="60%" height={10} />
        <Skeleton width="80%" height={14} />
        <Skeleton width="70%" height={14} />
      </div>
    </div>
  ),
}
