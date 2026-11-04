import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './Button'
import { DataTable } from './DataTable'
import type { DataTableColumn, DataTableSort } from './DataTable'
import { StatePanel } from './StatePanel'
import { formatDate, formatMoney } from '../lib/format'
import { ITEMS, OWNERS } from '../pages/fixtures'
import type { Item } from '../pages/fixtures'
import { ItemStatusBadge } from '../pages/catalogue'

/**
 * The one table primitive, for rows with comparable columns: an sr-only
 * caption, `scope` on every header, the row's name as `rowHeader`, `numeric`
 * columns right-aligned in DM Mono with tabular figures, and a
 * keyboard-scrollable region when wider than the viewport. It never formats,
 * sorts or paginates; the cell text carries its own currency. Empty and
 * loading states are the page's: render a StatePanel or SkeletonRows instead
 * of an empty table.
 */
const meta = {
  title: 'Components/Data/DataTable',
  component: DataTable,
  tags: ['autodocs'],
  parameters: { controls: { disable: true } },
} satisfies Meta<typeof DataTable>
export default meta

type Story = StoryObj

const rows = ITEMS.slice(0, 6)

const status = (item: Item) => <ItemStatusBadge status={item.status} />

const basicColumns: DataTableColumn<Item>[] = [
  { id: 'name', header: 'Name', rowHeader: true, render: (item) => item.name },
  { id: 'category', header: 'Category', render: (item) => item.category },
  { id: 'status', header: 'Status', render: status },
  { id: 'price', header: 'Price', numeric: true, render: (item) => formatMoney(item.priceCents, item.currency, 'en') },
  { id: 'updated', header: 'Updated', numeric: true, render: (item) => formatDate(item.updated) },
]

/** Numeric columns (price, date) are right-aligned figures; the name is the row header. */
export const Default: Story = {
  render: () => (
    <DataTable caption="Catalogue items" columns={basicColumns} rows={rows} getRowKey={(item) => item.id} />
  ),
}

/** The row header holds the record's link; `interactiveRows` tints the row on hover. */
export const InteractiveRows: Story = {
  name: 'Interactive rows',
  render: () => (
    <DataTable
      caption="Catalogue items"
      interactiveRows
      rows={rows}
      getRowKey={(item) => item.id}
      columns={[
        {
          id: 'name',
          header: 'Name',
          rowHeader: true,
          render: (item) => (
            <a href={`#${item.id}`} className="link">
              {item.name}
            </a>
          ),
        },
        ...basicColumns.slice(1),
      ]}
    />
  ),
}

/** Wider than the viewport: the table scrolls inside a focusable region (Tab to it, then ←/→). */
export const WideTable: Story = {
  name: 'Wide table (scrolls)',
  render: () => (
    <div className="max-w-xl">
      <DataTable
        caption="Catalogue items, all columns"
        rows={rows}
        getRowKey={(item) => item.id}
        columns={[
          {
            id: 'code',
            header: 'Code',
            rowHeader: true,
            render: (item) => <span className="font-mono">{item.code}</span>,
          },
          { id: 'name', header: 'Name', render: (item) => item.name },
          { id: 'category', header: 'Category', render: (item) => item.category },
          { id: 'owner', header: 'Owner', render: (item) => item.owner },
          { id: 'status', header: 'Status', render: status },
          { id: 'currency', header: 'Currency', render: (item) => item.currency },
          {
            id: 'price',
            header: 'Price',
            numeric: true,
            render: (item) => formatMoney(item.priceCents, item.currency, 'en'),
          },
          { id: 'from', header: 'Available from', numeric: true, render: (item) => formatDate(item.availableFrom) },
          { id: 'updated', header: 'Updated', numeric: true, render: (item) => formatDate(item.updated) },
          { id: 'description', header: 'Description', render: (item) => item.description },
        ]}
      />
    </div>
  ),
}

/** No rows: the page renders a StatePanel in place of the table, never an empty table. */
export const Empty: Story = {
  name: 'Empty → StatePanel',
  render: () => {
    const items: Item[] = []
    return items.length === 0 ? (
      <StatePanel title="No items match these filters">Clear the search or choose another category.</StatePanel>
    ) : (
      <DataTable caption="Catalogue items" columns={basicColumns} rows={items} getRowKey={(item) => item.id} />
    )
  },
}

function FocusRowDemo() {
  const [items, setItems] = useState(rows.slice(0, 3))
  const [focusKey, setFocusKey] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        size="sm"
        onClick={() => {
          const next = ITEMS[items.length]
          if (!next) return
          setItems([...items, { ...next, owner: OWNERS[items.length % OWNERS.length] }])
          setFocusKey(next.id)
        }}
      >
        Add a row
      </Button>
      <DataTable
        caption="Catalogue items"
        columns={basicColumns}
        rows={items}
        getRowKey={(item) => item.id}
        focusRowKey={focusKey}
      />
      <p className="text-xs text-soft">`focusRowKey` moves focus to the new row&apos;s header cell.</p>
    </div>
  )
}

export const FocusTheNewRow: Story = {
  name: 'Focus the row just added',
  render: () => <FocusRowDemo />,
}

function SortableDemo() {
  const [sort, setSort] = useState<DataTableSort>({ columnId: 'name', direction: 'asc' })
  const key: Record<string, (item: Item) => string | number> = {
    name: (item) => item.name,
    category: (item) => item.category,
    price: (item) => item.priceCents,
    updated: (item) => item.updated,
  }
  const pick = key[sort.columnId]!
  const sorted = [...rows].sort((a, b) => {
    const order = pick(a) < pick(b) ? -1 : pick(a) > pick(b) ? 1 : 0
    return sort.direction === 'asc' ? order : -order
  })
  const columns = basicColumns.map((column) =>
    column.id === 'status'
      ? column
      : { ...column, sortable: true, ...(column.numeric ? { firstSortDirection: 'desc' as const } : {}) },
  )
  return <DataTable caption="Catalogue items" columns={columns} rows={sorted} getRowKey={(item) => item.id} sort={sort} onSortChange={setSort} />
}

/**
 * `sortable` columns get a header button; the th carries `aria-sort`. The table
 * never sorts: the page does (here in memory, in an app usually the server, so
 * the order covers every page). Numbers and dates start descending.
 */
export const Sortable: Story = {
  name: 'Sortable columns',
  render: () => <SortableDemo />,
}

