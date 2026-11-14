/**
 * AccessRequestsPage — the waiting list of people who signed in without an
 * invitation (T9, specs/20261105-signup-gate, design.md S1–S3, flows F1–F4 and F7).
 * Route `/users/access-requests` (../router.tsx), third tab of `UsersSubNav`.
 *
 * Status filter (Pending by default — component state, not URL, so the
 * notification deep link always lands on Pending), a paginated table, and per
 * pending row:
 *   - Approve → `ApproveAccessRequestModal` (roles/departments, none selected,
 *     zero selections valid) → `POST …/approve`. The banner says whether the
 *     invitation email was sent; a failed send is a warning that does not
 *     auto-dismiss and links to Invitations (AC-3.7).
 *   - Reject → danger `ConfirmDialog` → `POST …/reject` (AC-3.4).
 * Failures are classified by `lib/accessRequestConflict.ts`: a 409
 * `already_decided` / 404 closes the dialog, reloads and warns (AC-3.6); a 403
 * replaces the page with `PermissionDenied` (AC-3.10); the rest stay inline in
 * the dialog.
 *
 * Focus: a decided row leaves Pending, so after a decision that removed the
 * trigger, focus moves to the results region (`tabIndex={-1}`) instead of
 * falling to <body>; Cancel returns it to the row's button (dialog behaviour).
 *
 * Explicit Promise chains in effects, not async/await — see AuditPage.tsx's
 * doc comment (`react-hooks/set-state-in-effect`).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Banner,
  Button,
  ConfirmDialog,
  DataTable,
  PageHeader,
  StatePanel,
  buttonClassName,
  formatDateTime,
} from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import * as adminApi from '../lib/adminApi'
import type { AccessRequestDetail, AccessRequestStatus, Department, Paginated, Role } from '../lib/adminApi'
import { ApiError } from '../lib/adminApi'
import { accessRequestOutcomeFor } from '../lib/accessRequestConflict'
import SkeletonListRows from '../components/SkeletonListRows'
import ErrorBanner from '../components/ErrorBanner'
import Pagination from '../components/Pagination'
import PermissionDenied from '../components/PermissionDenied'
import SuccessBanner from '../components/SuccessBanner'
import UsersSubNav from '../components/UsersSubNav'
import ApproveAccessRequestModal from '../components/ApproveAccessRequestModal'
import AccessRequestStatusBadge from '../components/AccessRequestStatusBadge'
import { strings } from '../strings'

const t = strings.accessRequests

const PAGE_SIZE = 20

const STATUS_OPTIONS: { value: AccessRequestStatus; label: string }[] = [
  { value: 'pending', label: t.filter.pending },
  { value: 'approved', label: t.filter.approved },
  { value: 'rejected', label: t.filter.rejected },
]

type ListState =
  | { status: 'loading' }
  | { status: 'loaded'; result: Paginated<AccessRequestDetail> }
  | { status: 'error'; message: string }
  | { status: 'forbidden' }

type CatalogState = { roles: Role[]; departments: Department[] } | null

type ApproveState =
  | { open: false }
  | {
      open: true
      request: AccessRequestDetail
      selectedRoleIds: Set<string>
      selectedDepartmentIds: Set<string>
      submitting: boolean
      error: string | null
    }

type RejectState =
  { open: false } | { open: true; request: AccessRequestDetail; submitting: boolean; error: string | null }

type Feedback = { message: string; tone: 'success' | 'warning'; toInvitations?: boolean }

const providerLabel = (provider: AccessRequestDetail['provider']): string => t.provider[provider]

const toggled = (set: Set<string>, id: string): Set<string> => {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export default function AccessRequestsPage() {
  const [statusFilter, setStatusFilter] = useState<AccessRequestStatus>('pending')
  const [page, setPage] = useState(1)
  const [reloadToken, setReloadToken] = useState(0)
  const [state, setState] = useState<ListState>({ status: 'loading' })

  const [catalog, setCatalog] = useState<CatalogState>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  const [approveModal, setApproveModal] = useState<ApproveState>({ open: false })
  const [rejectModal, setRejectModal] = useState<RejectState>({ open: false })
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const resultsRef = useRef<HTMLDivElement>(null)
  const focusResultsAfterLoad = useRef(false)

  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => {
        if (!cancelled) setState({ status: 'loading' })
      })
      .then(() => adminApi.listAccessRequests({ status: statusFilter, page, pageSize: PAGE_SIZE }))
      .then((result) => {
        if (cancelled) return
        // A decision emptied the last page: step back instead of showing an empty list.
        // State stays `loading`, so the post-decision focus waits for the real page.
        if (result.items.length === 0 && page > 1) setPage(page - 1)
        else setState({ status: 'loaded', result })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 403) setState({ status: 'forbidden' })
        else
          setState({
            status: 'error',
            message: error instanceof ApiError ? (error.detail ?? error.title) : t.loadError,
          })
      })

    return () => {
      cancelled = true
    }
  }, [statusFilter, page, reloadToken])

  // Catalog once, as Invitations does — Approve stays disabled until it loads.
  useEffect(() => {
    let cancelled = false

    Promise.all([adminApi.listRoles(), adminApi.listDepartments()])
      .then(([roles, departments]) => {
        if (!cancelled) setCatalog({ roles, departments })
      })
      .catch(() => {
        if (!cancelled) setCatalogError(t.catalogLoadError)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // After a decision removed the row that held focus, land on the results region once the reload settles.
  useEffect(() => {
    if (state.status !== 'loading' && focusResultsAfterLoad.current) {
      focusResultsAfterLoad.current = false
      resultsRef.current?.focus()
    }
  }, [state])

  const reloadAfterDecision = useCallback(() => {
    focusResultsAfterLoad.current = true
    setReloadToken((token) => token + 1)
  }, [])

  const handleFilterChange = useCallback((value: AccessRequestStatus) => {
    setStatusFilter(value)
    setPage(1)
  }, [])

  // -------------------------------------------------------------------------
  // Approve (F2)
  // -------------------------------------------------------------------------

  const handleApproveOpen = useCallback((request: AccessRequestDetail) => {
    setApproveModal({
      open: true,
      request,
      selectedRoleIds: new Set(),
      selectedDepartmentIds: new Set(),
      submitting: false,
      error: null,
    })
  }, [])

  const handleApproveSubmit = useCallback(async () => {
    if (!approveModal.open) return
    const { request, selectedRoleIds, selectedDepartmentIds } = approveModal
    setApproveModal((prev) => (prev.open ? { ...prev, submitting: true, error: null } : prev))
    try {
      const result = await adminApi.approveAccessRequest(request.id, {
        roleIds: Array.from(selectedRoleIds),
        departmentIds: Array.from(selectedDepartmentIds),
      })
      setApproveModal({ open: false })
      setFeedback(
        result.invitation.emailDelivery === 'sent'
          ? { message: t.approved(request.email), tone: 'success' }
          : { message: t.approvedEmailFailed(request.email), tone: 'warning', toInvitations: true },
      )
      reloadAfterDecision()
    } catch (error) {
      const outcome = accessRequestOutcomeFor(error, request.email, 'approve')
      if (outcome.kind === 'forbidden') {
        setApproveModal({ open: false })
        setState({ status: 'forbidden' })
      } else if (outcome.kind === 'refresh') {
        setApproveModal({ open: false })
        setFeedback({ message: outcome.message, tone: 'warning' })
        reloadAfterDecision()
      } else {
        setApproveModal((prev) => (prev.open ? { ...prev, submitting: false, error: outcome.message } : prev))
      }
    }
  }, [approveModal, reloadAfterDecision])

  // -------------------------------------------------------------------------
  // Reject (F3)
  // -------------------------------------------------------------------------

  const handleRejectConfirm = useCallback(async () => {
    if (!rejectModal.open) return
    const { request } = rejectModal
    setRejectModal((prev) => (prev.open ? { ...prev, submitting: true, error: null } : prev))
    try {
      await adminApi.rejectAccessRequest(request.id)
      setRejectModal({ open: false })
      setFeedback({ message: t.rejected(request.email), tone: 'success' })
      reloadAfterDecision()
    } catch (error) {
      const outcome = accessRequestOutcomeFor(error, request.email, 'reject')
      if (outcome.kind === 'forbidden') {
        setRejectModal({ open: false })
        setState({ status: 'forbidden' })
      } else if (outcome.kind === 'refresh') {
        setRejectModal({ open: false })
        setFeedback({ message: outcome.message, tone: 'warning' })
        reloadAfterDecision()
      } else {
        setRejectModal((prev) => (prev.open ? { ...prev, submitting: false, error: outcome.message } : prev))
      }
    }
  }, [rejectModal, reloadAfterDecision])

  // -------------------------------------------------------------------------
  // Table — columns depend on the filter so none is empty
  // -------------------------------------------------------------------------

  const baseColumns: DataTableColumn<AccessRequestDetail>[] = [
    { id: 'email', header: strings.common.fields.email, rowHeader: true, render: (request) => request.email },
    { id: 'name', header: t.columns.name, render: (request) => request.name },
    { id: 'provider', header: t.columns.provider, render: (request) => providerLabel(request.provider) },
    { id: 'lastAsked', header: t.columns.lastAsked, render: (request) => formatDateTime(request.requestedAt) },
  ]

  const pendingColumns: DataTableColumn<AccessRequestDetail>[] = [
    ...baseColumns,
    {
      id: 'actions',
      header: <span className="sr-only">{strings.common.actionsColumn}</span>,
      render: (request) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            onClick={() => handleApproveOpen(request)}
            disabled={!catalog}
            aria-label={t.approveLabel(request.email)}
            data-testid={`access-request-approve-${request.id}`}
          >
            {t.approve}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setRejectModal({ open: true, request, submitting: false, error: null })}
            aria-label={t.rejectLabel(request.email)}
            data-testid={`access-request-reject-${request.id}`}
          >
            {t.reject}
          </Button>
        </div>
      ),
    },
  ]

  const decidedColumns: DataTableColumn<AccessRequestDetail>[] = [
    ...baseColumns,
    { id: 'state', header: t.columns.state, render: (request) => <AccessRequestStatusBadge status={request.status} /> },
    {
      id: 'decidedBy',
      header: t.columns.decidedBy,
      render: (request) => request.decidedBy?.name ?? request.decidedBy?.email ?? strings.common.emptyValue,
    },
    {
      id: 'decidedOn',
      header: t.columns.decidedOn,
      render: (request) => (request.decidedAt ? formatDateTime(request.decidedAt) : strings.common.emptyValue),
    },
  ]

  if (state.status === 'forbidden') {
    return (
      <section data-testid="admin-access-requests-page">
        <UsersSubNav />
        <PermissionDenied />
      </section>
    )
  }

  const feedbackBanner = feedback?.toInvitations ? (
    <Banner
      tone="warning"
      compact
      onDismiss={() => setFeedback(null)}
      dismissLabel={strings.common.actions.dismiss}
      dismissTestId="access-requests-announcement-dismiss"
      data-testid="access-requests-announcement-banner"
      className="mt-4"
      actions={
        <Link
          to="/users/invitations"
          className={buttonClassName({ variant: 'secondary', size: 'sm' })}
          data-testid="access-requests-open-invitations"
        >
          {t.goToInvitations}
        </Link>
      }
    >
      <span data-testid="access-requests-announcement">{feedback.message}</span>
    </Banner>
  ) : (
    <SuccessBanner
      message={feedback?.message ?? null}
      tone={feedback?.tone}
      onDismiss={() => setFeedback(null)}
      testId="access-requests-announcement"
      className="mt-4"
    />
  )

  return (
    <section aria-labelledby="admin-access-requests-heading" data-testid="admin-access-requests-page">
      {approveModal.open && catalog && (
        <ApproveAccessRequestModal
          name={approveModal.request.name}
          email={approveModal.request.email}
          roles={catalog.roles}
          departments={catalog.departments}
          selectedRoleIds={approveModal.selectedRoleIds}
          onToggleRole={(id) =>
            setApproveModal((prev) =>
              prev.open ? { ...prev, selectedRoleIds: toggled(prev.selectedRoleIds, id) } : prev,
            )
          }
          selectedDepartmentIds={approveModal.selectedDepartmentIds}
          onToggleDepartment={(id) =>
            setApproveModal((prev) =>
              prev.open ? { ...prev, selectedDepartmentIds: toggled(prev.selectedDepartmentIds, id) } : prev,
            )
          }
          onSubmit={() => void handleApproveSubmit()}
          onCancel={() => setApproveModal({ open: false })}
          submitting={approveModal.submitting}
          error={approveModal.error}
        />
      )}

      {rejectModal.open && (
        <ConfirmDialog
          title={t.rejectDialog.title}
          tone="danger"
          confirmLabel={t.rejectDialog.confirm}
          busyLabel={t.rejectDialog.busy}
          cancelLabel={strings.common.actions.cancel}
          closeLabel={strings.common.actions.cancel}
          busy={rejectModal.submitting}
          error={rejectModal.error}
          onConfirm={() => void handleRejectConfirm()}
          onCancel={() => setRejectModal({ open: false })}
          testIdPrefix="access-request-reject-dialog"
        >
          <p>{t.rejectDialog.body(rejectModal.request.name, rejectModal.request.email)}</p>
        </ConfirmDialog>
      )}

      <UsersSubNav />

      {/* No action button: requests only come from sign-ins, there is nothing to create. */}
      <PageHeader title={t.heading} titleId="admin-access-requests-heading" description={t.description} />

      {catalogError && <ErrorBanner message={catalogError} />}

      {feedbackBanner}

      <div className="mt-4">
        <label htmlFor="access-requests-status-filter" className="sr-only">
          {t.filterLabel}
        </label>
        <select
          id="access-requests-status-filter"
          value={statusFilter}
          onChange={(e) => handleFilterChange(e.target.value as AccessRequestStatus)}
          data-testid="access-requests-status-filter"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div
        ref={resultsRef}
        tabIndex={-1}
        className="mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acc-hi"
        data-testid="access-requests-results"
      >
        {state.status === 'loading' && <SkeletonListRows rows={5} label={t.loading} />}

        {state.status === 'error' && (
          <ErrorBanner message={state.message} onRetry={() => setReloadToken((token) => token + 1)} />
        )}

        {state.status === 'loaded' && state.result.total === 0 && (
          <StatePanel title={t.empty[statusFilter].title} testId="access-requests-empty-state">
            {t.empty[statusFilter].body}
          </StatePanel>
        )}

        {state.status === 'loaded' && state.result.total > 0 && (
          <>
            <DataTable
              caption={t.caption}
              columns={statusFilter === 'pending' ? pendingColumns : decidedColumns}
              rows={state.result.items}
              getRowKey={(request) => request.id}
              testId="access-requests-table"
              rowTestIdPrefix="access-request-row"
            />
            <Pagination page={page} pageSize={PAGE_SIZE} total={state.result.total} onPageChange={setPage} />
          </>
        )}
      </div>
    </section>
  )
}
