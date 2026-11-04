import { useCallback, useId, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Button, Card, DataTable, Field, PageHeader, Pagination, StatePanel } from '@operai/ui'
import type { DataTableColumn, DataTableSort } from '@operai/ui'
import { ArchivedBadge, CompanyStatusBadge, EntityBadge } from '../components/Badges'
import CompanyFormDialog from '../components/CompanyFormDialog'
import { LoadFailure, Loading } from '../components/LoadState'
import { listCompanies, listCompanyOwners } from '../lib/crmApi'
import type { CompanySort } from '../lib/crmApi'
import { personName } from '../lib/people'
import { COMPANY_STATUSES } from '../lib/types'
import type { CompanyStatus, CompanySummary } from '../lib/types'
import { useCurrentUserId } from '../hooks/useCurrentUserId'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'

const PAGE_SIZE = 25

/** The table columns the server sorts by (US-9); owner and counts are not sortable. */
const SORTABLE: readonly CompanySort[] = ['name', 'status', 'entity', 'industry', 'city']

/**
 * CompaniesPage — the shared companies list (US-1, AC-1.1/1.2, US-9): filters
 * in a Card (name search, status, owner, show archived), a DataTable sorted by
 * the server on the column the person picks (name first), offset Pagination. "New company" opens CompanyFormDialog; a created
 * company opens on its own page (the destination confirms it).
 */
export default function CompaniesPage() {
  const t = strings.companies
  const titleId = useId()
  const navigate = useNavigate()
  const currentUserId = useCurrentUserId()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<CompanyStatus | ''>('')
  const [ownerId, setOwnerId] = useState('')
  const [sort, setSort] = useState<DataTableSort>({ columnId: 'name', direction: 'asc' })
  const [showArchived, setShowArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)

  const filtered = q.trim() !== '' || status !== '' || ownerId !== '' || showArchived
  const load = useCallback(
    (signal: AbortSignal) =>
      listCompanies(
        {
          q: q.trim(),
          status,
          ...(ownerId ? { ownerId } : {}),
          archived: showArchived ? 'all' : 'false',
          sort: sort.columnId as CompanySort,
          order: sort.direction,
          page,
          pageSize: PAGE_SIZE,
        },
        { signal },
      ),
    [q, status, ownerId, showArchived, sort, page],
  )
  const companies = useResource(load)
  const loadOwners = useCallback((signal: AbortSignal) => listCompanyOwners({ signal }), [])
  // The owner filter's choices; if they fail to load, the filter offers "Mine" only.
  const owners = useResource(loadOwners)
  const otherOwners = (owners.data?.items ?? []).filter((person) => person.id !== currentUserId)

  const baseColumns: DataTableColumn<CompanySummary>[] = [
    {
      id: 'name',
      header: t.columns.name,
      rowHeader: true,
      render: (company) => (
        <span className="flex flex-wrap items-center gap-2">
          <Link to="/companies/$id" params={{ id: company.id }} className="link">
            {company.name}
          </Link>
          {company.archived && <ArchivedBadge />}
        </span>
      ),
    },
    { id: 'status', header: t.columns.status, render: (company) => <CompanyStatusBadge status={company.status} /> },
    { id: 'entity', header: t.columns.entity, render: (company) => <EntityBadge entity={company.entity} /> },
    { id: 'industry', header: t.columns.industry, render: (company) => company.industry ?? strings.common.none },
    {
      id: 'city',
      header: t.columns.city,
      render: (company) => [company.city, company.country].filter(Boolean).join(', ') || strings.common.none,
    },
    { id: 'owner', header: t.columns.owner, render: (company) => personName(company.owner, currentUserId) },
    { id: 'contacts', header: t.columns.contacts, numeric: true, render: (company) => company.contactCount },
    { id: 'openDeals', header: t.columns.openDeals, numeric: true, render: (company) => company.openDealCount },
  ]
  const columns = baseColumns.map((column) =>
    (SORTABLE as readonly string[]).includes(column.id) ? { ...column, sortable: true } : column,
  )

  let content
  if (companies.status === 'loading') content = <Loading label={t.list.loading} />
  else if (companies.status === 'error') content = <LoadFailure error={companies.error} onRetry={companies.retry} />
  else if (companies.data!.total === 0)
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
          rows={companies.data!.items}
          getRowKey={(company) => company.id}
          interactiveRows
          sort={sort}
          onSortChange={(next) => {
            setSort(next)
            setPage(1)
          }}
          testId="crm-companies-table"
        />
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={companies.data!.total}
          onPageChange={setPage}
          label={strings.common.pagination.label}
          previousLabel={strings.common.pagination.previous}
          nextLabel={strings.common.pagination.next}
          status={strings.common.pagination.status}
          testId="crm-companies-pagination"
        />
      </div>
    )

  return (
    <section aria-labelledby={titleId} data-testid="crm-companies-page">
      <PageHeader
        title={t.list.heading}
        titleId={titleId}
        description={t.list.description}
        actions={
          <Button
            variant="primary"
            onClick={() => setCreating(true)}
            aria-haspopup="dialog"
            data-testid="crm-companies-new"
          >
            {t.list.newCompany}
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <Card title={t.list.filters}>
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={strings.common.search} hint={t.list.searchHint} testId="crm-companies-search">
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
            <Field label={t.list.status} testId="crm-companies-status">
              {(control) => (
                <select
                  {...control}
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value as CompanyStatus | '')
                    setPage(1)
                  }}
                >
                  <option value="">{strings.common.any}</option>
                  {COMPANY_STATUSES.map((option) => (
                    <option key={option} value={option}>
                      {strings.badges.companyStatus[option]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t.list.owner} testId="crm-companies-owner">
              {(control) => (
                <select
                  {...control}
                  value={ownerId}
                  onChange={(event) => {
                    setOwnerId(event.target.value)
                    setPage(1)
                  }}
                >
                  <option value="">{strings.common.any}</option>
                  {currentUserId && <option value={currentUserId}>{t.list.mine}</option>}
                  {otherOwners.map((person) => (
                    <option key={person.id} value={person.id}>
                      {personName(person)}
                    </option>
                  ))}
                </select>
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
                data-testid="crm-companies-archived"
              />
              {strings.common.showArchived}
            </label>
          </div>
        </Card>
        {content}
      </div>
      {creating && (
        <CompanyFormDialog
          onCancel={() => setCreating(false)}
          // A create has no precondition, so it cannot be stale.
          onStale={() => setCreating(false)}
          onSaved={(company) => {
            setCreating(false)
            void navigate({ to: '/companies/$id', params: { id: company.id } })
          }}
        />
      )}
    </section>
  )
}
