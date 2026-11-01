import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Banner } from './Banner'
import { Button } from './Button'
import { Icon } from './Icon'
import { ListRows, listRowClassName, listRowMetaClassName } from './ListRows'
import { formatDate } from '../lib/format'
import { ITEMS } from '../pages/fixtures'
import { ItemStatusBadge, itemPrice } from '../pages/catalogue'

/**
 * A card-style list where each row opens one record: a status, one or two
 * meta lines, a figure. Each row is a whole-row link (`listRowClassName`).
 * A row that holds its own link plus actions (open + delete) is a
 * `div.list-row.is-interactive` instead. More than about three comparable
 * columns → `DataTable`.
 */
const meta = {
  title: 'Components/Data/ListRows',
  component: ListRows,
  tags: ['autodocs'],
  args: { label: 'Items', children: null },
  argTypes: { children: { control: false } },
} satisfies Meta<typeof ListRows>
export default meta

type Story = StoryObj<typeof meta>

const items = ITEMS.slice(0, 5)

/** Whole-row links: the row is the link, its name the link text. */
export const LinkRows: Story = {
  name: 'Link rows',
  render: (args) => (
    <ListRows label={args.label}>
      {items.map((item) => (
        <a key={item.id} href={`#${item.id}`} className={listRowClassName}>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">{item.name}</span>
              <ItemStatusBadge status={item.status} />
            </span>
            <span className={listRowMetaClassName}>
              {item.category} · Updated {formatDate(item.updated)}
            </span>
          </span>
          <span className="font-mono text-sm">{itemPrice(item)}</span>
        </a>
      ))}
    </ListRows>
  ),
}

function WithActionsDemo({ label }: { label?: string }) {
  const [rows, setRows] = useState(items)
  const [removed, setRemoved] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-3">
      {removed && (
        <Banner tone="success" compact onDismiss={() => setRemoved(null)} dismissLabel="Dismiss" autoDismiss>
          “{removed}” removed.
        </Banner>
      )}
      <ListRows label={label}>
        {rows.map((item) => (
          <div key={item.id} className={`${listRowClassName} is-interactive`}>
            <span className="flex min-w-0 flex-col gap-1">
              <a href={`#${item.id}`} className="link text-sm">
                {item.name}
              </a>
              <span className={listRowMetaClassName}>
                {item.code} · {item.owner}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <ItemStatusBadge status={item.status} />
              <Button
                size="sm"
                variant="danger"
                iconOnly
                aria-label={`Remove ${item.name}`}
                onClick={() => {
                  setRows(rows.filter((row) => row.id !== item.id))
                  setRemoved(item.name)
                }}
              >
                <Icon name="trash" />
              </Button>
            </span>
          </div>
        ))}
      </ListRows>
      {rows.length < items.length && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setRows(items)}>
            Restore the rows
          </Button>
        </div>
      )}
    </div>
  )
}

/** Rows with an open link and a delete button: `list-row is-interactive`, the hover on the row. */
export const RowsWithActions: Story = {
  name: 'Rows with an open link and actions',
  render: (args) => <WithActionsDemo label={args.label} />,
}
