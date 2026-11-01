/**
 * The fictional "Catalogue" tool the Pages stories are built from: its copy,
 * its status mapping, its frame (ToolLayout + TabNav) and a few pieces several
 * pages share. In an app these live in the app (strings.ts, one status badge
 * component per domain, the router's root layout); nothing here is exported
 * from the library.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { DataTable } from '../components/DataTable'
import { Icon } from '../components/Icon'
import type { DataTableColumn } from '../components/DataTable'
import { StatusBadge } from '../components/StatusBadge'
import type { StatusMeaning } from '../components/StatusBadge'
import { TabNav, tabLinkClassName } from '../components/TabNav'
import { ToolLayout } from '../components/ToolLayout'
import { formatDate, formatMoney } from '../lib/format'
import type { PaginationStatus } from '../components/Pagination'
import type { Item, ItemStatus } from './fixtures'

/** The tool's copy — an app's strings.ts. */
export const t = {
  tool: 'Catalogue',
  sections: {
    label: 'Catalogue sections',
    items: 'Items',
    collections: 'Collections',
    suppliers: 'Suppliers',
    settings: 'Settings',
  },
  list: {
    heading: 'Items',
    description: 'Everything the catalogue offers, newest change first.',
    newItem: 'New item',
    caption: 'Catalogue items',
    loading: 'Loading items…',
    loadError: 'The items could not be loaded. Check your connection and try again.',
    loadErrorTitle: 'Items unavailable',
    retry: 'Retry',
    emptyTitle: 'No items match these filters',
    emptyBody: 'Clear the search or choose another category.',
    firstRunTitle: 'No items yet',
    firstRunBody: 'Items you add appear here, with their status and price.',
    firstRunAction: 'Add the first item',
    forbiddenTitle: 'You do not have access to this catalogue',
    forbiddenBody: 'Ask the catalogue owner to give you access, then reload the page.',
    pagesLabel: 'Item pages',
    previous: 'Previous',
    next: 'Next',
    pageStatus: ({ page, totalPages, rangeStart, rangeEnd, total }: PaginationStatus) =>
      `Page ${page} of ${totalPages} — showing ${rangeStart}–${rangeEnd} of ${total}`,
    loadMore: 'Load more items',
    loadingMore: 'Loading more…',
    loadedMore: (count: number) => `${count} more items loaded`,
    loadMoreError: 'The next items could not be loaded. Try again.',
    updated: (date: string) => `Updated ${date}`,
  },
  filters: {
    title: 'Filters',
    search: 'Search',
    searchHint: 'Name or code',
    category: 'Category',
    status: 'Status',
    any: 'Any',
    clear: 'Clear filters',
  },
  columns: {
    name: 'Name',
    code: 'Code',
    category: 'Category',
    owner: 'Owner',
    status: 'Status',
    price: 'Price',
    updated: 'Updated',
  },
  detail: {
    back: 'Back to items',
    edit: 'Edit',
    delete: 'Delete',
    viewsLabel: 'Item views',
    overview: 'Overview',
    history: 'History',
    details: 'Details',
    notes: 'Notes',
    addNote: 'Add note',
    historyCaption: 'Changes to this item',
    when: 'When',
    who: 'Who',
    what: 'What',
    notFoundTitle: 'This item does not exist',
    notFoundBody: 'It may have been deleted, or the link is wrong.',
  },
  delete: {
    title: (name: string) => `Delete “${name}”?`,
    body: 'The item and its history are deleted for everyone. This cannot be undone.',
    confirm: 'Delete item',
    busy: 'Deleting…',
    cancel: 'Cancel',
    close: 'Close',
    error: 'The item could not be deleted: the server did not answer. Try again.',
    done: (name: string) => `“${name}” deleted.`,
    dismiss: 'Dismiss',
    rowAction: (name: string) => `Delete ${name}`,
  },
  form: {
    createTitle: 'New item',
    editTitle: 'Edit item',
    general: 'General',
    pricing: 'Price and availability',
    visibility: 'Visibility',
    name: 'Name',
    nameHint: 'As customers will see it.',
    nameRequired: 'Enter a name.',
    nameTooLong: 'Use at most 60 characters.',
    category: 'Category',
    categoryRequired: 'Choose a category.',
    choose: 'Choose…',
    description: 'Description',
    price: 'Price',
    priceHint: 'In euros, e.g. 45.50 or 45,50.',
    priceRequired: 'Enter a price.',
    priceInvalid: 'Enter an amount with at most two decimals.',
    availableFrom: 'Available from',
    availableRequired: 'Choose a date.',
    visibilityLabel: 'Who can see it',
    visibilityPublic: 'Everyone',
    visibilityTeam: 'Only my team',
    visibilityRequired: 'Choose who can see it.',
    save: 'Save item',
    saving: 'Saving…',
    cancel: 'Cancel',
    saved: 'Item saved.',
    fixErrors: 'Some fields need attention.',
  },
  quick: {
    title: 'New item',
    description: 'Add the essentials now; everything else can be edited later.',
    submit: 'Create item',
    busy: 'Creating…',
    created: (name: string) => `“${name}” created.`,
    error: 'The item could not be created: the server is unavailable. Your input is kept; try again.',
  },
  settings: {
    heading: 'Settings',
    description: 'Preferences for your view of the catalogue.',
    displayName: 'Display name',
    displayNameHint: 'Shown next to the changes you make.',
    displayNameRequired: 'Enter a display name.',
    currency: 'Default currency',
    pageSize: 'Items per page',
    weeklySummary: 'Send me a weekly summary',
    alerts: 'Tell me when',
    alertOptions: [
      { id: 'low-stock', label: 'an item falls under its reorder level' },
      { id: 'arrived', label: 'an order arrives' },
      { id: 'retired', label: 'an item is retired' },
    ],
    save: 'Save settings',
    saving: 'Saving…',
    saved: 'Settings saved.',
  },
} as const

/** The tool's ONE mapping from its own statuses to the suite's status dictionary. */
export const ITEM_STATUS: Record<ItemStatus, { meaning: StatusMeaning; label: string }> = {
  draft: { meaning: 'draft', label: 'Draft' },
  available: { meaning: 'active', label: 'Available' },
  'on-order': { meaning: 'pending', label: 'On order' },
  'needs-review': { meaning: 'attention', label: 'Needs review' },
  archived: { meaning: 'voided', label: 'Archived' },
}

export function ItemStatusBadge({ status }: { status: ItemStatus }) {
  return <StatusBadge status={ITEM_STATUS[status].meaning}>{ITEM_STATUS[status].label}</StatusBadge>
}

export const itemPrice = (item: Item) => formatMoney(item.priceCents, item.currency, 'en')

export type Section = 'items' | 'collections' | 'suppliers' | 'settings'

/**
 * The tool's root layout: ToolLayout + TabNav. In an app the tabs are router
 * <Link>s (active = aria-current="page"); here they are anchors that switch a
 * piece of state.
 */
export function CatalogueFrame({
  active,
  onNavigate,
  width,
  children,
}: {
  active: Section
  onNavigate?: (section: Section) => void
  width?: 'narrow' | 'default' | 'wide'
  children: ReactNode
}) {
  const tab = (id: Section, label: string) => (
    <a
      href={`#${id}`}
      className={tabLinkClassName}
      aria-current={active === id ? 'page' : undefined}
      onClick={(event) => {
        event.preventDefault()
        onNavigate?.(id)
      }}
    >
      {label}
    </a>
  )
  return (
    <ToolLayout
      title={t.tool}
      width={width}
      nav={
        <TabNav label={t.sections.label} end={tab('settings', t.sections.settings)}>
          {tab('items', t.sections.items)}
          {tab('collections', t.sections.collections)}
          {tab('suppliers', t.sections.suppliers)}
        </TabNav>
      }
    >
      {children}
    </ToolLayout>
  )
}

/** A back link: an accent text link, the arrow hidden from screen readers. */
export function BackLink({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  return (
    <a
      href="#back"
      className="link"
      onClick={(event: MouseEvent) => {
        event.preventDefault()
        onClick?.()
      }}
    >
      <Icon name="arrow-left" /> {children}
    </a>
  )
}

/**
 * Runs `fn` after `ms` — a simulated request. Pending timers are cleared when
 * the story unmounts, so nothing updates an unmounted page.
 */
export function useLatency() {
  const timers = useRef<number[]>([])
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((id) => window.clearTimeout(id))
  }, [])
  return useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])
}

/** The items table: the name is the row header and opens the record. */
export function ItemsTable({
  items,
  onOpen,
  focusRowKey,
  extraColumns = [],
}: {
  items: readonly Item[]
  onOpen?: (item: Item) => void
  focusRowKey?: string | null
  extraColumns?: DataTableColumn<Item>[]
}) {
  const columns: DataTableColumn<Item>[] = [
    {
      id: 'name',
      header: t.columns.name,
      rowHeader: true,
      render: (item) => (
        <a
          href={`#${item.id}`}
          className="link"
          onClick={(event) => {
            event.preventDefault()
            onOpen?.(item)
          }}
        >
          {item.name}
        </a>
      ),
    },
    { id: 'code', header: t.columns.code, render: (item) => <span className="font-mono">{item.code}</span> },
    { id: 'category', header: t.columns.category, render: (item) => item.category },
    { id: 'status', header: t.columns.status, render: (item) => <ItemStatusBadge status={item.status} /> },
    { id: 'price', header: t.columns.price, numeric: true, render: itemPrice },
    { id: 'updated', header: t.columns.updated, numeric: true, render: (item) => formatDate(item.updated) },
    ...extraColumns,
  ]
  return (
    <DataTable
      caption={t.list.caption}
      columns={columns}
      rows={items}
      getRowKey={(item) => item.id}
      interactiveRows
      focusRowKey={focusRowKey}
    />
  )
}
