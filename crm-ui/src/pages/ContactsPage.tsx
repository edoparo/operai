import { useCallback, useId, useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { Button, Card, DataTable, Field, PageHeader, Pagination, StatePanel } from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import { ArchivedBadge } from '../components/Badges'
import ContactFormDialog from '../components/ContactFormDialog'
import { LoadFailure, Loading, Saved } from '../components/LoadState'
import { listContacts } from '../lib/crmApi'
import { contactName } from '../lib/people'
import type { ContactSummary } from '../lib/types'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'

const PAGE_SIZE = 25

/**
 * ContactsPage — every contact (US-2, AC-2.2): search by name or email, show
 * archived, a DataTable sorted by the server (last, first name), Pagination.
 * "New contact" opens ContactFormDialog; the new contact opens on its page.
 */
export default function ContactsPage() {
  const t = strings.contacts
  const titleId = useId()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  // After an erasure the contact page navigates here with the person's name: the destination confirms it (INC-19).
  const erasedName = useRouterState({
    select: (state) => (state.location.state as { erased?: unknown } | undefined)?.erased,
  })
  const [erasedDismissed, setErasedDismissed] = useState(false)

  const filtered = q.trim() !== '' || showArchived
  const load = useCallback(
    (signal: AbortSignal) =>
      listContacts({ q: q.trim(), archived: showArchived ? 'all' : 'false', page, pageSize: PAGE_SIZE }, { signal }),
    [q, showArchived, page],
  )
  const contacts = useResource(load)

  const columns: DataTableColumn<ContactSummary>[] = [
    {
      id: 'name',
      header: t.columns.name,
      rowHeader: true,
      render: (contact) => (
        <span className="flex flex-wrap items-center gap-2">
          <Link to="/contacts/$id" params={{ id: contact.id }} className="link">
            {contactName(contact)}
          </Link>
          {contact.archived && <ArchivedBadge />}
        </span>
      ),
    },
    {
      id: 'company',
      header: t.columns.company,
      render: (contact) =>
        contact.company ? (
          <Link to="/companies/$id" params={{ id: contact.company.id }} className="link">
            {contact.company.name}
          </Link>
        ) : (
          strings.common.none
        ),
    },
    { id: 'job', header: t.columns.jobTitle, render: (contact) => contact.jobTitle ?? strings.common.none },
    { id: 'email', header: t.columns.email, render: (contact) => contact.email ?? strings.common.none },
    { id: 'phone', header: t.columns.phone, render: (contact) => contact.phone ?? strings.common.none },
  ]

  let content
  if (contacts.status === 'loading') content = <Loading label={t.list.loading} />
  else if (contacts.status === 'error') content = <LoadFailure error={contacts.error} onRetry={contacts.retry} />
  else if (contacts.data!.total === 0)
    content = filtered ? (
      <StatePanel title={t.list.noMatchTitle}>{t.list.noMatchBody}</StatePanel>
    ) : (
      <StatePanel title={t.list.emptyTitle}>{t.list.emptyBody}</StatePanel>
    )
  else
    content = (
      <div className="flex flex-col gap-3">
        <DataTable
          caption={t.list.caption}
          columns={columns}
          rows={contacts.data!.items}
          getRowKey={(contact) => contact.id}
          interactiveRows
          testId="crm-contacts-table"
        />
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={contacts.data!.total}
          onPageChange={setPage}
          label={strings.common.pagination.label}
          previousLabel={strings.common.pagination.previous}
          nextLabel={strings.common.pagination.next}
          status={strings.common.pagination.status}
          testId="crm-contacts-pagination"
        />
      </div>
    )

  return (
    <section aria-labelledby={titleId} data-testid="crm-contacts-page">
      <PageHeader
        title={t.list.heading}
        titleId={titleId}
        description={t.list.description}
        actions={
          <Button
            variant="primary"
            onClick={() => setCreating(true)}
            aria-haspopup="dialog"
            data-testid="crm-contacts-new"
          >
            {t.list.newContact}
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        {typeof erasedName === 'string' && !erasedDismissed && (
          <Saved message={t.detail.erased(erasedName)} onDismiss={() => setErasedDismissed(true)} />
        )}
        <Card title={t.list.filters}>
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
            <Field label={strings.common.search} hint={t.list.searchHint} testId="crm-contacts-search">
              {(control) => (
                <input
                  {...control}
                  type="search"
                  value={q}
                  onChange={(event) => {
                    setQ(event.target.value)
                    setPage(1)
                  }}
                />
              )}
            </Field>
            <label className="flex items-center gap-2 text-sm text-text sm:pt-8">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => {
                  setShowArchived(event.target.checked)
                  setPage(1)
                }}
                data-testid="crm-contacts-archived"
              />
              {strings.common.showArchived}
            </label>
          </div>
        </Card>
        {content}
      </div>
      {creating && (
        <ContactFormDialog
          onCancel={() => setCreating(false)}
          // A create has no precondition, so it cannot be stale.
          onStale={() => setCreating(false)}
          onSaved={(contact) => {
            setCreating(false)
            void navigate({ to: '/contacts/$id', params: { id: contact.id } })
          }}
        />
      )}
    </section>
  )
}
