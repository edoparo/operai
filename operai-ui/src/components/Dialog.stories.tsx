import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import { Dialog } from './Dialog'
import type { DialogSize } from './Dialog'
import { Icon } from './Icon'
import { ListRows, listRowClassName, listRowMetaClassName } from './ListRows'

/**
 * The modal frame every dialog is built on: backdrop, title and ×, and the
 * shared keyboard contract (`useDialogBehavior`) — focus moves in on open and
 * back to the trigger on close, Tab is trapped, Escape/backdrop/× close it
 * (never while busy), page scroll is locked, and a dialog opened over another
 * takes the keyboard until it closes. The app owns the open state: mount to
 * open, unmount to close. Prefer ConfirmDialog, FormDialog or NoticeDialog;
 * use Dialog directly only for content that is none of those.
 */
const meta = {
  title: 'Components/Dialogs/Dialog',
  component: Dialog,
  tags: ['autodocs'],
  parameters: {
    controls: { disable: true },
    docs: { story: { inline: false, iframeHeight: 520 } },
  },
} satisfies Meta<typeof Dialog>
export default meta

type Story = StoryObj

/** Opens with the story; close it and reopen from the trigger to see focus return. */
function WithTrigger({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <Button onClick={() => setOpen(true)}>{label}</Button>
      {open && children(() => setOpen(false))}
    </>
  )
}

const PEOPLE = [
  { id: 'p1', name: 'Giulia Bianchi', access: 'Can edit' },
  { id: 'p2', name: 'Marco Rossi', access: 'Can view' },
  { id: 'p3', name: 'Anna Keller', access: 'Can view' },
]

/** Content that is neither a confirmation nor a form: compose `.dialog-body` and `.dialog-footer`. */
export const CustomContent: Story = {
  name: 'Custom content',
  render: () => (
    <WithTrigger label="Show item summary">
      {(close) => (
        <Dialog title="Oak desk lamp" description="CAT-0104 · Lighting" onClose={close} closeLabel="Close">
          <div className="dialog-body flex flex-col gap-2 text-sm">
            <p>Available from 15.11.2026, priced at EUR 89.00.</p>
            <p className="text-soft">Four changes since 30.09.2026; the last by Giulia Bianchi.</p>
          </div>
          <div className="dialog-footer">
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
          </div>
        </Dialog>
      )}
    </WithTrigger>
  ),
}

function SizesDemo() {
  const [size, setSize] = useState<DialogSize | null>(null)
  return (
    <div className="flex gap-2">
      {(['sm', 'md', 'lg'] as const).map((option) => (
        <Button key={option} onClick={() => setSize(option)}>
          Open {option}
        </Button>
      ))}
      {size && (
        <Dialog title={`A ${size} dialog`} size={size} onClose={() => setSize(null)} closeLabel="Close">
          <div className="dialog-body text-sm">
            sm for a confirmation or a notice, md (the default) for a short form, lg for a table or a longer form.
          </div>
          <div className="dialog-footer">
            <Button variant="ghost" onClick={() => setSize(null)}>
              Close
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export const Sizes: Story = { render: () => <SizesDemo /> }

function StackedDemo() {
  const [open, setOpen] = useState(true)
  const [people, setPeople] = useState(PEOPLE)
  const [removing, setRemoving] = useState<(typeof PEOPLE)[number] | null>(null)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Manage people</Button>
      {open && (
        <Dialog title="People with access" size="lg" onClose={() => setOpen(false)} closeLabel="Close">
          <div className="dialog-body">
            <ListRows label="People with access">
              {people.map((person) => (
                <div key={person.id} className={listRowClassName}>
                  <span className="flex flex-col">
                    <span className="text-sm">{person.name}</span>
                    <span className={listRowMetaClassName}>{person.access}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="danger"
                    iconOnly
                    aria-label={`Remove ${person.name}`}
                    onClick={() => setRemoving(person)}
                  >
                    <Icon name="trash" />
                  </Button>
                </div>
              ))}
            </ListRows>
          </div>
          <div className="dialog-footer">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </Dialog>
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          confirmLabel="Remove"
          busyLabel="Removing…"
          cancelLabel="Cancel"
          closeLabel="Close"
          busy={false}
          error={null}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            setPeople(people.filter((person) => person.id !== removing.id))
            setRemoving(null)
          }}
        >
          They lose access to this item at once.
        </ConfirmDialog>
      )}
    </>
  )
}

/**
 * A ConfirmDialog over a Dialog. The top one takes the keyboard: Escape and
 * Tab act on it only, then on the one underneath once it closes.
 */
export const Stacked: Story = {
  name: 'Stacked (confirm over a dialog)',
  render: () => <StackedDemo />,
}

/** Mostly text, no field to land on: `initialFocus="title"` focuses the heading. */
export const FocusOnTitle: Story = {
  name: 'Focus on the title',
  render: () => (
    <WithTrigger label="What changes on 01.12.2026?">
      {(close) => (
        <Dialog title="What changes on 01.12.2026" initialFocus="title" onClose={close} closeLabel="Close">
          <div className="dialog-body flex flex-col gap-2 text-sm">
            <p>Prices of the lighting range are updated to the new supplier list.</p>
            <p>Items on order keep the price they were ordered at.</p>
            <p className="text-soft">Nothing to do on your side.</p>
          </div>
          <div className="dialog-footer">
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
          </div>
        </Dialog>
      )}
    </WithTrigger>
  ),
}

/** While busy the dialog cannot be dismissed: × is disabled, Escape and the backdrop do nothing. */
export const Busy: Story = {
  render: () => (
    <Dialog title="Exporting the catalogue" busy onClose={() => undefined} closeLabel="Close">
      <div className="dialog-body text-sm">Preparing the file. This takes a few seconds.</div>
      <div className="dialog-footer">
        <Button variant="primary" busy disabled>
          Exporting…
        </Button>
      </div>
    </Dialog>
  ),
}
