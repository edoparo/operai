import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './Button'
import { VisuallyHidden } from './VisuallyHidden'

/**
 * Text for assistive technology only. With `live`, changes are announced
 * politely: the loading line of a list, "3 items selected", a change that is
 * visible but not focused. Errors that must interrupt use `role="alert"`
 * instead.
 */
const meta = {
  title: 'Components/Feedback/VisuallyHidden',
  component: VisuallyHidden,
  tags: ['autodocs'],
  args: { children: 'Loading items…', live: true },
  argTypes: { children: { control: 'text' } },
} satisfies Meta<typeof VisuallyHidden>
export default meta

type Story = StoryObj<typeof meta>

/** Nothing visible: inspect the canvas or use a screen reader. */
export const Playground: Story = {
  render: (args) => (
    <div className="flex flex-col gap-2">
      <VisuallyHidden {...args} />
      <p className="text-sm text-soft">
        A visually hidden span is rendered here with the text “{String(args.children)}”.
      </p>
    </div>
  ),
}

/** Extra context for a control whose visible text is short. */
export const ExtraContext: Story = {
  name: 'Extra context for a control',
  parameters: { controls: { disable: true } },
  render: () => (
    <Button size="sm">
      Edit<VisuallyHidden> Oak desk lamp</VisuallyHidden>
    </Button>
  ),
}

function LiveDemo() {
  const [selected, setSelected] = useState(0)
  const message = selected === 0 ? '' : `${selected} ${selected === 1 ? 'item' : 'items'} selected`
  return (
    <div className="flex flex-col items-start gap-3">
      <Button size="sm" onClick={() => setSelected(selected + 1)}>
        Select one more
      </Button>
      <VisuallyHidden live>{message}</VisuallyHidden>
      <p className="text-xs text-soft">
        Announced politely: <span className="font-mono text-text">{message || '(nothing yet)'}</span>
      </p>
    </div>
  )
}

/** `live`: each change is read out without moving focus. */
export const LiveAnnouncement: Story = {
  name: 'Live announcement',
  parameters: { controls: { disable: true } },
  render: () => <LiveDemo />,
}
