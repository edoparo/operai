import { useCallback, useId, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Banner, Button, Card, ConfirmDialog, FactList, Icon, PageHeader, StatePanel } from '@operai/ui'
import ActivityTimeline from '../components/ActivityTimeline'
import { ArchivedBadge } from '../components/Badges'
import ContactFormDialog from '../components/ContactFormDialog'
import { LoadFailure, Loading, Saved, StaleWriteBanner } from '../components/LoadState'
import { isStaleWrite } from '../lib/api'
import { eraseContact, getContact, setContactArchived } from '../lib/crmApi'
import { errorMessage, statusOf } from '../lib/errors'
import { contactName } from '../lib/people'
import type { Contact } from '../lib/types'
import { useCrmCapabilities } from '../hooks/scopeContext'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'

const BackLink = () => (
  <Link to="/contacts" className="link" data-testid="crm-contact-back">
    <Icon name="arrow-left" /> {strings.contacts.detail.back}
  </Link>
)

type Pending = 'archive' | 'erase' | null

/**
 * ContactDetailPage — one contact (AC-2.1, 2.3, 2.4): details and the
 * activities about them. Actions: Edit, Archive/Unarchive, and — for a
 * `contact:erase` holder only (`GET /scope` canErase) — "Erase personal data",
 * an irreversible act confirmed with `ConfirmDialog tone="danger"` and an
 * acknowledgement (D-13). After erasure the person is sent to the contacts list.
 */
export default function ContactDetailPage() {
  const t = strings.contacts
  const { id = '' } = useParams({ strict: false }) as { id?: string }
  const titleId = useId()
  const navigate = useNavigate()
  const { canErase } = useCrmCapabilities()
  const load = useCallback((signal: AbortSignal) => getContact(id, { signal }), [id])
  const contact = useResource(load)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [stale, setStale] = useState(false)

  if (contact.status === 'loading') return <Loading label={t.detail.loading} />
  if (contact.status === 'error') {
    if (statusOf(contact.error) === 404)
      return (
        <section aria-labelledby={titleId}>
          <PageHeader title={t.detail.notFoundTitle} titleId={titleId} back={<BackLink />} />
          <StatePanel role="alert" focusOnMount title={t.detail.notFoundTitle} testId="crm-contact-not-found">
            {t.detail.notFoundBody}
          </StatePanel>
        </section>
      )
    return <LoadFailure error={contact.error} onRetry={contact.retry} />
  }

  const current = contact.data!
  const name = contactName(current)
  const updated = (next: Contact, message: string) => {
    contact.replace(next)
    setSaved(message)
    setStale(false)
  }

  const close = () => {
    setPending(null)
    setActionError(null)
  }

  const confirm = () => {
    setBusy(true)
    setActionError(null)
    if (pending === 'erase') {
      eraseContact(current.id).then(
        () => {
          setBusy(false)
          void navigate({ to: '/contacts', state: { erased: name } as never })
        },
        (failure) => {
          setBusy(false)
          setActionError(errorMessage(failure))
        },
      )
      return
    }
    setContactArchived(current.id, current.version, !current.archived).then(
      (next) => {
        setBusy(false)
        setPending(null)
        updated(next, next.archived ? t.detail.archived : t.detail.unarchived)
      },
      (failure) => {
        setBusy(false)
        if (isStaleWrite(failure)) {
          setPending(null)
          setStale(true)
          return
        }
        setActionError(errorMessage(failure))
      },
    )
  }

  const archiveDialog = current.archived ? t.unarchiveDialog : t.archiveDialog

  return (
    <section aria-labelledby={titleId} data-testid="crm-contact-page">
      <PageHeader
        title={name}
        titleId={titleId}
        status={current.archived ? <ArchivedBadge /> : undefined}
        description={current.jobTitle ?? undefined}
        back={<BackLink />}
        actions={
          <>
            {canErase && (
              <Button
                variant="danger"
                onClick={() => setPending('erase')}
                aria-haspopup="dialog"
                data-testid="crm-contact-erase"
              >
                {t.detail.erase}
              </Button>
            )}
            <Button onClick={() => setPending('archive')} aria-haspopup="dialog" data-testid="crm-contact-archive">
              {current.archived ? t.detail.unarchive : t.detail.archive}
            </Button>
            <Button onClick={() => setEditing(true)} aria-haspopup="dialog" data-testid="crm-contact-edit">
              {strings.common.edit}
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-4">
        {stale && (
          <StaleWriteBanner
            onReload={() => {
              setStale(false)
              contact.retry()
            }}
          />
        )}
        {saved && <Saved message={saved} onDismiss={() => setSaved(null)} />}
        {current.archived && <Banner tone="info">{t.detail.archivedNotice}</Banner>}
        <Card title={t.detail.details}>
          <FactList
            testId="crm-contact-facts"
            items={[
              {
                id: 'company',
                term: t.detail.company,
                value: current.company ? (
                  <Link to="/companies/$id" params={{ id: current.company.id }} className="link">
                    {current.company.name}
                  </Link>
                ) : (
                  t.detail.noCompany
                ),
              },
              { id: 'job', term: t.detail.jobTitle, value: current.jobTitle ?? strings.common.none },
              {
                id: 'email',
                term: t.detail.email,
                value: current.email ? (
                  <a href={`mailto:${current.email}`} className="link">
                    {current.email}
                  </a>
                ) : (
                  strings.common.none
                ),
              },
              {
                id: 'phone',
                term: t.detail.phone,
                value: current.phone ? (
                  <a href={`tel:${current.phone}`} className="link">
                    {current.phone}
                  </a>
                ) : (
                  strings.common.none
                ),
              },
            ]}
          />
          {current.notes && (
            <div className="mt-3">
              <h4 className="text-xs text-soft">{t.detail.notes}</h4>
              <p className="whitespace-pre-line text-sm text-text">{current.notes}</p>
            </div>
          )}
        </Card>
        <ActivityTimeline
          target={{ contactId: current.id }}
          company={current.company}
          preset={{ contactId: current.id }}
        />
      </div>
      {editing && (
        <ContactFormDialog
          contact={current}
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
      {pending === 'archive' && (
        <ConfirmDialog
          tone="primary"
          title={archiveDialog.title(name)}
          confirmLabel={archiveDialog.confirm}
          busyLabel={archiveDialog.busy}
          cancelLabel={strings.common.cancel}
          closeLabel={strings.common.close}
          busy={busy}
          error={actionError}
          onConfirm={confirm}
          onCancel={close}
          testIdPrefix="crm-contact-archive-dialog"
        >
          {archiveDialog.body}
        </ConfirmDialog>
      )}
      {pending === 'erase' && (
        <ConfirmDialog
          tone="danger"
          title={t.eraseDialog.title(name)}
          confirmLabel={t.eraseDialog.confirm}
          busyLabel={t.eraseDialog.busy}
          cancelLabel={strings.common.cancel}
          closeLabel={strings.common.close}
          acknowledgeLabel={t.eraseDialog.acknowledge}
          busy={busy}
          error={actionError}
          onConfirm={confirm}
          onCancel={close}
          testIdPrefix="crm-contact-erase-dialog"
        >
          {t.eraseDialog.body}
        </ConfirmDialog>
      )}
    </section>
  )
}
