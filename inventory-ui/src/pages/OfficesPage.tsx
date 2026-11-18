import { useEffect, useState } from 'react'
import { Button, PageHeader, StatePanel, StatusBadge, VisuallyHidden } from '@operai/ui'
import ConfirmDialog from '../components/ConfirmDialog'
import DataTable from '../components/DataTable'
import EntityBadge from '../components/EntityBadge'
import ErrorBanner from '../components/ErrorBanner'
import OfficeFormDialog from '../components/OfficeFormDialog'
import PermissionDenied from '../components/PermissionDenied'
import SkeletonListRows from '../components/SkeletonListRows'
import { useInventoryCapabilities } from '../hooks/useInventoryCapabilities'
import { useScope } from '../hooks/useScope'
import { ApiError } from '../lib/api'
import { listOffices, updateOffice } from '../lib/officesApi'
import { OFFICE_STATE_MEANING } from '../lib/statusMeanings'
import { toInventoryError } from '../lib/types'
import type { Office } from '../lib/types'
import { strings } from '../strings'

/**
 * OfficesPage — `/offices`: the offices an asset can be assigned to. `asset:manage`
 * only (a UX gate; the server's 403 is the real one). A table of every office,
 * archived ones included, with the assets each holds, and Add / Edit / Archive /
 * Restore. Archiving an office that still holds assets is refused by the server
 * (409 `office_in_use`) and the confirmation stays open with that message.
 */

const PAGE_TEST_ID = 'inventory-offices-page'

const messageFor = (error: unknown): string => {
  if (error instanceof ApiError) {
    return error.status === 503
      ? `${strings.common.authUnavailable.heading}. ${strings.common.authUnavailable.body}`
      : (error.detail ?? strings.errors.unknown)
  }
  return strings.errors.network
}

type Outcome = { attempt: number; ok: true; offices: Office[] } | { attempt: number; ok: false; error: unknown }
type Dialog = { kind: 'form'; office: Office | null } | { kind: 'archive' | 'restore'; office: Office }

export default function OfficesPage() {
  const t = strings.offices
  const { canManageAssets } = useInventoryCapabilities()
  const scope = useScope(canManageAssets)
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [statusLine, setStatusLine] = useState('')

  useEffect(() => {
    if (!canManageAssets) return
    const controller = new AbortController()
    listOffices({ signal: controller.signal }).then(
      ({ items }) => {
        if (!controller.signal.aborted) setOutcome({ attempt, ok: true, offices: items })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setOutcome({ attempt, ok: false, error })
      },
    )
    return () => controller.abort()
  }, [canManageAssets, attempt])

  if (!canManageAssets) {
    return (
      <section data-testid={PAGE_TEST_ID}>
        <PermissionDenied />
      </section>
    )
  }

  const retry = () => setAttempt((n) => n + 1)
  const reload = () => {
    setDialog(null)
    retry()
  }
  const current = outcome?.attempt === attempt ? outcome : null
  const shown = current ?? (outcome?.ok ? outcome : null)

  const confirmToggle = async (office: Office, archived: boolean) => {
    setBusy(true)
    setConfirmError(null)
    try {
      await updateOffice(office.id, { archived })
      setDialog(null)
      setStatusLine(archived ? t.done.archived(office.name) : t.done.restored(office.name))
      retry()
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) reload()
      else if (toInventoryError(error)?.code === 'office_in_use') setConfirmError(strings.errors.office_in_use)
      else if (toInventoryError(error)?.code === 'office_name_taken') setConfirmError(strings.errors.office_name_taken)
      else setConfirmError(messageFor(error))
    } finally {
      setBusy(false)
    }
  }

  let content
  if (current !== null && !current.ok) {
    content =
      current.error instanceof ApiError && current.error.status === 403 ? (
        <PermissionDenied />
      ) : (
        <ErrorBanner message={messageFor(current.error)} onRetry={retry} retryLabel={t.retry} />
      )
  } else if (shown === null || !shown.ok || scope.status === 'loading') {
    content = (
      <div className="flex flex-col gap-2">
        <VisuallyHidden live role="status">
          {t.loading}
        </VisuallyHidden>
        <SkeletonListRows />
      </div>
    )
  } else if (shown.offices.length === 0) {
    content = (
      <StatePanel testId="offices-empty" title={t.empty.heading}>
        {t.empty.body}
      </StatePanel>
    )
  } else {
    content = (
      <DataTable
        caption={t.caption}
        regionLabel={t.regionLabel}
        columns={[
          { id: 'name', header: t.columns.name, rowHeader: true, render: (o) => o.name },
          { id: 'entity', header: t.columns.entity, render: (o) => <EntityBadge entity={o.entity} /> },
          { id: 'assets', header: t.columns.assets, numeric: true, render: (o) => o.assetCount },
          {
            id: 'status',
            header: t.columns.status,
            render: (o) => {
              const state = o.archived ? 'archived' : 'active'
              return <StatusBadge status={OFFICE_STATE_MEANING[state]}>{t.status[state]}</StatusBadge>
            },
          },
          {
            id: 'actions',
            header: t.columns.actions,
            render: (o) => (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={t.actions.editLabel(o.name)}
                  onClick={() => setDialog({ kind: 'form', office: o })}
                >
                  {t.actions.edit}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={o.archived ? t.actions.restoreLabel(o.name) : t.actions.archiveLabel(o.name)}
                  onClick={() => {
                    setConfirmError(null)
                    setDialog({ kind: o.archived ? 'restore' : 'archive', office: o })
                  }}
                >
                  {o.archived ? t.actions.restore : t.actions.archive}
                </Button>
              </div>
            ),
          },
        ]}
        rows={shown.offices}
        getRowKey={(o) => o.id}
        testId="offices-table"
      />
    )
  }

  const entities = scope.scope?.asset ?? []
  const confirmCopy =
    dialog !== null && dialog.kind !== 'form' ? (dialog.kind === 'archive' ? t.archiveDialog : t.restoreDialog) : null

  return (
    <section data-testid={PAGE_TEST_ID} aria-labelledby="offices-heading" className="flex flex-col gap-4">
      <PageHeader
        title={t.heading}
        titleId="offices-heading"
        className="mb-0"
        actions={
          scope.status === 'ready' && entities.length > 0 ? (
            <Button variant="primary" onClick={() => setDialog({ kind: 'form', office: null })}>
              {t.add}
            </Button>
          ) : undefined
        }
      />
      <VisuallyHidden live role="status">
        {statusLine}
      </VisuallyHidden>
      {scope.status === 'ready' && entities.length === 0 && <StatePanel title={t.noEntity} />}
      {content}

      {dialog?.kind === 'form' && (
        <OfficeFormDialog
          office={dialog.office}
          entities={entities}
          onCancel={() => setDialog(null)}
          onGone={reload}
          onSaved={(saved, mode) => {
            setDialog(null)
            setStatusLine(mode === 'added' ? t.done.added(saved.name) : t.done.updated(saved.name))
            retry()
          }}
        />
      )}

      {dialog !== null && dialog.kind !== 'form' && confirmCopy !== null && (
        <ConfirmDialog
          entityLabel={confirmCopy.entityLabel}
          itemName={dialog.office.name}
          isDeleting={busy}
          errorMessage={confirmError}
          title={confirmCopy.title(dialog.office.name)}
          body={<p>{confirmCopy.body}</p>}
          tone={dialog.kind === 'archive' ? 'destructive' : 'positive'}
          confirmLabel={confirmCopy.confirm}
          confirmingLabel={confirmCopy.confirming}
          onConfirm={() => void confirmToggle(dialog.office, dialog.kind === 'archive')}
          onCancel={() => setDialog(null)}
          testIdPrefix={`confirm-office-${dialog.kind}`}
        />
      )}
    </section>
  )
}
