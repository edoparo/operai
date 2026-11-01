import { useId, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { StatePanel } from '../components/StatePanel'
import { CatalogueFrame, ItemsTable, t, useLatency } from './catalogue'
import { ITEMS } from './fixtures'
import type { Item } from './fixtures'

/**
 * Deleting from a list: each row has a delete button (`danger`, icon-only,
 * named after its item). It opens a `ConfirmDialog` — focus on Cancel, the
 * safe default. Confirm makes it busy for 1.2s (not dismissible). On success
 * the row disappears, focus moves to the page heading and a compact success
 * `Banner` confirms where the person acted. On failure the error appears
 * inside the dialog, which stays open so they can retry or cancel.
 */
type Args = { outcome: 'success' | 'failure' }

const meta: Meta<Args> = {
  title: 'Pages/Deletion flow',
  parameters: { frame: 'page' },
  args: { outcome: 'success' },
  argTypes: { outcome: { control: 'inline-radio', options: ['success', 'failure'] } },
}
export default meta

type Story = StoryObj<Args>

function DeletionPage({ outcome }: Args) {
  const titleId = useId()
  const later = useLatency()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [items, setItems] = useState<Item[]>(ITEMS.slice(0, 6))
  const [target, setTarget] = useState<Item | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const confirm = () => {
    if (!target) return
    setBusy(true)
    setError(null)
    later(1200, () => {
      setBusy(false)
      if (outcome === 'failure') {
        setError(t.delete.error)
        return
      }
      setItems((current) => current.filter((item) => item.id !== target.id))
      setDone(t.delete.done(target.name))
      setTarget(null)
      // After the dialog has returned focus (its trigger is gone), land on the heading.
      window.requestAnimationFrame(() => headingRef.current?.focus())
    })
  }

  return (
    <CatalogueFrame active="items">
      <section aria-labelledby={titleId}>
        <PageHeader
          title={t.list.heading}
          titleId={titleId}
          headingRef={headingRef}
          focusableHeading
          description="Delete an item with the button at the end of its row."
        />
        <div className="flex flex-col gap-4">
          {done && (
            <Banner
              tone="success"
              compact
              autoDismiss
              onDismiss={() => setDone(null)}
              dismissLabel={t.delete.dismiss}
            >
              {done}
            </Banner>
          )}
          {items.length === 0 ? (
            <StatePanel title={t.list.firstRunTitle}>{t.list.firstRunBody}</StatePanel>
          ) : (
            <ItemsTable
              items={items}
              extraColumns={[
                {
                  id: 'actions',
                  header: <span className="visually-hidden">Actions</span>,
                  render: (item) => (
                    <Button
                      size="sm"
                      variant="danger"
                      iconOnly
                      aria-label={t.delete.rowAction(item.name)}
                      onClick={() => {
                        setError(null)
                        setTarget(item)
                      }}
                    >
                      <Icon name="trash" />
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </div>
      </section>
      {target && (
        <ConfirmDialog
          title={t.delete.title(target.name)}
          confirmLabel={t.delete.confirm}
          busyLabel={t.delete.busy}
          cancelLabel={t.delete.cancel}
          closeLabel={t.delete.close}
          busy={busy}
          error={error}
          onCancel={() => setTarget(null)}
          onConfirm={confirm}
        >
          {t.delete.body}
        </ConfirmDialog>
      )}
    </CatalogueFrame>
  )
}

export const Succeeds: Story = {
  render: (args) => <DeletionPage key={args.outcome} {...args} />,
}

export const Fails: Story = {
  args: { outcome: 'failure' },
  render: (args) => <DeletionPage key={args.outcome} {...args} />,
}
