import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from './Button'
import { FloatingPanel } from './FloatingPanel'
import type { FloatingPanelProps, PerimeterPosition } from './FloatingPanel'
import { Icon } from './Icon'

/**
 * A small panel that stays visible above every page and rests on the window's perimeter: a recorder, a long job.
 * Drag the handle and it snaps to the nearest edge; with the keyboard, focus the handle and use the arrow keys to
 * walk it around the edge. `inset` keeps chrome clear (the shell's header and footer). It takes no focus and traps
 * nothing: it is not a dialog. The caller owns the position; it stays in memory.
 */
const meta = {
  title: 'Components/Feedback/FloatingPanel',
  component: FloatingPanel,
  tags: ['autodocs'],
  args: {
    label: 'Recording in progress',
    moveLabel: 'Move the recorder',
    moveHint: 'Arrow keys move it around the edge of the window.',
    position: { edge: 'bottom', offset: 1 },
    onPositionChange: () => undefined,
    inset: { top: 56, bottom: 40 },
    children: null,
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FloatingPanel>
export default meta

type Story = StoryObj<typeof meta>

function Movable(args: FloatingPanelProps) {
  const [position, setPosition] = useState<PerimeterPosition>(args.position)
  return (
    <div className="h-screen">
      <p className="p-4 text-sm text-soft">Drag the handle, or focus it and press the arrow keys. Edge: {position.edge}</p>
      <FloatingPanel {...args} position={position} onPositionChange={setPosition}>
        <span className="flex items-center gap-2 text-sm">
          <Icon name="mic" /> 12:04
        </span>
        <Button size="sm" iconOnly aria-label="Pause">
          <Icon name="pause" />
        </Button>
        <Button size="sm" variant="secondary">
          Stop
        </Button>
      </FloatingPanel>
    </div>
  )
}

export const Playground: Story = { render: (args) => <Movable {...args} /> }

/** Resting on the top edge, clear of a 56 px header. */
export const TopEdge: Story = { args: { position: { edge: 'top', offset: 0.5 } }, render: (args) => <Movable {...args} /> }
