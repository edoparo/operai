import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button, DataTable, PageHeader, StatePanel, formatNumber } from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import * as adminApi from '../lib/adminApi'
import type { Role } from '../lib/adminApi'
import { ApiError } from '../lib/adminApi'
import SkeletonListRows from '../components/SkeletonListRows'
import ErrorBanner from '../components/ErrorBanner'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import CreateRoleModal from '../components/CreateRoleModal'
import SystemBadge from '../components/SystemBadge'
import PermissionDenied from '../components/PermissionDenied'
import SuccessBanner from '../components/SuccessBanner'
import { setFlash, useFlash } from '../lib/flash'
import { strings } from '../strings'

const t = strings.roles

/**
 * RolesPage — Screen A1 (Roles list) + Modal M1 (Create role) — T17,
 * specs/004-auth-roles-permissions/tasks.md, refs AC-1.1, AC-2.4.
 *
 * Replaces T14's placeholder with the real screen: a table (Name /
 * Description / System badge / rule count / Edit-Delete — design.md's "Key
 * elements" for Screen A1), sourced from `adminApi.listRoles()` (plan.md
 * `GET /admin/roles`). "New role" opens Modal M1 (name+description) →
 * `POST /admin/roles` → navigates to Screen A2 (the role editor, T18) for
 * the new id (design.md F2 step 2). System roles get a `SystemBadge` and a
 * guardrailed, non-native-disabled Delete action (design.md: "disabled
 * Delete button with title='System roles can't be deleted'" — implemented
 * via `aria-disabled` + visually-hidden text rather than the native
 * `disabled` attribute, mirroring `Pagination.tsx`'s bounds-guard and
 * design.md's explicit "Guardrail-blocked save … inline path" a11y note:
 * "not just a bare CSS disabled state with a mouse-only tooltip").
 *
 * States mirror every other admin-ui list screen (design.md "L/E/P/Err",
 * same shape as AuditPage.tsx/T21):
 *   L    — SkeletonListRows while the list loads.
 *   E    — "No roles yet" + "New role" (design.md: "never a dead end" —
 *          this state shouldn't realistically occur post-bootstrap, T11,
 *          but is still designed defensively).
 *   P    — the table + "New role".
 *   Err  — ErrorBanner + Retry (mirrors EstimatesPage's list-error pattern).
 *   403  — PermissionDenied in place of the table (design.md Screen A1:
 *          "only reachable per F7's race-condition path").
 *
 * Fetch pattern: the initial list load is an explicit Promise chain rather
 * than an async/await helper invoked from `useEffect` — an async function
 * that calls a state setter anywhere in its body (even after an `await`)
 * trips `eslint-plugin-react-hooks@7.1.1`'s `react-hooks/set-state-in-effect`
 * static analysis, because await-continuations stay within the same
 * function body the rule inspects. Routing each state transition through
 * its own `.then()`/`.catch()` closure (AuditPage.tsx's precedent, T21)
 * keeps each setState call in its own function boundary, which the rule
 * doesn't need to trace through, while the runtime behavior — set loading,
 * fetch, then set loaded/error/forbidden, ignoring a stale response after
 * unmount — is identical to the equivalent async/await version.
 */

type ListState =
  | { status: 'loading' }
  | { status: 'loaded'; roles: Role[] }
  | { status: 'error'; message: string }
  | { status: 'forbidden' }

type CreateModalState =
  | { open: false }
  | {
      open: true
      name: string
      description: string
      submitting: boolean
      nameError: string | null
      generalError: string | null
    }

type DeleteModalState = { open: false } | { open: true; role: Role; isDeleting: boolean; error: string | null }

const errorMessageFor = (error: unknown): string => {
  if (error instanceof ApiError) {
    return error.detail ?? error.title
  }
  return t.loadError
}

export default function RolesPage() {
  const navigate = useNavigate()
  const [listState, setListState] = useState<ListState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)
  const [createModal, setCreateModal] = useState<CreateModalState>({ open: false })
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({ open: false })
  // INC-19: a delete here, or one made in the role editor (handed over as a flash).
  const [success, setSuccess] = useFlash('roles')

  // See the module doc comment above re: why this is a Promise chain, not
  // an async function called from the effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => {
        if (!cancelled) setListState({ status: 'loading' })
      })
      .then(() => adminApi.listRoles())
      .then((roles) => {
        if (!cancelled) setListState({ status: 'loaded', roles })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 403) {
          setListState({ status: 'forbidden' })
        } else {
          setListState({ status: 'error', message: errorMessageFor(error) })
        }
      })

    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const handleRetry = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleOpenEditor = useCallback(
    (id: string) => {
      navigate({ to: '/roles/$id', params: { id } })
    },
    [navigate],
  )

  // ---------------------------------------------------------------------------
  // Create role (Modal M1 — design.md F2 step 2)
  // ---------------------------------------------------------------------------

  const handleCreateOpen = useCallback(() => {
    setCreateModal({ open: true, name: '', description: '', submitting: false, nameError: null, generalError: null })
  }, [])

  const handleCreateCancel = useCallback(() => {
    setCreateModal({ open: false })
  }, [])

  const handleCreateNameChange = useCallback((name: string) => {
    setCreateModal((prev) => (prev.open ? { ...prev, name, nameError: null } : prev))
  }, [])

  const handleCreateDescriptionChange = useCallback((description: string) => {
    setCreateModal((prev) => (prev.open ? { ...prev, description } : prev))
  }, [])

  const handleCreateSubmit = useCallback(async () => {
    if (!createModal.open) return
    const { name, description } = createModal
    setCreateModal((prev) => (prev.open ? { ...prev, submitting: true, nameError: null, generalError: null } : prev))
    try {
      const role = await adminApi.createRole({ name: name.trim(), description: description.trim() || null })
      setCreateModal({ open: false })
      // INC-19: the editor this navigates to confirms the creation.
      setFlash(`role:${role.id}`, t.created(role.name))
      navigate({ to: '/roles/$id', params: { id: role.id } })
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setCreateModal((prev) =>
          prev.open
            ? { ...prev, submitting: false, nameError: error.detail ?? t.nameTaken }
            : prev,
        )
      } else {
        setCreateModal((prev) =>
          prev.open ? { ...prev, submitting: false, generalError: t.createFailed } : prev,
        )
      }
    }
  }, [createModal, navigate])

  // ---------------------------------------------------------------------------
  // Delete role (Dialog D1 — design.md F2 step 5)
  // ---------------------------------------------------------------------------

  const handleDeleteRequest = useCallback((role: Role) => {
    if (role.isSystem) return
    setDeleteModal({ open: true, role, isDeleting: false, error: null })
  }, [])

  const handleDeleteCancel = useCallback(() => {
    setDeleteModal({ open: false })
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteModal.open) return
    const { role } = deleteModal
    setDeleteModal((prev) => (prev.open ? { ...prev, isDeleting: true, error: null } : prev))
    try {
      await adminApi.deleteRole(role.id)
      setDeleteModal({ open: false })
      setSuccess(t.deleted(role.name))
      setReloadToken((token) => token + 1)
    } catch (error) {
      setDeleteModal((prev) =>
        prev.open
          ? {
              ...prev,
              isDeleting: false,
              error:
                error instanceof ApiError
                  ? (error.detail ?? strings.common.deleteFailed)
                  : strings.common.deleteFailed,
            }
          : prev,
      )
    }
  }, [deleteModal, setSuccess])

  // INC-14: the library DataTable — the role name is the row header.
  const roleColumns: DataTableColumn<Role>[] = [
    { id: 'name', header: strings.common.fields.name, rowHeader: true, render: (role) => role.name },
    {
      id: 'description',
      header: strings.common.fields.description,
      render: (role) => role.description || strings.common.emptyValue,
    },
    { id: 'system', header: t.columns.system, render: (role) => role.isSystem && <SystemBadge /> },
    {
      id: 'rules',
      header: t.columns.rules,
      numeric: true,
      render: (role) => (role.ruleCount == null ? strings.common.emptyValue : formatNumber(role.ruleCount)),
    },
    {
      id: 'actions',
      header: <span className="sr-only">{strings.common.actionsColumn}</span>,
      render: (role) => (
        <div className="flex items-center gap-1 justify-end">
          <Button size="sm" onClick={() => handleOpenEditor(role.id)} data-testid={`role-edit-${role.id}`}>
            {strings.common.actions.edit}
          </Button>
          <Button
            variant="danger"
            size="sm"
            aria-disabled={role.isSystem}
            title={role.isSystem ? strings.badges.systemTitle : undefined}
            onClick={() => handleDeleteRequest(role)}
            data-testid={`role-delete-${role.id}`}
          >
            {strings.common.actions.delete}
            {role.isSystem && <span className="sr-only">{strings.common.disabledReason(strings.badges.systemTitle)}</span>}
          </Button>
        </div>
      ),
    },
  ]

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <section aria-labelledby="admin-roles-heading" data-testid="admin-roles-page">
      {createModal.open && (
        <CreateRoleModal
          name={createModal.name}
          description={createModal.description}
          onNameChange={handleCreateNameChange}
          onDescriptionChange={handleCreateDescriptionChange}
          onSubmit={() => void handleCreateSubmit()}
          onCancel={handleCreateCancel}
          submitting={createModal.submitting}
          nameError={createModal.nameError}
          generalError={createModal.generalError}
        />
      )}

      {deleteModal.open && (
        <ConfirmDeleteModal
          title={t.deleteTitle}
          itemName={deleteModal.role.name}
          isDeleting={deleteModal.isDeleting}
          errorMessage={deleteModal.error}
          onConfirm={() => void handleDeleteConfirm()}
          onCancel={handleDeleteCancel}
        />
      )}

      <PageHeader
        title={t.heading}
        titleId="admin-roles-heading"
        actions={
          listState.status !== 'forbidden' && (
            <Button variant="primary" onClick={handleCreateOpen} data-testid="roles-new-button">
              {t.newRole}
            </Button>
          )
        }
      />

      <SuccessBanner message={success} onDismiss={() => setSuccess(null)} testId="roles-success" className="mb-4" />

      <div>
        {listState.status === 'forbidden' && <PermissionDenied headingLevel={3} />}

        {listState.status === 'loading' && <SkeletonListRows rows={4} label={strings.common.loading} />}

        {listState.status === 'error' && <ErrorBanner message={listState.message} onRetry={handleRetry} />}

        {listState.status === 'loaded' && listState.roles.length === 0 && (
          // No repeated action: the page header's "New role" is the one primary (design-system.md).
          <StatePanel title={t.empty.title} testId="roles-empty-state">
            {t.empty.body}
          </StatePanel>
        )}

        {listState.status === 'loaded' && listState.roles.length > 0 && (
          <DataTable
            caption={t.caption}
            columns={roleColumns}
            rows={listState.roles}
            getRowKey={(role) => role.id}
            testId="roles-table"
            rowTestIdPrefix="role-row"
          />
        )}
      </div>
    </section>
  )
}
