import { useCallback, useId, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Button, Card, DataTable, Field, PageHeader, Pagination, StatePanel } from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import { ArchivedBadge, CompanyStatusBadge, EntityBadge } from '../components/Badges'
import CompanyFormDialog from '../components/CompanyFormDialog'
import { LoadFailure, Loading } from '../components/LoadState'
import { listCompanies } from '../lib/crmApi'
import { personName } from '../lib/people'
import { COMPANY_STATUSES } from '../lib/types'
import type { CompanyStatus, CompanySummary } from '../lib/types'
import { useCurrentUserId } from '../hooks/useCurrentUserId'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'

const PAGE_SIZE = 25

/**
 * CompaniesPage — the shared companies list (US-1, AC-1.1/1.2): filters in a
 * Card (name search, status, show archived), a DataTable sorted by the server
 * by name, offset Pagination. "New company" opens CompanyFormDialog; a created
 * company opens on its own page (the destination confirms it).
 */
export default function CompaniesPage() {
  const t = strings.companies
  const titleId = useId()
  const navigate = useNavigate()
  const currentUserId = useCurrentUserId()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<CompanyStatus | ''>('')
  const [showArchived, setShowArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)

  const filtered = q.trim() !== '' || status !== '' || showArchived
  const load = useCallback(
    (signal: AbortSignal) =>
      listCompanies(
        { q: q.trim(), status, archived: showArchived ? 'all' : 'false', page, pageSize: PAGE_SIZE },
        { signal },
      ),
    [q, status, showArchived, page],
  )
  const companies = useResource(load)

  const columns: DataTableColumn<CompanySummary>[] = [
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
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
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
