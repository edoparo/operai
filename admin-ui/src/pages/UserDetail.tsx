/**
 * UserDetail — Screen C2 (design.md "User detail — attributes + role/department
 * assignment + the AC-6.4 last-admin GuardrailDialog D2", T20,
 * specs/20260713-auth-roles-permissions/tasks.md). Mounted at `/users/$id`
 * (../router.tsx).
 *
 * Three independently-saved sections, matching design.md's F4/Screen C2 split
 * (each a distinct API call, plan.md's contract):
 *   - Identity — name/email, read-only.
 *   - Attributes — `entity` select + `jobTitle` text → `PATCH /admin/users/:id`.
 *   - Direct roles — a checkbox fieldset (every catalog role) → `PUT
 *     /admin/users/:id/roles` `{ roleIds }`.
 *   - Departments — a checkbox fieldset (every department) → `PUT
 *     /admin/users/:id/departments` `{ departmentIds }`.
 * Roles/departments render as a native checkbox `<fieldset>` rather than a
 * `<select multiple>` — this repo's a11y posture is "every new interactive
 * element is a native `<button>/<select>/<input>/<a>`" (design.md
 * "Accessibility — Keyboard operation"), and a checkbox-per-option list reads
 * and operates far better than a multi-select listbox for this size of set.
 *
 * A short "Effective immediately" hint sits near the roles/departments Save
 * buttons (design.md F4 step 4: "no separate 'publish' step").
 *
 * **Guardrail (AC-6.4):** if a roles/departments save returns `422` (the
 * server's last-admin guard — plan.md), GuardrailDialog (D2, T15) surfaces
 * the fixed message design.md prescribes verbatim. Critically, the pending
 * edit (the checkbox selection the admin was about to save) is NOT reset
 * when the dialog is dismissed — it lives in its own `selectedRoleIds` /
 * `selectedDepartmentIds` state, untouched by the failed save, so the admin
 * can immediately adjust (e.g. re-check `admin`) and retry (design.md: "the
 * in-progress edit is preserved so the admin can adjust and retry").
 *
 * States mirror every other admin-ui screen (design.md "L/E/P/Err"):
 *   L — SkeletonListRows while `GET /admin/users/:id` + the roles/departments
 *       catalogs resolve.
 *   Err — ErrorBanner + Retry (re-fetches everything).
 *   P — the three sections described above.
 *
 * Built as explicit Promise chains in effects/handlers, not async/await — see
 * ../pages/AuditPage.tsx's doc comment for the full rationale
 * (`react-hooks/set-state-in-effect` false positive on an async function that
 * calls a state setter after an `await`).
 *
 * --- Design-fidelity gap closed post-T10 (design.md Screen U3, specs/20260713-user-invitations) ---
 * Gains: a "Delete user" button in the header area — the SAME `ConfirmDeleteModal`
 * (soft-delete `body` copy) and the SAME `adminApi.deleteUser` call
 * `UsersPage.tsx`'s row action already uses (T10), wired independently here
 * because this is a different screen (mirrors how `RoleEditor.tsx`'s own
 * delete-then-navigate wiring is independent from `RolesPage.tsx`'s row
 * delete, even though both call the same `adminApi.deleteRole`). Same
 * guardrails: the caller's own detail page renders the button
 * disabled-with-explanation (`aria-disabled` + `title` + sr-only text,
 * `shell/session`'s `useSession()` for self-identity — same convention as
 * Screen U1), and a `422` (last-admin guard, AC-5.5) surfaces via
 * `GuardrailDialog`, same shape as every other guardrail on this page. On
 * success, navigates back to `/users` (mirrors `RoleEditor.tsx`'s
 * delete-then-navigate-to-list pattern, design.md Screen U3).
 *
 * --- Address section (T12, specs/20260803-employee-address/tasks.md, AC-4.2) ---
 * A fourth, independently-loaded block: `AddressSection` (T11), mounted
 * ONLY for a caller who holds the literal `admin` role — plan.md's Constraint
 * that this feature reuses the EXISTING `requireAdmin` gate rather than
 * minting a new catalog permission (deliberate counterpoint to ADR 20260722-settings-catalog-permission-config-not-rate).
 * Resolved at render from `shell/session`'s `usePermissions().roles` (the
 * shell's cached `GET /authz/me`, the suite's one permissions mechanism;
 * INC-32). A failed permissions fetch resolves to no grants, so the section
 * fails CLOSED (hidden, not a crash): UX-only,
 * never the actual security boundary (that is `auth`'s server-side
 * `requireAdmin` on `GET`/`PUT /admin/users/:id/address`, AC-4.1). AC-4.2
 * requires ABSENCE, not a disabled variant — a denied caller's DOM has no
 * `data-testid="address-section"` node at all, and no address fetch of any
 * kind is ever issued for them. Scope note (design.md "Gaps" #3): this
 * hide-if-uncapable pattern is deliberately NOT retro-applied to the
 * Attributes/Roles/Departments sections above — out of this feature's scope.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Button, Card, CheckboxGroupField, FactList, Field, Icon, PageHeader } from '@operai/ui'
import { usePermissions, useSession } from 'shell/session'
import * as adminApi from '../lib/adminApi'
import type { Department, Role, UserDetail as UserDetailData, UserEntity } from '../lib/adminApi'
import { ApiError } from '../lib/adminApi'
import SkeletonListRows from '../components/SkeletonListRows'
import ErrorBanner from '../components/ErrorBanner'
import GuardrailDialog from '../components/GuardrailDialog'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import AddressSection from '../components/AddressSection'
import SuccessBanner from '../components/SuccessBanner'
import { setFlash } from '../lib/flash'
import { strings } from '../strings'

const t = strings.users.detail

const route = getRouteApi('/users/$id')

const ENTITY_OPTIONS: { value: UserEntity; label: string }[] = [
  { value: 'welld_ch', label: strings.common.entities.welld_ch },
  { value: 'welld_it', label: strings.common.entities.welld_it },
]

/** design.md F4 / Dialog D2 — fixed acknowledgement copy, verbatim. */
const LAST_ADMIN_MESSAGE = strings.common.guardrail.lastAdminRoleMessage

/** design.md F3 — fixed acknowledgement copy for the last-admin delete guard (UsersPage.tsx's LAST_ADMIN_DELETE_MESSAGE, mirrored verbatim). */
const LAST_ADMIN_DELETE_MESSAGE = strings.common.guardrail.lastAdminDeleteMessage

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; user: UserDetailData; roles: Role[]; departments: Department[] }
  | { status: 'error'; message: string }

const errorMessageFor = (error: unknown): string => {
  if (error instanceof ApiError) {
    return error.detail ?? error.title
  }
  return t.loadError
}

const toggleInSet = (set: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(set)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  return next
}

export default function UserDetail() {
  const { id } = route.useParams()
  const navigate = useNavigate()
  const session = useSession()
  const currentUserId = session.data?.user?.id

  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  // Pending-edit state, seeded once from the loaded user by the fetch effect
  // below (and re-seeded if the id changes / a Retry re-fetches from
  // scratch).
  const [entity, setEntity] = useState<UserEntity | ''>('')
  const [jobTitle, setJobTitle] = useState('')
  const [selectedRoleIds, setSelectedRoleIds] = useState<ReadonlySet<string>>(new Set())
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<ReadonlySet<string>>(new Set())

  const [attributesSaving, setAttributesSaving] = useState(false)
  const [attributesError, setAttributesError] = useState<string | null>(null)
  const [rolesSaving, setRolesSaving] = useState(false)
  const [rolesError, setRolesError] = useState<string | null>(null)
  const [departmentsSaving, setDepartmentsSaving] = useState(false)
  const [departmentsError, setDepartmentsError] = useState<string | null>(null)
  // INC-19: each section confirms its own save, beside its Save button.
  const [attributesSuccess, setAttributesSuccess] = useState<string | null>(null)
  const [rolesSuccess, setRolesSuccess] = useState<string | null>(null)
  const [departmentsSuccess, setDepartmentsSuccess] = useState<string | null>(null)
  const [guardrailMessage, setGuardrailMessage] = useState<string | null>(null)

  // --- "Delete user" (Dialog N2 reused — design.md Screen U3 / F3) ---
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteGuardrailMessage, setDeleteGuardrailMessage] = useState<string | null>(null)

  // --- Address section visibility (T12, specs/20260803-employee-address, AC-4.2) ---
  // Without the `admin` role the section is ABSENT from the DOM, never a
  // disabled placeholder (AC-4.2 "a denied capability is invisible, not
  // merely disabled"); empty permissions (unresolved or failed) hide it too.
  const showAddress = usePermissions().roles.includes('admin')

  // Fetch the user + the full role/department catalogs (needed to render
  // every option in the two checkbox fieldsets, not just the assigned ones).
  // The pending-edit state (entity/jobTitle/selectedRoleIds/
  // selectedDepartmentIds) is seeded right here, in this `.then()` closure,
  // rather than in a second effect that watches `state` — that would fire
  // (and re-seed) on every `state.status === 'loaded'` transition, including
  // the ones a *successful* roles/departments save produces via its own
  // `setState` call below, and would need its own tracking flag to avoid
  // re-seeding over a save that's still pending after a 422 (design.md's
  // guardrail requirement: "the in-progress edit is preserved so the admin
  // can adjust and retry"). Seeding only here — only reachable from a fresh
  // `GET /admin/users/:id` — sidesteps that entirely: a save's own
  // `setState` never touches `entity`/`jobTitle`/`selectedRoleIds`/
  // `selectedDepartmentIds`, so a 422 (or any save) simply leaves them as the
  // admin last edited them.
  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => {
        if (!cancelled) setState({ status: 'loading' })
      })
      .then(() => Promise.all([adminApi.getUser(id), adminApi.listRoles(), adminApi.listDepartments()]))
      .then(([user, roles, departments]) => {
        if (cancelled) return
        setState({ status: 'loaded', user, roles, departments })
        setEntity(user.entity ?? '')
        setJobTitle(user.jobTitle ?? '')
        setSelectedRoleIds(new Set(user.roles.map((r) => r.id)))
        setSelectedDepartmentIds(new Set(user.departments.map((d) => d.id)))
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: errorMessageFor(error) })
      })

    return () => {
      cancelled = true
    }
  }, [id, reloadToken])

  const handleRetry = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const toggleRole = useCallback((roleId: string) => {
    setSelectedRoleIds((prev) => toggleInSet(prev, roleId))
  }, [])

  const toggleDepartment = useCallback((departmentId: string) => {
    setSelectedDepartmentIds((prev) => toggleInSet(prev, departmentId))
  }, [])

  const handleSaveAttributes = useCallback(() => {
    setAttributesSaving(true)
    setAttributesError(null)
    setAttributesSuccess(null)
    adminApi
      .patchUser(id, { entity: entity === '' ? null : entity, jobTitle: jobTitle.trim() === '' ? null : jobTitle })
      .then((updated) => {
        setAttributesSaving(false)
        setState((prev) => (prev.status === 'loaded' ? { ...prev, user: updated } : prev))
        setAttributesSuccess(t.attributesSaved)
      })
      .catch((error: unknown) => {
        setAttributesSaving(false)
        setAttributesError(errorMessageFor(error))
      })
  }, [id, entity, jobTitle])

  const handleSaveRoles = useCallback(() => {
    setRolesSaving(true)
    setRolesError(null)
    setRolesSuccess(null)
    adminApi
      .putUserRoles(id, Array.from(selectedRoleIds))
      .then((updated) => {
        setRolesSaving(false)
        setState((prev) => (prev.status === 'loaded' ? { ...prev, user: updated } : prev))
        setRolesSuccess(t.rolesSaved)
      })
      .catch((error: unknown) => {
        setRolesSaving(false)
        if (error instanceof ApiError && error.status === 422) {
          // AC-6.4 — pending selection (selectedRoleIds) is intentionally left
          // as-is so the admin can adjust and retry.
          setGuardrailMessage(LAST_ADMIN_MESSAGE)
          return
        }
        setRolesError(errorMessageFor(error))
      })
  }, [id, selectedRoleIds])

  const handleSaveDepartments = useCallback(() => {
    setDepartmentsSaving(true)
    setDepartmentsError(null)
    setDepartmentsSuccess(null)
    adminApi
      .putUserDepartments(id, Array.from(selectedDepartmentIds))
      .then((updated) => {
        setDepartmentsSaving(false)
        setState((prev) => (prev.status === 'loaded' ? { ...prev, user: updated } : prev))
        setDepartmentsSuccess(t.departmentsSaved)
      })
      .catch((error: unknown) => {
        setDepartmentsSaving(false)
        if (error instanceof ApiError && error.status === 422) {
          // AC-6.4 — pending selection (selectedDepartmentIds) is intentionally
          // left as-is so the admin can adjust and retry.
          setGuardrailMessage(LAST_ADMIN_MESSAGE)
          return
        }
        setDepartmentsError(errorMessageFor(error))
      })
  }, [id, selectedDepartmentIds])

  const handleAcknowledgeGuardrail = useCallback(() => {
    setGuardrailMessage(null)
  }, [])

  // ---------------------------------------------------------------------------
  // "Delete user" (Dialog N2 — design.md F3/Screen U3, reuses UsersPage.tsx's
  // exact ConfirmDeleteModal body copy + adminApi.deleteUser call)
  // ---------------------------------------------------------------------------

  const isSelf = state.status === 'loaded' && state.user.id === currentUserId

  const handleDeleteRequest = useCallback(() => {
    if (state.status !== 'loaded') return
    if (state.user.id === currentUserId) return // defensive — the button is already disabled for this page
    setDeleteError(null)
    setDeleteModalOpen(true)
  }, [state, currentUserId])

  const handleDeleteCancel = useCallback(() => {
    setDeleteModalOpen(false)
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    if (state.status !== 'loaded') return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await adminApi.deleteUser(state.user.id)
      setDeleteModalOpen(false)
      // INC-19: the users list this returns to confirms the delete.
      setFlash('users', strings.users.deleted(state.user.name ?? state.user.email))
      void navigate({ to: '/users' })
    } catch (error) {
      setIsDeleting(false)
      if (error instanceof ApiError && error.status === 422) {
        // AC-5.5/5.6 — genuinely blocked, nothing to retry from this dialog.
        setDeleteModalOpen(false)
        setDeleteGuardrailMessage(LAST_ADMIN_DELETE_MESSAGE)
        return
      }
      setDeleteError(errorMessageFor(error))
    }
  }, [state, navigate])

  const handleAcknowledgeDeleteGuardrail = useCallback(() => {
    setDeleteGuardrailMessage(null)
  }, [])

  const deleteBody = useMemo(() => {
    if (state.status !== 'loaded') return null
    const identity = state.user.name ?? state.user.email
    return <p>{strings.users.deleteBody(identity)}</p>
  }, [state])

  return (
    <section aria-labelledby="admin-user-detail-heading" data-testid="admin-user-detail-page">
      <PageHeader
        title={t.title}
        titleId="admin-user-detail-heading"
        back={
          <Link to="/users" data-testid="back-to-users-link" className="link">
            <Icon name="arrow-left" /> {t.back}
          </Link>
        }
        actions={
          <Button
            variant="danger"
            aria-disabled={state.status !== 'loaded' || isSelf}
            title={isSelf ? strings.common.cannotDeleteSelf : undefined}
            onClick={handleDeleteRequest}
            data-testid="user-detail-delete-button"
          >
            {t.deleteUser}
            {isSelf && <span className="sr-only">{strings.common.disabledReason(strings.common.cannotDeleteSelf)}</span>}
          </Button>
        }
      />

      <div>
        {state.status === 'loading' && <SkeletonListRows rows={4} />}

        {state.status === 'error' && <ErrorBanner message={state.message} onRetry={handleRetry} />}

        {state.status === 'loaded' && (
          <div className="flex flex-col gap-4">
            {/* Identity — read-only */}
            <Card title={t.identityTitle}>
              <FactList
                items={[
                  {
                    id: 'name',
                    term: strings.common.fields.name,
                    value: <span data-testid="user-detail-name">{state.user.name ?? state.user.email}</span>,
                  },
                  {
                    id: 'email',
                    term: strings.common.fields.email,
                    value: <span data-testid="user-detail-email">{state.user.email}</span>,
                  },
                ]}
              />
            </Card>

            {/* Attributes */}
            <Card title={t.attributesTitle}>
              <div className="flex flex-col gap-3 max-w-sm">
                <Field label={strings.common.fields.entity}>
                  {(control) => (
                    <select
                      {...control}
                      data-testid="entity-select"
                      value={entity}
                      onChange={(e) => setEntity(e.target.value as UserEntity | '')}
                      className="w-full"
                    >
                      <option value="">{strings.common.noneOption}</option>
                      {ENTITY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>

                <Field label={strings.common.fields.jobTitle}>
                  {(control) => (
                    <input
                      {...control}
                      type="text"
                      data-testid="jobtitle-input"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      className="w-full"
                    />
                  )}
                </Field>

                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleSaveAttributes}
                    disabled={attributesSaving}
                    busy={attributesSaving}
                    data-testid="save-attributes-button"
                  >
                    {attributesSaving ? strings.common.actions.saving : t.saveAttributes}
                  </Button>
                </div>

                {attributesError && (
                  <p role="alert" data-testid="attributes-error" className="form-error">
                    {attributesError}
                  </p>
                )}
                <SuccessBanner
                  message={attributesSuccess}
                  onDismiss={() => setAttributesSuccess(null)}
                  testId="attributes-success"
                />
              </div>
            </Card>

            {/* Direct roles */}
            <Card title={t.directRoles}>
              <div>
                <CheckboxGroupField
                  label={t.directRoles}
                  hideLabel
                  emptyState={t.noRoles}
                  options={state.roles.map((role) => ({ id: role.id, label: role.name }))}
                  selected={selectedRoleIds}
                  onToggle={(id) => toggleRole(id)}
                  disabled={rolesSaving}
                  optionTestIdPrefix="role-checkbox"
                />

                <div className="flex items-center gap-3 mt-3">
                  <Button
                    onClick={handleSaveRoles}
                    disabled={rolesSaving}
                    busy={rolesSaving}
                    data-testid="save-roles-button"
                  >
                    {rolesSaving ? strings.common.actions.saving : t.saveRoles}
                  </Button>
                  <span className="text-xs text-soft" data-testid="roles-effective-immediately-hint">
                    {strings.common.effectiveImmediately}
                  </span>
                </div>

                {rolesError && (
                  <p role="alert" data-testid="roles-error" className="form-error mt-2">
                    {rolesError}
                  </p>
                )}
                <SuccessBanner
                  message={rolesSuccess}
                  onDismiss={() => setRolesSuccess(null)}
                  testId="roles-success"
                  className="mt-2"
                />
              </div>
            </Card>

            {/* Departments */}
            <Card title={strings.common.fields.departments}>
              <div>
                <CheckboxGroupField
                  label={strings.common.fields.departments}
                  hideLabel
                  emptyState={t.noDepartments}
                  options={state.departments.map((department) => ({ id: department.id, label: department.name }))}
                  selected={selectedDepartmentIds}
                  onToggle={(id) => toggleDepartment(id)}
                  disabled={departmentsSaving}
                  optionTestIdPrefix="department-checkbox"
                />

                <div className="flex items-center gap-3 mt-3">
                  <Button
                    onClick={handleSaveDepartments}
                    disabled={departmentsSaving}
                    busy={departmentsSaving}
                    data-testid="save-departments-button"
                  >
                    {departmentsSaving ? strings.common.actions.saving : t.saveDepartments}
                  </Button>
                  <span className="text-xs text-soft" data-testid="departments-effective-immediately-hint">
                    {strings.common.effectiveImmediately}
                  </span>
                </div>

                {departmentsError && (
                  <p role="alert" data-testid="departments-error" className="form-error mt-2">
                    {departmentsError}
                  </p>
                )}
                <SuccessBanner
                  message={departmentsSuccess}
                  onDismiss={() => setDepartmentsSuccess(null)}
                  testId="departments-success"
                  className="mt-2"
                />
              </div>
            </Card>

            {/* Address (T11/T12, specs/20260803-employee-address) — AC-4.2: absent from the
                DOM entirely for a non-admin, never a disabled variant of itself. */}
            {showAddress && <AddressSection userId={state.user.id} />}
          </div>
        )}
      </div>

      {guardrailMessage && (
        <GuardrailDialog
          title={strings.common.guardrail.lastAdminRoleTitle}
          message={guardrailMessage}
          onAcknowledge={handleAcknowledgeGuardrail}
        />
      )}

      {deleteModalOpen && state.status === 'loaded' && (
        <ConfirmDeleteModal
          title={strings.users.deleteTitle}
          itemName={state.user.email}
          body={deleteBody}
          isDeleting={isDeleting}
          errorMessage={deleteError}
          onConfirm={() => void handleDeleteConfirm()}
          onCancel={handleDeleteCancel}
        />
      )}

      {deleteGuardrailMessage && (
        <GuardrailDialog
          title={strings.common.guardrail.lastAdminDeleteTitle}
          message={deleteGuardrailMessage}
          onAcknowledge={handleAcknowledgeDeleteGuardrail}
        />
      )}
    </section>
  )
}
