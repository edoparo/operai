import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './Button'
import { Drawer } from './Drawer'
import { Icon } from './Icon'

/**
 * A modal panel from the right edge, for reference content read next to the
 * page: help, a glossary, how a figure is computed. Same keyboard contract as
 * Dialog (focus to the heading on open and back to the trigger on close, Tab
 * trapped, Escape/backdrop/× close, page scroll locked); its body scrolls on
 * its own. The trigger is a button with `aria-haspopup="dialog"`, not a
 * toggle: while the drawer is open nothing behind it can be pressed. Not for a
 * form or a confirmation — those are FormDialog and ConfirmDialog.
 */
const meta = {
  title: 'Components/Dialogs/Drawer',
  component: Drawer,
  tags: ['autodocs'],
  parameters: { controls: { disable: true }, docs: { story: { inline: false, iframeHeight: 560 } } },
} satisfies Meta<typeof Drawer>
export default meta

type Story = StoryObj

const TERMS = [
  ['Stock', 'Items on hand, not yet assigned to anyone.'],
  ['Reserved', 'Set aside for a request that is not confirmed yet.'],
  ['Lead time', 'Working days between an order and the item arriving.'],
  ['Reorder level', 'The stock count under which a new order is suggested.'],
  ['Retired', 'No longer offered; kept for the history of past orders.'],
]

function HelpDemo() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <Button variant="ghost" iconOnly aria-label="Catalogue help" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="help" />
      </Button>
      {open && (
        <Drawer
          title="Catalogue help"
          description="How stock is counted, and the terms used"
          closeLabel="Close"
          onClose={() => setOpen(false)}
        >
          <div className="flex flex-col gap-6">
            <section>
              <h3 className="mb-3 font-disp text-xs font-bold text-text">How stock is counted</h3>
              <p className="leading-relaxed">
                Available = on hand − reserved. An item counts as on hand from the day it is received until it is
                assigned or retired.
              </p>
            </section>
            <section>
              <h3 className="mb-3 font-disp text-xs font-bold text-text">Glossary</h3>
              <dl className="flex flex-col gap-3">
                {TERMS.map(([term, definition]) => (
                  <div key={term}>
                    <dt className="font-medium text-text">{term}</dt>
                    <dd className="leading-relaxed">{definition}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </Drawer>
      )}
    </>
  )
}

/** Opens with the story; close it (Escape, ×, backdrop) and reopen from the help button. */
export const Help: Story = {
  render: () => <HelpDemo />,
}
