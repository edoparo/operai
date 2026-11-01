import { useId, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { buttonClassName } from '../components/Button'
import { Card } from '../components/Card'
import { DataTable } from '../components/DataTable'
import { FactList } from '../components/FactList'
import { ListRows, listRowClassName, listRowMetaClassName } from '../components/ListRows'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { formatDate } from '../lib/format'
import { CatalogueFrame, ItemsTable, t } from './catalogue'
import type { Section } from './catalogue'
import { ITEMS } from './fixtures'

/**
 * A tool's frame: `ToolLayout` (the tool title is the page's h1) with a
 * `TabNav` of sections. Each section is its own page with its own URL; here
 * the tabs switch a piece of state, in an app they are router links whose
 * active one carries `aria-current="page"`. Settings is pinned to the far end
 * with the `end` slot. Every page starts with its `PageHeader` (h2).
 */
const meta = {
  title: 'Pages/Tool navigation',
  component: CatalogueFrame,
  parameters: { frame: 'page', controls: { disable: true } },
} satisfies Meta<typeof CatalogueFrame>
export default meta

type Story = StoryObj

const COLLECTIONS = [
  { id: 'c1', name: 'Autumn living room', items: 12, updated: '2026-10-29', live: true },
  { id: 'c2', name: 'Home office', items: 8, updated: '2026-10-12', live: true },
  { id: 'c3', name: 'Winter kitchen', items: 5, updated: '2026-09-30', live: false },
]

const SUPPLIERS = [
  { id: 's1', name: 'Northwind Workshop', country: 'Italy', items: 9 },
  { id: 's2', name: 'Alpine Linen Co.', country: 'Switzerland', items: 6 },
  { id: 's3', name: 'Lumen & Brass', country: 'Italy', items: 5 },
  { id: 's4', name: 'Paper Mill Seven', country: 'Switzerland', items: 3 },
]

function SectionPage({ section }: { section: Section }) {
  const titleId = useId()
  if (section === 'items') {
    return (
      <section aria-labelledby={titleId}>
        <PageHeader
          title={t.list.heading}
          titleId={titleId}
          description={t.list.description}
          actions={
            <a href="#new" className={buttonClassName({ variant: 'primary' })}>
              {t.list.newItem}
            </a>
          }
        />
        <ItemsTable items={ITEMS.slice(0, 6)} />
      </section>
    )
  }
  if (section === 'collections') {
    return (
      <section aria-labelledby={titleId}>
        <PageHeader
          title={t.sections.collections}
          titleId={titleId}
          description="Groups of items shown together."
          actions={
            <a href="#new-collection" className={buttonClassName({ variant: 'primary' })}>
              New collection
            </a>
          }
        />
        <ListRows label="Collections">
          {COLLECTIONS.map((collection) => (
            <a key={collection.id} href={`#${collection.id}`} className={listRowClassName}>
              <span className="flex flex-col gap-1">
                <span className="flex items-center gap-3">
                  <span className="text-sm font-medium">{collection.name}</span>
                  {collection.live ? (
                    <StatusBadge status="active">Published</StatusBadge>
                  ) : (
                    <StatusBadge status="draft">Draft</StatusBadge>
                  )}
                </span>
                <span className={listRowMetaClassName}>Updated {formatDate(collection.updated)}</span>
              </span>
              <span className="font-mono text-sm">{collection.items} items</span>
            </a>
          ))}
        </ListRows>
      </section>
    )
  }
  if (section === 'suppliers') {
    return (
      <section aria-labelledby={titleId}>
        <PageHeader title={t.sections.suppliers} titleId={titleId} description="Who makes the items." />
        <DataTable
          caption="Suppliers"
          rows={SUPPLIERS}
          getRowKey={(supplier) => supplier.id}
          columns={[
            { id: 'name', header: 'Name', rowHeader: true, render: (supplier) => supplier.name },
            { id: 'country', header: 'Country', render: (supplier) => supplier.country },
            { id: 'items', header: 'Items', numeric: true, render: (supplier) => supplier.items },
          ]}
        />
      </section>
    )
  }
  return (
    <section aria-labelledby={titleId}>
      <PageHeader title={t.settings.heading} titleId={titleId} description={t.settings.description} />
      <Card title="Your preferences">
        <FactList
          items={[
            { id: 'currency', term: t.settings.currency, value: 'EUR' },
            { id: 'size', term: t.settings.pageSize, value: '25' },
          ]}
        />
      </Card>
    </section>
  )
}

function ToolNavigationDemo({ initial }: { initial: Section }) {
  const [section, setSection] = useState<Section>(initial)
  return (
    <CatalogueFrame active={section} onNavigate={setSection}>
      <SectionPage section={section} />
    </CatalogueFrame>
  )
}

/** Click the tabs (or Tab to them and press Enter): the active tab and the page change together. */
export const Sections: Story = {
  render: () => <ToolNavigationDemo initial="items" />,
}

/** The `end` tab, active. */
export const EndTabActive: Story = {
  name: 'End tab active',
  render: () => <ToolNavigationDemo initial="settings" />,
}
