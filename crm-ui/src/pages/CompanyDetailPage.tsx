import { useCallback, useId, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  FactList,
  Icon,
  PageHeader,
  StatePanel,
  formatDate,
} from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import ActivityTimeline from '../components/ActivityTimeline'
import { ArchivedBadge, CompanyStatusBadge, DealStageBadge, EntityBadge } from '../components/Badges'
import CompanyFormDialog from '../components/CompanyFormDialog'
import ContactFormDialog from '../components/ContactFormDialog'
import DealFormDialog from '../components/DealFormDialog'
import { LoadFailure, Loading, Saved, StaleWriteBanner } from '../components/LoadState'
import { isStaleWrite } from '../lib/api'
import { getCompany, listContacts, listDeals, setCompanyArchived } from '../lib/crmApi'
import { errorMessage, statusOf } from '../lib/errors'
import { dealAmount } from '../lib/money'
import { contactName, personName } from '../lib/people'
import type { Company, ContactSummary, DealSummary } from '../lib/types'
import { useCrmCapabilities } from '../hooks/scopeContext'
import { useCurrentUserId } from '../hooks/useCurrentUserId'
import { useResource } from '../hooks/useResource'
import { isHttpUrl } from '../lib/validate'
import { strings } from '../strings'

const SECTION_PAGE_SIZE = 100

const BackLink = () => (
  <Link to="/companies" className="link" data-testid="crm-company-back">
    <Icon name="arrow-left" /> {strings.companies.detail.back}
  </Link>
)

/**
 * CompanyDetailPage — one company (AC-1.5–1.7): its details, contacts, deals
 * and activity timeline, each a Card. Page actions: Edit, Archive/Unarchive
 * (a reversible act, so `ConfirmDialog tone="primary"`). A stale write shows
 * the reload banner; Reload re-fetches the company.
 */
export default function CompanyDetailPage() {
  const t = strings.companies
  const { id = '' } = useParams({ strict: false }) as { id?: string }
  const titleId = useId()
  const load = useCallback((signal: AbortSignal) => getCompany(id, { signal }), [id])
  const company = useResource(load)
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [stale, setStale] = useState(false)

  if (company.status === 'loading') return <Loading label={t.detail.loading} />
  if (company.status === 'error') {
    if (statusOf(company.error) === 404)
      return (
        <section aria-labelledby={titleId}>
          <PageHeader title={t.detail.notFoundTitle} titleId={titleId} back={<BackLink />} />
          <StatePanel role="alert" focusOnMount title={t.detail.notFoundTitle} testId="crm-company-not-found">
            {t.detail.notFoundBody}
          </StatePanel>
        </section>
      )
    return <LoadFailure error={company.error} onRetry={company.retry} />
  }

  const current = company.data!
  const updated = (next: Company, message: string) => {
    company.replace(next)
    setSaved(message)
    setStale(false)
  }
  const reload = () => {
    setStale(false)
    company.retry()
  }

  const toggleArchive = () => {
    setArchiveBusy(true)
    setArchiveError(null)
    setCompanyArchived(current.id, current.version, !current.archived).then(
      (next) => {
        setArchiveBusy(false)
        setArchiving(false)
        updated(next, next.archived ? t.detail.archived : t.detail.unarchived)
      },
      (failure) => {
        setArchiveBusy(false)
        if (isStaleWrite(failure)) {
          setArchiving(false)
          setStale(true)
          return
        }
        setArchiveError(errorMessage(failure))
      },
    )
  }

  const location = [current.city, current.country].filter(Boolean).join(', ')
  const address = [current.street, current.postalCode].filter(Boolean).join(', ')
  const dialog = current.archived ? t.unarchiveDialog : t.archiveDialog

  return (
    <section aria-labelledby={titleId} data-testid="crm-company-page">
      <PageHeader
        title={current.name}
        titleId={titleId}
        status={
          <span className="flex gap-2">
            <CompanyStatusBadge status={current.status} />
            {current.archived && <ArchivedBadge />}
          </span>
        }
        back={<BackLink />}
        actions={
          <>
            <Button onClick={() => setArchiving(true)} aria-haspopup="dialog" data-testid="crm-company-archive">
              {current.archived ? t.detail.unarchive : t.detail.archive}
            </Button>
            <Button onClick={() => setEditing(true)} aria-haspopup="dialog" data-testid="crm-company-edit">
              {strings.common.edit}
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-4">
        {stale && <StaleWriteBanner onReload={reload} />}
        {saved && <Saved message={saved} onDismiss={() => setSaved(null)} />}
        {current.archived && <Banner tone="info">{t.detail.archivedNotice}</Banner>}
        {current.statusLapsed && (
          <Banner tone="info" data-testid="crm-company-lapsed">
            {t.detail.lapsedNotice}
          </Banner>
        )}
        <Card title={t.detail.details}>
          <FactList
            testId="crm-company-facts"
            items={[
              { id: 'entity', term: t.detail.entity, value: <EntityBadge entity={current.entity} /> },
              { id: 'owner', term: t.detail.owner, value: personName(current.owner) },
              { id: 'industry', term: t.detail.industry, value: current.industry ?? strings.common.none },
              { id: 'legalName', term: t.detail.legalName, value: current.legalName ?? strings.common.none },
              { id: 'address', term: t.detail.address, value: address || strings.common.none },
              { id: 'location', term: t.detail.location, value: location || strings.common.none },
              {
                id: 'website',
                term: t.detail.website,
                value: current.website && isHttpUrl(current.website) ? (
                  <a href={current.website} className="link" target="_blank" rel="noreferrer noopener">
                    {current.website}
                  </a>
                ) : (
                  (current.website ?? strings.common.none)
                ),
              },
              { id: 'created', term: t.detail.created, value: formatDate(current.createdAt) },
            ]}
          />
          {current.notes && (
            <div className="mt-3">
              <h4 className="text-xs text-soft">{t.detail.notes}</h4>
              <p className="whitespace-pre-line text-sm text-text">{current.notes}</p>
            </div>
          )}
        </Card>
        <CompanyContactsCard company={current} />
        <CompanyDealsCard company={current} />
        <ActivityTimeline target={{ companyId: current.id }} company={{ id: current.id, name: current.name }} />
      </div>
      {editing && (
        <CompanyFormDialog
          company={current}
          onCancel={() => setEditing(false)}
          onStale={() => {
            setEditing(false)
            setStale(true)
          }}
          onSaved={(next) => {
            setEditing(false)
            updated(next, t.detail.saved)
          }}
        />
      )}
      {archiving && (
        <ConfirmDialog
          tone="primary"
          title={dialog.title(current.name)}
          confirmLabel={dialog.confirm}
          busyLabel={dialog.busy}
          cancelLabel={strings.common.cancel}
          closeLabel={strings.common.close}
          busy={archiveBusy}
          error={archiveError}
          onConfirm={toggleArchive}
          onCancel={() => setArchiving(false)}
          testIdPrefix="crm-company-archive-dialog"
        >
          {dialog.body}
        </ConfirmDialog>
      )}
    </section>
  )
}

function CompanyContactsCard({ company }: { company: Company }) {
  const t = strings.companies.detail
  const companyId = company.id
  const load = useCallback(
    (signal: AbortSignal) => listContacts({ companyId, archived: 'all', pageSize: SECTION_PAGE_SIZE }, { signal }),
    [companyId],
  )
  const contacts = useResource(load)
  const [adding, setAdding] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const columns: DataTableColumn<ContactSummary>[] = [
    {
      id: 'name',
      header: strings.contacts.columns.name,
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
      id: 'job',
      header: strings.contacts.columns.jobTitle,
      render: (contact) => contact.jobTitle ?? strings.common.none,
    },
    { id: 'email', header: strings.contacts.columns.email, render: (contact) => contact.email ?? strings.common.none },
    { id: 'phone', header: strings.contacts.columns.phone, render: (contact) => contact.phone ?? strings.common.none },
  ]

  return (
    <Card
      title={t.contacts}
      action={
        <Button size="sm" onClick={() => setAdding(true)} aria-haspopup="dialog" data-testid="crm-company-add-contact">
          {t.addContact}
        </Button>
      }
      data-testid="crm-company-contacts"
    >
      <div className="flex flex-col gap-3">
        {saved && <Saved message={saved} onDismiss={() => setSaved(null)} />}
        {contacts.status === 'loading' && <Loading label={strings.contacts.list.loading} rows={2} />}
        {contacts.status === 'error' && <LoadFailure error={contacts.error} onRetry={contacts.retry} />}
        {contacts.status === 'ready' &&
          (contacts.data!.total === 0 ? (
            <p className="text-sm text-soft">{t.noContacts}</p>
          ) : (
            <DataTable
              caption={t.contactsCaption}
              columns={columns}
              rows={contacts.data!.items}
              getRowKey={(contact) => contact.id}
              interactiveRows
            />
          ))}
      </div>
      {adding && (
        <ContactFormDialog
          company={{ id: company.id, name: company.name }}
          onCancel={() => setAdding(false)}
          onStale={() => setAdding(false)}
          onSaved={(contact) => {
            setAdding(false)
            setSaved(strings.contacts.list.created(contactName(contact)))
            contacts.retry()
          }}
        />
      )}
    </Card>
  )
}

function CompanyDealsCard({ company }: { company: Company }) {
  const t = strings.companies.detail
  const { canManageDeals, financials } = useCrmCapabilities()
  const currentUserId = useCurrentUserId()
  const companyId = company.id
  const load = useCallback(
    (signal: AbortSignal) => listDeals({ companyId, pageSize: SECTION_PAGE_SIZE }, { signal }),
    [companyId],
  )
  const deals = useResource(load)
  const [adding, setAdding] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const columns: DataTableColumn<DealSummary>[] = [
    {
      id: 'title',
      header: strings.deals.columns.title,
      rowHeader: true,
      render: (deal) => (
        <Link to="/deals/$id" params={{ id: deal.id }} className="link">
          {deal.title}
        </Link>
      ),
    },
    { id: 'stage', header: strings.deals.columns.stage, render: (deal) => <DealStageBadge stage={deal.stage} /> },
    { id: 'owner', header: strings.deals.columns.owner, render: (deal) => personName(deal.owner, currentUserId) },
    {
      id: 'expected',
      header: strings.deals.columns.expected,
      numeric: true,
      render: (deal) => (deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : strings.common.none),
    },
    ...(financials
      ? [
          {
            id: 'amount',
            header: strings.deals.columns.amount,
            numeric: true,
            render: (deal: DealSummary) =>
              deal.amountCents !== undefined && deal.currency !== undefined
                ? dealAmount(deal.amountCents, deal.currency)
                : null,
          },
        ]
      : []),
  ]

  return (
    <Card
      title={t.deals}
      action={
        canManageDeals &&
        !company.archived && (
          <Button size="sm" onClick={() => setAdding(true)} aria-haspopup="dialog" data-testid="crm-company-new-deal">
            {t.newDeal}
          </Button>
        )
      }
      data-testid="crm-company-deals"
    >
      <div className="flex flex-col gap-3">
        {saved && <Saved message={saved} onDismiss={() => setSaved(null)} />}
        {deals.status === 'loading' && <Loading label={strings.deals.detail.loading} rows={2} />}
        {deals.status === 'error' && <LoadFailure error={deals.error} onRetry={deals.retry} />}
        {deals.status === 'ready' &&
          (deals.data!.total === 0 ? (
            <p className="text-sm text-soft">{t.noDeals}</p>
          ) : (
            <DataTable
              caption={t.dealsCaption}
              columns={columns}
              rows={deals.data!.items}
              getRowKey={(deal) => deal.id}
              interactiveRows
            />
          ))}
      </div>
      {adding && (
        <DealFormDialog
          company={{ id: company.id, name: company.name, entity: company.entity }}
          onCancel={() => setAdding(false)}
          onStale={() => setAdding(false)}
          onSaved={(deal) => {
            setAdding(false)
            setSaved(strings.deals.pipeline.created(deal.title))
            deals.retry()
          }}
        />
      )}
    </Card>
  )
}
