import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { Button } from './Button'
import { NoticeDialog } from './NoticeDialog'

/**
 * An `alertdialog` with one acknowledgement and nothing to decide: a guardrail
 * ("this item is locked"), a conflict that needs a reload. No ×, no Cancel;
 * the one button has focus, and every way out (the button, Escape, the
 * backdrop) acknowledges. Replaces `window.alert()`.
 */
const meta = {
  title: 'Components/Dialogs/NoticeDialog',
  component: NoticeDialog,
  tags: ['autodocs'],
  parameters: { docs: { story: { inline: false, iframeHeight: 360 } } },
  args: {
    title: 'This item is locked',
    children: 'Someone is editing it right now. Try again in a few minutes.',
    acknowledgeLabel: 'OK',
    onAcknowledge: fn(),
  },
  argTypes: { title: { control: 'text' }, children: { control: 'text' } },
} satisfies Meta<typeof NoticeDialog>
export default meta

type Story = StoryObj<typeof meta>

function WithTrigger(props: Parameters<typeof NoticeDialog>[0]) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Edit item</Button>
      {open && (
        <NoticeDialog
          {...props}
          onAcknowledge={() => {
            props.onAcknowledge()
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

export const Default: Story = {
  render: (args) => <WithTrigger {...args} />,
}

/** A conflict that needs a reload: the acknowledgement says what happens next. */
export const Conflict: Story = {
  args: {
    title: 'This item changed',
    children:
      'Someone else saved a newer version while you were editing. Reload to see it; your changes are not saved.',
    acknowledgeLabel: 'Reload item',
  },
  render: (args) => <WithTrigger {...args} />,
}
