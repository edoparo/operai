/**
 * A small, navigable "Catalogue" tool: list → detail → edit, with simulated
 * latency. The Item list, Item detail and Create and edit form stories each
 * start it on a different route, so every page can be reached from the
 * others the way it would be in an app (where the routes are router links).
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Banner } from '../components/Banner'
import { Button, buttonClassName } from '../components/Button'
import { Card } from '../components/Card'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DataTable } from '../components/DataTable'
import { FactList } from '../components/FactList'
import { Field, RadioGroupField, focusFirstInvalid } from '../components/Field'
import { FormDialog } from '../components/FormDialog'
import { DateInput, MoneyInput, parseDecimal } from '../components/MoneyInput'
import { PageHeader } from '../components/PageHeader'
import { Pagination } from '../components/Pagination'
import { SkeletonRows } from '../components/Skeleton'
import { StatePanel } from '../components/StatePanel'
import { Tabs, tabPanelProps } from '../components/Tabs'
import { VisuallyHidden } from '../components/VisuallyHidden'
import { formatAmount, formatDate, formatDateTime } from '../lib/format'
import { useFocusOnMount } from '../lib/useFocusOnMount'
import {
  BackLink,
  CatalogueFrame,
  ITEM_STATUS,
  ItemStatusBadge,
  ItemsTable,
  itemPrice,
  t,
  useLatency,
} from './catalogue'
import type { Section } from './catalogue'
import { CATEGORIES, HISTORY, ITEMS, NOTES } from './fixtures'
import type { Item, ItemStatus } from './fixtures'

export type ListState = 'loaded' | 'loading' | 'empty' | 'error' | 'forbidden'

export type Route = { name: 'list' } | { name: 'detail'; id: string } | { name: 'new' } | { name: 'edit'; id: string }

const LATENCY = 1200
const PAGE_SIZE = 8

// ── List ────────────────────────────────────────────────────────────────────

function ListPage({
  items,
  initialState,
  flash,
  onDismissFlash,
  onOpen,
  onNew,
}: {
  items: Item[]
  initialState: ListState
  flash: string | null
  onDismissFlash: () => void
  onOpen: (item: Item) => void
  onNew: () => void
}) {
  const titleId = useId()
  const later = useLatency()
  // Arriving with a confirmation (after a delete) puts focus on the page heading.
  const headingRef = useFocusOnMount<HTMLHeadingElement>(flash !== null)
  const [state, setState] = useState<ListState>(initialState)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (search === '' ||
            item.name.toLowerCase().includes(search.toLowerCase()) ||
            item.code.toLowerCase().includes(search.toLowerCase())) &&
          (category === '' || item.category === category) &&
          (status === '' || item.status === status),
      ),
    [items, search, category, status],
  )
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const filtering = search !== '' || category !== '' || status !== ''
  const clear = () => {
    setSearch('')
    setCategory('')
    setStatus('')
    setPage(1)
  }

  if (state === 'forbidden') {
    return (
      <StatePanel title={t.list.forbiddenTitle} role="alert" focusOnMount headingLevel={2}>
        {t.list.forbiddenBody}
      </StatePanel>
    )
  }

  const retry = () => {
    setState('loading')
    later(LATENCY, () => setState('loaded'))
  }

  const empty = state === 'empty' || items.length === 0

  return (
    <section aria-labelledby={titleId}>
      <PageHeader
        title={t.list.heading}
        titleId={titleId}
        headingRef={headingRef}
        focusableHeading
        description={t.list.description}
        actions={
          <a
            href="#new"
            className={buttonClassName({ variant: 'primary' })}
            onClick={(event) => {
              event.preventDefault()
              onNew()
            }}
          >
            {t.list.newItem}
          </a>
        }
      />
      <div className="flex flex-col gap-4">
        {flash && (
          <Banner
            tone="success"
            compact
            autoDismiss
            onDismiss={onDismissFlash}
            dismissLabel={t.delete.dismiss}
          >
            {flash}
          </Banner>
        )}
        {state === 'loading' && (
          <>
            <VisuallyHidden live>{t.list.loading}</VisuallyHidden>
            <SkeletonRows rows={5} actions={0} />
          </>
        )}
        {state === 'error' && (
          <Banner tone="warning" title={t.list.loadErrorTitle} onRetry={retry} retryLabel={t.list.retry}>
            {t.list.loadError}
          </Banner>
        )}
        {state !== 'loading' && state !== 'error' && empty && (
          <StatePanel title={t.list.firstRunTitle}>{t.list.firstRunBody}</StatePanel>
        )}
        {state === 'loaded' && !empty && (
          <>
            <Card
              title={t.filters.title}
              action={
                filtering ? (
                  <Button size="sm" variant="ghost" onClick={clear}>
                    {t.filters.clear}
                  </Button>
                ) : undefined
              }
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t.filters.search} hint={t.filters.searchHint}>
                  {(control) => (
                    <input
                      {...control}
                      type="search"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value)
                        setPage(1)
                      }}
                    />
                  )}
                </Field>
                <Field label={t.filters.category}>
                  {(control) => (
                    <select
                      {...control}
                      value={category}
                      onChange={(e) => {
                        setCategory(e.target.value)
                        setPage(1)
                      }}
                    >
                      <option value="">{t.filters.any}</option>
                      {CATEGORIES.map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label={t.filters.status}>
                  {(control) => (
                    <select
                      {...control}
                      value={status}
                      onChange={(e) => {
                        setStatus(e.target.value)
                        setPage(1)
                      }}
                    >
                      <option value="">{t.filters.any}</option>
                      {(Object.keys(ITEM_STATUS) as ItemStatus[]).map((value) => (
                        <option key={value} value={value}>
                          {ITEM_STATUS[value].label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
            </Card>
            {filtered.length === 0 ? (
              <StatePanel
                title={t.list.emptyTitle}
                action={
                  <Button variant="secondary" onClick={clear}>
                    {t.filters.clear}
                  </Button>
                }
              >
                {t.list.emptyBody}
              </StatePanel>
            ) : (
              <>
                <ItemsTable items={visible} onOpen={onOpen} />
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={filtered.length}
                  onPageChange={setPage}
                  label={t.list.pagesLabel}
                  previousLabel={t.list.previous}
                  nextLabel={t.list.next}
                  status={t.list.pageStatus}
                />
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}

// ── Detail ──────────────────────────────────────────────────────────────────

type View = 'overview' | 'history'

function DetailPage({
  item,
  flash,
  onDismissFlash,
  onBack,
  onEdit,
  onDeleted,
}: {
  item: Item | undefined
  flash: string | null
  onDismissFlash: () => void
  onBack: () => void
  onEdit: (item: Item) => void
  onDeleted: (item: Item) => void
}) {
  const titleId = useId()
  const viewsId = useId()
  const later = useLatency()
  const headingRef = useFocusOnMount<HTMLHeadingElement>()
  const [view, setView] = useState<View>('overview')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState<string[]>(NOTES)
  const [addingNote, setAddingNote] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteError, setNoteError] = useState<string | undefined>(undefined)
  const [noteAdded, setNoteAdded] = useState('')
  const back = <BackLink onClick={onBack}>{t.detail.back}</BackLink>

  if (!item) {
    return (
      <div className="flex flex-col gap-2">
        <div>{back}</div>
        <StatePanel title={t.detail.notFoundTitle} headingLevel={2} focusOnMount>
          {t.detail.notFoundBody}
        </StatePanel>
      </div>
    )
  }

  const facts = [
    { id: 'code', term: 'Code', value: <span className="font-mono">{item.code}</span> },
    { id: 'category', term: t.columns.category, value: item.category },
    { id: 'owner', term: t.columns.owner, value: item.owner },
    { id: 'price', term: t.columns.price, value: <span className="font-mono">{itemPrice(item)}</span> },
    {
      id: 'from',
      term: t.form.availableFrom,
      value: <span className="font-mono">{formatDate(item.availableFrom)}</span>,
    },
    { id: 'updated', term: t.columns.updated, value: <span className="font-mono">{formatDate(item.updated)}</span> },
  ]

  return (
    <section aria-labelledby={titleId}>
      <PageHeader
        back={back}
        title={item.name}
        titleId={titleId}
        headingRef={headingRef}
        focusableHeading
        status={<ItemStatusBadge status={item.status} />}
        description={`${item.code} · ${item.category}`}
        actions={
          <>
            <Button onClick={() => onEdit(item)}>{t.detail.edit}</Button>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              {t.detail.delete}
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-4">
        {flash && (
          <Banner
            tone="success"
            compact
            autoDismiss
            onDismiss={onDismissFlash}
            dismissLabel={t.delete.dismiss}
          >
            {flash}
          </Banner>
        )}
        <Tabs
          label={t.detail.viewsLabel}
          idPrefix={viewsId}
          value={view}
          onChange={setView}
          tabs={[
            { id: 'overview', label: t.detail.overview },
            { id: 'history', label: t.detail.history },
          ]}
        />
        <div {...tabPanelProps(viewsId, view)} className="flex flex-col gap-4">
          {view === 'overview' ? (
            <>
              <Card title={t.detail.details}>
                <FactList items={facts} />
                <p className="text-sm text-soft">{item.description}</p>
              </Card>
              <Card
                title={t.detail.notes}
                action={
                  <Button size="sm" onClick={() => setAddingNote(true)}>
                    {t.detail.addNote}
                  </Button>
                }
              >
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                  {notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                <VisuallyHidden live>{noteAdded}</VisuallyHidden>
              </Card>
            </>
          ) : (
            <Card title={t.detail.history}>
              <DataTable
                caption={t.detail.historyCaption}
                rows={HISTORY}
                getRowKey={(entry) => entry.id}
                columns={[
                  { id: 'when', header: t.detail.when, rowHeader: true, render: (entry) => formatDateTime(entry.at) },
                  { id: 'who', header: t.detail.who, render: (entry) => entry.who },
                  { id: 'what', header: t.detail.what, render: (entry) => entry.what },
                ]}
              />
            </Card>
          )}
        </div>
      </div>
      {confirming && (
        <ConfirmDialog
          title={t.delete.title(item.name)}
          confirmLabel={t.delete.confirm}
          busyLabel={t.delete.busy}
          cancelLabel={t.delete.cancel}
          closeLabel={t.delete.close}
          busy={busy}
          error={null}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setBusy(true)
            later(LATENCY, () => onDeleted(item))
          }}
        >
          {t.delete.body}
        </ConfirmDialog>
      )}
      {addingNote && (
        <FormDialog
          title={t.detail.addNote}
          submitLabel={t.detail.addNote}
          busyLabel={t.form.saving}
          cancelLabel={t.form.cancel}
          closeLabel={t.delete.close}
          busy={false}
          error={null}
          size="sm"
          onCancel={() => {
            setAddingNote(false)
            setNoteText('')
            setNoteError(undefined)
          }}
          onSubmit={() => {
            if (noteText.trim() === '') {
              setNoteError('Write the note first.')
              return
            }
            setNotes([...notes, noteText.trim()])
            setNoteAdded('Note added.')
            setNoteText('')
            setNoteError(undefined)
            setAddingNote(false)
          }}
        >
          <Field label={t.detail.notes} required error={noteError}>
            {(control) => (
              <textarea {...control} rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
            )}
          </Field>
        </FormDialog>
      )}
    </section>
  )
}

// ── Create / edit form ──────────────────────────────────────────────────────

type Draft = {
  name: string
  category: string
  description: string
  price: string
  availableFrom: string
  visibility: string
}

type FieldName = keyof Draft

const validate = (draft: Draft): Partial<Record<FieldName, string>> => ({
  name: draft.name.trim() === '' ? t.form.nameRequired : draft.name.length > 60 ? t.form.nameTooLong : undefined,
  category: draft.category === '' ? t.form.categoryRequired : undefined,
  price:
    draft.price.trim() === ''
      ? t.form.priceRequired
      : parseDecimal(draft.price) === null
        ? t.form.priceInvalid
        : undefined,
  availableFrom: draft.availableFrom === '' ? t.form.availableRequired : undefined,
  visibility: draft.visibility === '' ? t.form.visibilityRequired : undefined,
})

export type SaveOutcome = 'success' | 'failure'

function FormPage({
  item,
  saveOutcome,
  onCancel,
  onSaved,
}: {
  item?: Item
  saveOutcome: SaveOutcome
  onCancel: () => void
  onSaved: (draft: Draft) => void
}) {
  const titleId = useId()
  const radioName = useId()
  const later = useLatency()
  const formRef = useRef<HTMLFormElement>(null)
  const [draft, setDraft] = useState<Draft>(
    item
      ? {
          name: item.name,
          category: item.category,
          description: item.description,
          price: formatAmount(item.priceCents, 'en').replace(/,/g, ''),
          availableFrom: item.availableFrom,
          visibility: 'public',
        }
      : { name: '', category: '', description: '', price: '', availableFrom: '', visibility: '' },
  )
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [focusInvalid, setFocusInvalid] = useState(0)

  const errors = validate(draft)
  const shown = (name: FieldName) => (submitted || touched[name] ? errors[name] : undefined)
  const set = (name: FieldName) => (value: string) => setDraft((current) => ({ ...current, [name]: value }))
  const blur = (name: FieldName) => () => setTouched((current) => ({ ...current, [name]: true }))

  // After a failed submit the errors render first, then focus moves to the first one.
  useEffect(() => {
    if (focusInvalid > 0) focusFirstInvalid(formRef.current)
  }, [focusInvalid])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) {
      setFocusInvalid((n) => n + 1)
      return
    }
    setBusy(true)
    setRequestError(null)
    later(LATENCY, () => {
      setBusy(false)
      if (saveOutcome === 'failure') {
        setRequestError('The item could not be saved: the server is unavailable. Your changes are kept; try again.')
        return
      }
      onSaved(draft)
    })
  }

  return (
    <section aria-labelledby={titleId}>
      <PageHeader
        back={<BackLink onClick={onCancel}>{item ? `Back to ${item.name}` : t.detail.back}</BackLink>}
        title={item ? t.form.editTitle : t.form.createTitle}
        titleId={titleId}
        description={item ? item.name : undefined}
      />
      <form ref={formRef} noValidate onSubmit={submit} className="flex flex-col gap-4">
        <fieldset disabled={busy} className="flex flex-col gap-4">
          <Card title={t.form.general}>
            <Field label={t.form.name} hint={t.form.nameHint} required error={shown('name')}>
              {(control) => (
                <input
                  {...control}
                  value={draft.name}
                  onChange={(e) => set('name')(e.target.value)}
                  onBlur={blur('name')}
                />
              )}
            </Field>
            <Field label={t.form.category} required error={shown('category')}>
              {(control) => (
                <select
                  {...control}
                  value={draft.category}
                  onChange={(e) => set('category')(e.target.value)}
                  onBlur={blur('category')}
                >
                  <option value="">{t.form.choose}</option>
                  {CATEGORIES.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t.form.description}>
              {(control) => (
                <textarea
                  {...control}
                  rows={3}
                  value={draft.description}
                  onChange={(e) => set('description')(e.target.value)}
                />
              )}
            </Field>
          </Card>
          <Card title={t.form.pricing}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.form.price} hint={t.form.priceHint} required error={shown('price')}>
                {(control) => (
                  <MoneyInput
                    {...control}
                    value={draft.price}
                    onChange={(e) => set('price')(e.target.value)}
                    onBlur={blur('price')}
                  />
                )}
              </Field>
              <Field label={t.form.availableFrom} required error={shown('availableFrom')}>
                {(control) => (
                  <DateInput
                    {...control}
                    value={draft.availableFrom}
                    onChange={(e) => set('availableFrom')(e.target.value)}
                    onBlur={blur('availableFrom')}
                  />
                )}
              </Field>
            </div>
          </Card>
          <Card title={t.form.visibility}>
            <RadioGroupField label={t.form.visibilityLabel} required error={shown('visibility')}>
              {[
                ['public', t.form.visibilityPublic],
                ['team', t.form.visibilityTeam],
              ].map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={radioName}
                    value={value}
                    checked={draft.visibility === value}
                    onChange={() => set('visibility')(value)}
                  />
                  {label}
                </label>
              ))}
            </RadioGroupField>
          </Card>
        </fieldset>
        {requestError && (
          <p role="alert" className="form-error">
            {requestError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t.form.cancel}
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            {busy ? t.form.saving : t.form.save}
          </Button>
        </div>
      </form>
    </section>
  )
}

// ── The tool ────────────────────────────────────────────────────────────────

function OtherSection({ section, onBack }: { section: Section; onBack: () => void }) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId}>
      <PageHeader title={t.sections[section]} titleId={titleId} />
      <StatePanel
        title="Not part of this example"
        action={
          <Button variant="secondary" onClick={onBack}>
            Go to items
          </Button>
        }
      >
        This story covers the items section; see Pages/Tool navigation for every section.
      </StatePanel>
    </section>
  )
}

export function CatalogueApp({
  initialRoute = { name: 'list' },
  listState = 'loaded',
  saveOutcome = 'success',
}: {
  initialRoute?: Route
  listState?: ListState
  saveOutcome?: SaveOutcome
}) {
  const [items, setItems] = useState<Item[]>(ITEMS)
  const [route, setRoute] = useState<Route>(initialRoute)
  const [section, setSection] = useState<Section>('items')
  const [flash, setFlash] = useState<string | null>(null)
  const go = (next: Route) => {
    setFlash(null)
    setRoute(next)
    setSection('items')
  }

  let page: ReactNode
  if (section !== 'items') {
    page = <OtherSection section={section} onBack={() => go({ name: 'list' })} />
  } else if (route.name === 'list') {
    page = (
      <ListPage
        items={items}
        initialState={listState}
        flash={flash}
        onDismissFlash={() => setFlash(null)}
        onOpen={(item) => go({ name: 'detail', id: item.id })}
        onNew={() => go({ name: 'new' })}
      />
    )
  } else if (route.name === 'detail') {
    page = (
      <DetailPage
        key={route.id}
        item={items.find((item) => item.id === route.id)}
        flash={flash}
        onDismissFlash={() => setFlash(null)}
        onBack={() => go({ name: 'list' })}
        onEdit={(item) => go({ name: 'edit', id: item.id })}
        onDeleted={(item) => {
          setItems((current) => current.filter((candidate) => candidate.id !== item.id))
          setRoute({ name: 'list' })
          setFlash(t.delete.done(item.name))
        }}
      />
    )
  } else {
    const editing = route.name === 'edit' ? items.find((item) => item.id === route.id) : undefined
    page = (
      <FormPage
        key={route.name === 'edit' ? route.id : 'new'}
        item={editing}
        saveOutcome={saveOutcome}
        onCancel={() => go(editing ? { name: 'detail', id: editing.id } : { name: 'list' })}
        onSaved={(draft) => {
          const priceCents = parseDecimal(draft.price) ?? 0
          const saved: Item = editing
            ? {
                ...editing,
                name: draft.name.trim(),
                category: draft.category,
                description: draft.description,
                priceCents,
                availableFrom: draft.availableFrom,
                updated: '2026-10-31',
              }
            : {
                id: `item-new-${items.length + 1}`,
                code: `CAT-${String(200 + items.length).padStart(4, '0')}`,
                name: draft.name.trim(),
                category: draft.category,
                owner: 'Giulia Bianchi',
                status: 'draft',
                priceCents,
                currency: 'EUR',
                updated: '2026-10-31',
                availableFrom: draft.availableFrom,
                description: draft.description,
              }
          setItems((current) => (editing ? current.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...current]))
          setRoute({ name: 'detail', id: saved.id })
          setFlash(t.form.saved)
        }}
      />
    )
  }

  return (
    <CatalogueFrame active={section} onNavigate={setSection}>
      {page}
    </CatalogueFrame>
  )
}
