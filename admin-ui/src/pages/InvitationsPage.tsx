/**
 * InvitationsPage — Screen U2 (design.md "Invitations list", T12,
 * specs/20260713-user-invitations). Route `/users/invitations` (../router.tsx,
 * registered in T10 pointing at this same file — the T10 placeholder is
 * fully replaced here).
 *
 * Paginated, searchable (`?q=` on email, same pattern as UsersPage.tsx),
 * status-filterable (`GET /admin/invitations?status=&q=`) list, plus:
 *   - Modal N1 ("Invite user" — `InviteUserModal.tsx`): email + optional
 *     role/department checkboxes → `POST /admin/invitations`. A 201 ALWAYS
 *     closes the modal (the invitation itself succeeded) regardless of
 *     `emailDelivery` — a send failure is surfaced on the row afterward, not
 *     as a modal error (design.md F1 step 3). 409 (active user / live
 *     pending invite — AC-1.3/1.4) and 422 (unknown role/department id) map
 *     onto the modal's `emailError`/`generalError` slots.
 *   - Per-row Resend (pending/expired only — AC-3.4 hides it entirely for
 *     accepted/revoked rows, no confirm dialog: resend isn't destructive) and
 *     Revoke (pending/expired only, terminal — confirmed via the extended
 *     `ConfirmDeleteModal`).
 *   - `InvitationStatusBadge` + a persistent inline "Email failed" indicator
 *     next to Resend when `emailDelivery === 'failed'` (never a toast — the
 *     admin must not miss a failed send).
 *
 * States mirror every other admin-ui list screen (design.md "L/E/P/Err"),
 * same pattern as ../pages/UsersPage.tsx / ../pages/AuditPage.tsx. Built as
 * explicit Promise chains in effects, not async/await — see
 * ../pages/AuditPage.tsx's doc comment for the full rationale
 * (`react-hooks/set-state-in-effect` false positive).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, DataTable, Icon, PageHeader, StatePanel, formatDateTime } from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import * as adminApi from '../lib/adminApi'
import type { Department, EffectiveInvitationStatus, InvitationDetail, Paginated, Role } from '../lib/adminApi'
import { ApiError } from '../lib/adminApi'
import SkeletonListRows from '../components/SkeletonListRows'
import ErrorBanner from '../components/ErrorBanner'
import Pagination from '../components/Pagination'
import UsersSubNav from '../components/UsersSubNav'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import SuccessBanner from '../components/SuccessBanner'
import InviteUserModal from '../components/InviteUserModal'
import InvitationStatusBadge from '../components/InvitationStatusBadge'
import { domainNotAllowedMessage, inviteConflictMessageFor } from '../lib/inviteConflict'
import { strings } from '../strings'

const t = strings.invitations

const PAGE_SIZE = 20

const STATUS_OPTIONS: { value: EffectiveInvitationStatus | ''; label: string }[] = [
  { value: '', label: t.filterAll },
  { value: 'pending', label: strings.badges.invitationStatus.pending },
  { value: 'accepted', label: strings.badges.invitationStatus.accepted },
  { value: 'expired', label: strings.badges.invitationStatus.expired },
  { value: 'revoked', label: strings.badges.invitationStatus.revoked },
]

/** Rows past their terminal state have nothing left to do (design.md F1a step 4). */
const isActionable = (status: EffectiveInvitationStatus): boolean => status === 'pending' || status === 'expired'

/** design.md F1a — "expires in Xh"/"expired Xh ago" restated in words, never a bare countdown. */
const formatExpiry = (invitation: InvitationDetail): string => {
  const absolute = formatDateTime(invitation.expiresAt)

  if (invitation.status === 'accepted' && invitation.acceptedAt) {
    return t.expiry.accepted(formatDateTime(invitation.acceptedAt))
  }
  if (invitation.status === 'revoked') {
    return t.expiry.revoked(absolute)
  }
  if (invitation.status === 'expired') {
    return t.expiry.expired(absolute)
  }
  return t.expiry.expires(absolute)
}

const errorMessageFor = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) return error.detail ?? error.title
  return fallback
}

type ListState =
  | { status: 'loading' }
  | { status: 'loaded'; result: Paginated<InvitationDetail> }
  | { status: 'error'; message: string }

type CatalogState = { roles: Role[]; departments: Department[] } | null

type InviteModalState =
  | { open: false }
  | {
      open: true
      email: string
      selectedRoleIds: Set<string>
      selectedDepartmentIds: Set<string>
      submitting: boolean
      emailError: string | null
      generalError: string | null
    }

type RevokeModalState =
  { open: false } | { open: true; invitation: InvitationDetail; isRevoking: boolean; error: string | null }

export default function InvitationsPage() {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<EffectiveInvitationStatus | ''>('')
  const [page, setPage] = useState(1)
  const [reloadToken, setReloadToken] = useState(0)
  const [state, setState] = useState<ListState>({ status: 'loading' })

  const [catalog, setCatalog] = useState<CatalogState>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  const [inviteModal, setInviteModal] = useState<InviteModalState>({ open: false })
  const [revokeModal, setRevokeModal] = useState<RevokeModalState>({ open: false })
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  // INC-19: invite / resend / revoke confirmations; `warning` when the email failed to send.
  const [feedback, setFeedback] = useState<{ message: string; tone: 'success' | 'warning' } | null>(null)

  // Fetch the current page/filters whenever they (or `reloadToken`) change.
  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => {
        if (!cancelled) setState({ status: 'loading' })
      })
      .then(() =>
        adminApi.listInvitations({
          q: query || undefined,
          status: statusFilter || undefined,
          page,
          pageSize: PAGE_SIZE,
        }),
      )
      .then((result) => {
        if (!cancelled) setState({ status: 'loaded', result })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: errorMessageFor(error, t.loadError) })
      })

    return () => {
      cancelled = true
    }
  }, [query, statusFilter, page, reloadToken])

  // Fetch the role/department catalogs once — needed by InviteUserModal's
  // two checkbox fieldsets whenever it opens.
  useEffect(() => {
    let cancelled = false

    Promise.all([adminApi.listRoles(), adminApi.listDepartments()])
      .then(([roles, departments]) => {
        if (!cancelled) setCatalog({ roles, departments })
      })
      .catch((error: unknown) => {
        if (!cancelled) setCatalogError(errorMessageFor(error, t.catalogLoadError))
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    setPage(1)
  }, [])

  const handleStatusFilterChange = useCallback((value: EffectiveInvitationStatus | '') => {
    setStatusFilter(value)
    setPage(1)
  }, [])

  const handleRetry = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  // ---------------------------------------------------------------------------
  // Modal N1 — Invite user (design.md F1)
  // ---------------------------------------------------------------------------

  const handleInviteOpen = useCallback(() => {
    setInviteModal({
      open: true,
      email: '',
      selectedRoleIds: new Set(),
      selectedDepartmentIds: new Set(),
      submitting: false,
      emailError: null,
      generalError: null,
    })
  }, [])

  const handleInviteCancel = useCallback(() => {
    setInviteModal({ open: false })
  }, [])

  const handleInviteEmailChange = useCallback((value: string) => {
    setInviteModal((prev) => (prev.open ? { ...prev, email: value, emailError: null } : prev))
  }, [])

  const handleToggleInviteRole = useCallback((id: string) => {
    setInviteModal((prev) => {
      if (!prev.open) return prev
      const next = new Set(prev.selectedRoleIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...prev, selectedRoleIds: next }
    })
  }, [])

  const handleToggleInviteDepartment = useCallback((id: string) => {
    setInviteModal((prev) => {
      if (!prev.open) return prev
      const next = new Set(prev.selectedDepartmentIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...prev, selectedDepartmentIds: next }
    })
  }, [])

  const handleInviteSubmit = useCallback(async () => {
    if (!inviteModal.open) return
    const { email, selectedRoleIds, selectedDepartmentIds } = inviteModal
    setInviteModal((prev) => (prev.open ? { ...prev, submitting: true, emailError: null, generalError: null } : prev))
    try {
      const created = await adminApi.createInvitation({
        email: email.trim(),
        roleIds: Array.from(selectedRoleIds),
        departmentIds: Array.from(selectedDepartmentIds),
      })
      // A 201 ALWAYS closes the modal (design.md F1 step 3) — the invitation
      // itself succeeded regardless of the email delivery outcome, which is
      // surfaced on the new row instead (never blocks/errors the modal).
      setInviteModal({ open: false })
      setFeedback(
        created.emailDelivery === 'sent'
          ? { message: strings.users.invite.sent(created.email), tone: 'success' }
          : { message: strings.users.invite.emailFailed(created.email), tone: 'warning' },
      )
      setReloadToken((token) => token + 1)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setInviteModal((prev) =>
          prev.open ? { ...prev, submitting: false, emailError: inviteConflictMessageFor(error.detail) } : prev,
        )
        return
      }
      if (error instanceof ApiError && error.status === 422 && error.code === 'domain_not_allowed') {
        setInviteModal((prev) =>
          prev.open ? { ...prev, submitting: false, emailError: domainNotAllowedMessage(error) } : prev,
        )
        return
      }
      if (error instanceof ApiError && error.status === 422) {
        setInviteModal((prev) =>
          prev.open
            ? {
                ...prev,
                submitting: false,
                generalError: error.detail ?? strings.users.invite.stale,
              }
            : prev,
        )
        return
      }
      setInviteModal((prev) =>
        prev.open
          ? {
              ...prev,
              submitting: false,
              generalError: errorMessageFor(error, strings.users.invite.createFailed),
            }
          : prev,
      )
    }
  }, [inviteModal])

  // ---------------------------------------------------------------------------
  // Resend (design.md F1a step 2 — no confirm, not destructive)
  // ---------------------------------------------------------------------------

  const handleResend = useCallback(async (invitation: InvitationDetail) => {
    setResendingId(invitation.id)
    setRowError(null)
    try {
      const updated = await adminApi.resendInvitation(invitation.id)
      setState((prev) =>
        prev.status === 'loaded'
          ? {
              status: 'loaded',
              result: { ...prev.result, items: prev.result.items.map((i) => (i.id === updated.id ? updated : i)) },
            }
          : prev,
      )
      setFeedback({ message: t.resent(updated.email), tone: 'success' })
    } catch (error) {
      setRowError({ id: invitation.id, message: errorMessageFor(error, t.resendFailed) })
    } finally {
      setResendingId(null)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Revoke (Dialog N2 — design.md F1a step 3, terminal)
  // ---------------------------------------------------------------------------

  const handleRevokeRequest = useCallback((invitation: InvitationDetail) => {
    setRevokeModal({ open: true, invitation, isRevoking: false, error: null })
  }, [])

  const handleRevokeCancel = useCallback(() => {
    setRevokeModal({ open: false })
  }, [])

  const handleRevokeConfirm = useCallback(async () => {
    if (!revokeModal.open) return
    const { invitation } = revokeModal
    setRevokeModal((prev) => (prev.open ? { ...prev, isRevoking: true, error: null } : prev))
    try {
      const updated = await adminApi.revokeInvitation(invitation.id)
      setState((prev) =>
        prev.status === 'loaded'
          ? {
              status: 'loaded',
              result: { ...prev.result, items: prev.result.items.map((i) => (i.id === updated.id ? updated : i)) },
            }
          : prev,
      )
      setRevokeModal({ open: false })
      setFeedback({ message: t.revoked(updated.email), tone: 'success' })
    } catch (error) {
      // AC-1.10/1.11's race — the invitation became accepted/revoked between
      // page-load and click. Surfaced inline in the dialog so the admin sees
      // why it didn't apply (design.md F1a step 3), not assumed impossible.
      setRevokeModal((prev) =>
        prev.open
          ? { ...prev, isRevoking: false, error: errorMessageFor(error, t.revokeFailed) }
          : prev,
      )
    }
  }, [revokeModal])

  const revokeBody = useMemo(() => {
    if (!revokeModal.open) return null
    return <p>{t.revokeBody(revokeModal.invitation.email)}</p>
  }, [revokeModal])

  // INC-14: the library DataTable — the invited email is the row header.
  const invitationColumns: DataTableColumn<InvitationDetail>[] = [
    { id: 'email', header: strings.common.fields.email, rowHeader: true, render: (invitation) => invitation.email },
    {
      id: 'state',
      header: t.columns.state,
      render: (invitation) => <InvitationStatusBadge status={invitation.status} />,
    },
    {
      id: 'roles',
      header: strings.common.fields.roles,
      render: (invitation) =>
        invitation.roles.length > 0 ? invitation.roles.map((r) => r.name).join(', ') : strings.common.noneOption,
    },
    {
      id: 'departments',
      header: strings.common.fields.departments,
      render: (invitation) =>
        invitation.departments.length > 0
          ? invitation.departments.map((d) => d.name).join(', ')
          : strings.common.noneOption,
    },
    {
      id: 'invitedBy',
      header: t.columns.invitedBy,
      render: (invitation) => invitation.invitedBy?.name ?? invitation.invitedBy?.email ?? strings.common.emptyValue,
    },
    { id: 'expires', header: t.columns.expires, render: (invitation) => formatExpiry(invitation) },
    {
      id: 'actions',
      header: <span className="sr-only">{strings.common.actionsColumn}</span>,
      render: (invitation) =>
        isActionable(invitation.status) ? (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                onClick={() => void handleResend(invitation)}
                disabled={resendingId === invitation.id}
                busy={resendingId === invitation.id}
                aria-label={t.resendLabel(invitation.email)}
                data-testid={`invitation-resend-${invitation.id}`}
              >
                {resendingId === invitation.id ? t.resending : t.resend}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleRevokeRequest(invitation)}
                aria-label={t.revokeLabel(invitation.email)}
                data-testid={`invitation-revoke-${invitation.id}`}
              >
                {t.revoke}
              </Button>
            </div>
            {invitation.emailDelivery === 'failed' && (
              // A genuine warning, not an error: orange as text is the -text token (INC-20).
              <span
                data-testid={`invitation-email-failed-${invitation.id}`}
                className="inline-flex items-center gap-1 text-2xs text-org-text"
              >
                <Icon name="alert" />
                {t.emailFailed}
              </span>
            )}
            {rowError?.id === invitation.id && (
              // A failed action: red (INC-20).
              <p role="alert" className="text-2xs text-red-text">
                {rowError.message}
              </p>
            )}
          </div>
        ) : (
          <span className="sr-only">{t.noActions}</span>
        ),
    },
  ]

  return (
    <section aria-labelledby="admin-invitations-heading" data-testid="admin-invitations-page">
      {inviteModal.open && catalog && (
        <InviteUserModal
          email={inviteModal.email}
          onEmailChange={handleInviteEmailChange}
          roles={catalog.roles}
          departments={catalog.departments}
          selectedRoleIds={inviteModal.selectedRoleIds}
          onToggleRole={handleToggleInviteRole}
          selectedDepartmentIds={inviteModal.selectedDepartmentIds}
          onToggleDepartment={handleToggleInviteDepartment}
          onSubmit={() => void handleInviteSubmit()}
          onCancel={handleInviteCancel}
          submitting={inviteModal.submitting}
          emailError={inviteModal.emailError}
          generalError={inviteModal.generalError}
        />
      )}

      {revokeModal.open && (
        <ConfirmDeleteModal
          title={t.revokeTitle}
          itemName={revokeModal.invitation.email}
          body={revokeBody}
          isDeleting={revokeModal.isRevoking}
          errorMessage={revokeModal.error}
          onConfirm={() => void handleRevokeConfirm()}
          onCancel={handleRevokeCancel}
        />
      )}

      <UsersSubNav />

      <PageHeader
        title={t.heading}
        titleId="admin-invitations-heading"
        actions={
          <Button
            variant="primary"
            onClick={handleInviteOpen}
            disabled={!catalog}
            data-testid="invitations-invite-button"
          >
            {strings.users.inviteUser}
          </Button>
        }
      />

      {catalogError && <ErrorBanner message={catalogError} />}

      <SuccessBanner
        message={feedback?.message ?? null}
        tone={feedback?.tone}
        onDismiss={() => setFeedback(null)}
        testId="invitations-announcement"
        className="mt-4"
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div>
          <label htmlFor="invitations-search-input" className="sr-only">
            {t.searchLabel}
          </label>
          <input
            id="invitations-search-input"
            type="search"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder={t.searchPlaceholder}
            data-testid="invitations-search-input"
            className="w-full sm:w-72"
          />
        </div>

        <div>
          <label htmlFor="invitations-status-filter" className="sr-only">
            {t.filterLabel}
          </label>
          <select
            id="invitations-status-filter"
            value={statusFilter}
            onChange={(e) => handleStatusFilterChange(e.target.value as EffectiveInvitationStatus | '')}
            data-testid="invitations-status-filter"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4">
        {state.status === 'loading' && <SkeletonListRows rows={5} />}

        {state.status === 'error' && <ErrorBanner message={state.message} onRetry={handleRetry} />}

        {state.status === 'loaded' && state.result.total === 0 && (
          // No repeated action: the page header's "Invite user" is the one primary (design-system.md).
          <StatePanel
            title={query || statusFilter ? t.emptyFiltered.title : t.empty.title}
            testId="invitations-empty-state"
          >
            {query || statusFilter ? t.emptyFiltered.body : t.empty.body}
          </StatePanel>
        )}

        {state.status === 'loaded' && state.result.total > 0 && (
          <>
            <DataTable
              caption={t.caption}
              columns={invitationColumns}
              rows={state.result.items}
              getRowKey={(invitation) => invitation.id}
              testId="invitations-table"
              rowTestIdPrefix="invitation-row"
            />

            <Pagination page={page} pageSize={PAGE_SIZE} total={state.result.total} onPageChange={setPage} />
          </>
        )}
      </div>
    </section>
  )
}
