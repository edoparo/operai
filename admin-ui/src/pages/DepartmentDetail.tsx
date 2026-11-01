import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Button, Card, CheckboxGroupField, Field, Icon, PageHeader } from '@operai/ui'
import * as adminApi from '../lib/adminApi'
import type { DepartmentDetail as DepartmentDetailData, Role, UserSummary } from '../lib/adminApi'
import { ApiError } from '../lib/adminApi'
import SkeletonListRows from '../components/SkeletonListRows'
import ErrorBanner from '../components/ErrorBanner'
import SuccessBanner from '../components/SuccessBanner'
import { useFlash } from '../lib/flash'
import { strings } from '../strings'

const t = strings.departments.detail

/**
 * DepartmentDetail — Screen B2 (design.md "Department detail", T19,
 * specs/004-auth-roles-permissions/tasks.md). New page, route `/departments/$id`
 * (../router.tsx).
 *
 * Three independently-saved sections (AC-1.2):
 *   1. Name/description — inline-editable, `PATCH /admin/departments/:id`.
 *   2. "Roles conferred" — a multi-select (checkbox list) of every existing
 *      role, saved as a whole set via `PUT /admin/departments/:id/roles`
 *      (`{ roleIds }`) — members of this department inherit these roles
 *      (T2's resolver). A `422` (stale multi-select referencing a role that
 *      no longer exists) surfaces as an inline banner and re-fetches the
 *      roles catalog, per design.md: "422 unknown role (stale multi-select)
 *      → inline banner, re-fetch roles."
 *   3. "Members" panel — lists `GET /admin/departments/:id`'s embedded
 *      `members` (design drift fix, T9/T16), with per-member Remove and an
 *      "Add member" user-search picker (composed from a `?q=` search against
 *      `GET /admin/users` + a row-select, per design.md: "reuses the
 *      Users-list search pattern, not a new pattern" — Screen C1 itself
 *      isn't built yet (T20), so this composes directly from adminApi
 *      rather than importing a page that doesn't exist). Both add and
 *      remove persist via `PUT /admin/departments/:id/members` (`{ userIds }`,
 *      whole-set semantics) — never a partial-update endpoint, because none
 *      exists (T9's drift fix note).
 *
 * Async pattern: exactly like DepartmentsPage.tsx / AuditPage.tsx — the two
 * `useEffect`-driven fetches (department detail, roles catalog) are
 * `.then()/.catch()` Promise chains, never an async function invoked
 * directly from the effect (admin-ui's `eslint-plugin-react-hooks@7.1.1`
 * `react-hooks/set-state-in-effect` rule). Every other async call here
 * (save details, save roles, add/remove member, user search) happens inside
 * an event handler, not an effect, so async/await is used freely there.
 *
 * ---------------------------------------------------------------------
 * KNOWN BACKEND DRIFT (flagged, not silently adapted to — see this task's
 * completion report): `auth/src/admin/departments.routes.ts` (T9) does NOT
 * actually match plan.md's own "Wire-shape conventions" section, which the
 * plan says is "fixed by the admin-ui client T16; backend T8–T10 MUST
 * match": the real `GET /admin/departments` returns `{ items: [...] }`,
 * not a bare array, and department responses carry `roles: {id,name}[]`,
 * not `roleIds: string[]`. This page (and DepartmentsPage.tsx) is written
 * against `adminApi.ts`'s already-fixed types (bare array, `roleIds`) per
 * "consume the API exactly as plan.md defines it" — the backend, not this
 * frontend task, is what's out of contract, so it is not adapted to here.
 * ---------------------------------------------------------------------
 */

const route = getRouteApi('/departments/$id')

const errorMessageFor = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) return error.detail ?? error.title
  return fallback
}

type LoadState =
  { status: 'loading' } | { status: 'loaded'; department: DepartmentDetailData } | { status: 'error'; message: string }

type RolesCatalogState =
  { status: 'loading' } | { status: 'loaded'; roles: Role[] } | { status: 'error'; message: string }

export default function DepartmentDetail() {
  const { id } = route.useParams()

  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  const [rolesCatalog, setRolesCatalog] = useState<RolesCatalogState>({ status: 'loading' })

  // --- Name/description ---
  const [nameDraft, setNameDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [detailsSaving, setDetailsSaving] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)

  // --- Roles conferred ---
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([])
  const [rolesSaving, setRolesSaving] = useState(false)
  const [rolesError, setRolesError] = useState<string | null>(null)

  // --- Success feedback (INC-19) ---
  // "created", handed over by DepartmentsPage (flash), shows under the header.
  const [created, setCreated] = useFlash(`department:${id}`)
  const [membersSuccess, setMembersSuccess] = useState<string | null>(null)
  const [detailsSuccess, setDetailsSuccess] = useState<string | null>(null)
  const [rolesSuccess, setRolesSuccess] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // --- Members ---
  const [membersError, setMembersError] = useState<string | null>(null)
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)

  // --- Add-member user-search picker ---
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerStatus, setPickerStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [pickerResults, setPickerResults] = useState<UserSummary[]>([])
  const [pickerMessage, setPickerMessage] = useState<string | null>(null)
  const [addingUserId, setAddingUserId] = useState<string | null>(null)

  // Load the department detail whenever `id` or `reloadToken` changes.
  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => {
        if (!cancelled) setState({ status: 'loading' })
      })
      .then(() => adminApi.getDepartment(id))
      .then((department) => {
        if (cancelled) return
        setState({ status: 'loaded', department })
        setNameDraft(department.name)
        setDescriptionDraft(department.description ?? '')
        setSelectedRoleIds(department.roleIds)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: errorMessageFor(error, t.loadError) })
        }
      })

    return () => {
      cancelled = true
    }
  }, [id, reloadToken])

  // Load the roles catalog (for the "Roles conferred" multi-select).
  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => {
        if (!cancelled) setRolesCatalog({ status: 'loading' })
      })
      .then(() => adminApi.listRoles())
      .then((roles) => {
        if (!cancelled) setRolesCatalog({ status: 'loaded', roles })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRolesCatalog({ status: 'error', message: errorMessageFor(error, t.rolesLoadError) })
        }
      })

    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const handleRetry = useCallback(() => setReloadToken((t) => t + 1), [])

  // --- Save name/description ---
  const handleSaveDetails = useCallback(async () => {
    setDetailsSuccess(null)
    if (nameDraft.trim().length === 0) {
      setNameError(strings.common.nameRequired)
      nameInputRef.current?.focus()
      return
    }
    setDetailsSaving(true)
    setDetailsError(null)
    try {
      const updated = await adminApi.patchDepartment(id, {
        name: nameDraft.trim(),
        description: descriptionDraft.trim() || null,
      })
      setState((prev) =>
        prev.status === 'loaded' ? { status: 'loaded', department: { ...prev.department, ...updated } } : prev,
      )
      setNameDraft(updated.name)
      setDescriptionDraft(updated.description ?? '')
      setDetailsSuccess(t.detailsSaved)
    } catch (error) {
      setDetailsError(
        error instanceof ApiError && error.status === 409
          ? (error.detail ?? strings.departments.nameTaken)
          : errorMessageFor(error, t.saveFailed),
      )
    } finally {
      setDetailsSaving(false)
    }
  }, [id, nameDraft, descriptionDraft])

  // --- Roles conferred ---
  const toggleRole = useCallback((roleId: string) => {
    setSelectedRoleIds((prev) => (prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]))
  }, [])

  const handleSaveRoles = useCallback(async () => {
    setRolesSaving(true)
    setRolesError(null)
    setRolesSuccess(null)
    try {
      const updated = await adminApi.putDepartmentRoles(id, selectedRoleIds)
      setState({ status: 'loaded', department: updated })
      setSelectedRoleIds(updated.roleIds)
      setRolesSuccess(t.rolesSaved)
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setRolesError(error.detail ?? t.rolesStale)
        try {
          const roles = await adminApi.listRoles()
          setRolesCatalog({ status: 'loaded', roles })
        } catch (reloadError) {
          setRolesCatalog({ status: 'error', message: errorMessageFor(reloadError, t.rolesReloadFailed) })
        }
      } else {
        setRolesError(errorMessageFor(error, t.rolesSaveFailed))
      }
    } finally {
      setRolesSaving(false)
    }
  }, [id, selectedRoleIds])

  // --- Members: remove ---
  const handleRemoveMember = useCallback(
    async (userId: string) => {
      if (state.status !== 'loaded') return
      const remaining = state.department.members.filter((m) => m.id !== userId).map((m) => m.id)
      setRemovingMemberId(userId)
      setMembersError(null)
      try {
        const updated = await adminApi.putDepartmentMembers(id, remaining)
        setState({ status: 'loaded', department: updated })
        const removed = state.department.members.find((m) => m.id === userId)
        setMembersSuccess(t.removed(removed?.name ?? removed?.email ?? t.memberFallback))
      } catch (error) {
        setMembersError(errorMessageFor(error, t.removeFailed))
      } finally {
        setRemovingMemberId(null)
      }
    },
    [id, state],
  )

  // --- Members: add via user-search picker ---
  const openPicker = useCallback(() => {
    setPickerOpen(true)
    setPickerQuery('')
    setPickerStatus('idle')
    setPickerResults([])
    setPickerMessage(null)
  }, [])

  const closePicker = useCallback(() => setPickerOpen(false), [])

  const handlePickerSearch = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setPickerStatus('loading')
      setPickerMessage(null)
      try {
        const result = await adminApi.listUsers({ q: pickerQuery, pageSize: 10 })
        setPickerResults(result.items)
        setPickerStatus('loaded')
      } catch (error) {
        setPickerStatus('error')
        setPickerMessage(errorMessageFor(error, t.picker.searchFailed))
      }
    },
    [pickerQuery],
  )

  const handleAddMember = useCallback(
    async (user: UserSummary) => {
      if (state.status !== 'loaded') return
      const currentIds = state.department.members.map((m) => m.id)
      if (currentIds.includes(user.id)) return
      setAddingUserId(user.id)
      setMembersError(null)
      try {
        const updated = await adminApi.putDepartmentMembers(id, [...currentIds, user.id])
        setState({ status: 'loaded', department: updated })
        setPickerOpen(false)
        setMembersSuccess(t.added(user.name ?? user.email))
      } catch (error) {
        setMembersError(errorMessageFor(error, t.addFailed))
      } finally {
        setAddingUserId(null)
      }
    },
    [id, state],
  )

  return (
    <section aria-labelledby="department-detail-heading" data-testid="department-detail-page">
      <PageHeader
        title={state.status === 'loaded' ? state.department.name : t.titleFallback}
        titleId="department-detail-heading"
        back={
          <Link to="/departments" className="link" data-testid="department-detail-back-link">
            <Icon name="arrow-left" /> {t.back}
          </Link>
        }
      />

      <SuccessBanner message={created} onDismiss={() => setCreated(null)} testId="department-created" className="mb-4" />

      {state.status === 'loading' && <SkeletonListRows rows={3} />}

      {state.status === 'error' && <ErrorBanner message={state.message} onRetry={handleRetry} />}

      {state.status === 'loaded' && (
        <div className="flex flex-col gap-4">
          {/* --- Name / description --- */}
          <Card title={t.detailsTitle} data-testid="department-details-section">
            <div className="flex flex-col gap-3 mb-3">
              <Field
                label={strings.common.fields.name}
                required
                error={
                  nameError && (
                    <span role="alert" data-testid="department-name-error">
                      {nameError}
                    </span>
                  )
                }
              >
                {(control) => (
                  <input
                    {...control}
                    ref={nameInputRef}
                    type="text"
                    value={nameDraft}
                    disabled={detailsSaving}
                    onChange={(e) => {
                      setNameError(null)
                      setNameDraft(e.target.value)
                    }}
                    onBlur={() => {
                      if (nameDraft.trim().length === 0) setNameError(strings.common.nameRequired)
                    }}
                    className="w-full"
                    data-testid="department-name-input"
                  />
                )}
              </Field>
              <Field label={strings.common.fields.description}>
                {(control) => (
                  <textarea
                    {...control}
                    value={descriptionDraft}
                    disabled={detailsSaving}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    rows={2}
                    className="w-full"
                    data-testid="department-description-input"
                  />
                )}
              </Field>
            </div>
            {detailsError && (
              <p role="alert" className="form-error mb-3" data-testid="department-details-error">
                {detailsError}
              </p>
            )}
            <Button
              onClick={() => void handleSaveDetails()}
              disabled={detailsSaving}
              busy={detailsSaving}
              data-testid="department-save-details"
            >
              {detailsSaving ? strings.common.actions.saving : t.saveDetails}
            </Button>
            <SuccessBanner
              message={detailsSuccess}
              onDismiss={() => setDetailsSuccess(null)}
              testId="department-details-success"
              className="mt-3"
            />
          </Card>

          {/* --- Roles conferred --- */}
          <Card title={t.rolesTitle} data-testid="department-roles-section">
            <p className="text-xs mb-3 text-soft">{t.rolesHint}</p>

            {rolesCatalog.status === 'loading' && <SkeletonListRows rows={2} />}

            {rolesCatalog.status === 'error' && <ErrorBanner message={rolesCatalog.message} onRetry={handleRetry} />}

            {rolesCatalog.status === 'loaded' && rolesCatalog.roles.length === 0 && (
              <p className="text-sm text-soft" data-testid="department-roles-empty">
                {t.rolesEmpty}
              </p>
            )}

            {rolesCatalog.status === 'loaded' && rolesCatalog.roles.length > 0 && (
              <CheckboxGroupField
                label={t.rolesLegend}
                hideLabel
                options={rolesCatalog.roles.map((role) => ({ id: role.id, label: role.name }))}
                selected={selectedRoleIds}
                onToggle={(id) => toggleRole(id)}
                disabled={rolesSaving}
                testId="department-roles-list"
                optionTestIdPrefix="role-checkbox"
              />
            )}

            {rolesError && (
              <p role="alert" className="form-error mt-3" data-testid="department-roles-error">
                {rolesError}
              </p>
            )}

            {rolesCatalog.status === 'loaded' && rolesCatalog.roles.length > 0 && (
              <Button
                onClick={() => void handleSaveRoles()}
                disabled={rolesSaving}
                busy={rolesSaving}
                data-testid="department-save-roles"
                className="mt-3"
              >
                {rolesSaving ? strings.common.actions.saving : t.saveRoles}
              </Button>
            )}
            <SuccessBanner
              message={rolesSuccess}
              onDismiss={() => setRolesSuccess(null)}
              testId="department-roles-success"
              className="mt-3"
            />
          </Card>

          {/* --- Members --- */}
          <Card
            title={t.membersTitle}
            data-testid="department-members-section"
            action={
              <Button size="sm" onClick={openPicker} data-testid="department-add-member-button">
                {t.addMember}
              </Button>
            }
          >
            <SuccessBanner
              message={membersSuccess}
              onDismiss={() => setMembersSuccess(null)}
              testId="department-members-success"
              className="mb-2"
            />

            {membersError && (
              <p role="alert" className="form-error mb-2" data-testid="department-members-error">
                {membersError}
              </p>
            )}

            {state.department.members.length === 0 ? (
              <p className="text-sm text-soft" data-testid="department-members-empty">
                {t.membersEmpty}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5" aria-label={t.membersLabel} data-testid="department-members-list">
                {state.department.members.map((member) => (
                  <li
                    key={member.id}
                    className="flex items-center justify-between gap-3 text-sm"
                    data-testid={`department-member-${member.id}`}
                  >
                    <MemberName name={member.name ?? member.email} email={member.email} />
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void handleRemoveMember(member.id)}
                      disabled={removingMemberId === member.id}
                      busy={removingMemberId === member.id}
                      aria-label={t.removeMember(member.name ?? member.email)}
                      data-testid={`department-remove-member-${member.id}`}
                    >
                      {removingMemberId === member.id ? strings.common.actions.removing : strings.common.actions.remove}
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {/* --- Add-member user-search picker (inline, per design.md: "reuses
                the Users-list search pattern, not a new pattern" — not a modal,
                and not a nested card: a bordered area inside the Members card) --- */}
            {pickerOpen && (
              <div className="mt-3 p-3 border rounded-md border-rule bg-ink" data-testid="department-member-picker">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-soft">{t.picker.hint}</p>
                  <Button
                    variant="ghost"
                    iconOnly
                    onClick={closePicker}
                    aria-label={t.picker.close}
                    data-testid="department-picker-close"
                  >
                    <Icon name="close" />
                  </Button>
                </div>

                <form onSubmit={(e) => void handlePickerSearch(e)} className="flex items-center gap-2 mb-2">
                  <label htmlFor="department-picker-query" className="sr-only">
                    {t.picker.queryLabel}
                  </label>
                  <input
                    id="department-picker-query"
                    type="text"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    className="flex-1"
                    data-testid="department-picker-query-input"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={pickerStatus === 'loading'}
                    busy={pickerStatus === 'loading'}
                    data-testid="department-picker-search-button"
                  >
                    {pickerStatus === 'loading' ? strings.common.actions.searching : strings.common.actions.search}
                  </Button>
                </form>

                {pickerStatus === 'error' && pickerMessage && (
                  <p role="alert" className="text-sm text-org-text" data-testid="department-picker-message">
                    {pickerMessage}
                  </p>
                )}

                {pickerStatus === 'loaded' && pickerResults.length === 0 && (
                  <p className="text-sm text-soft" data-testid="department-picker-empty">
                    {t.picker.empty}
                  </p>
                )}

                {pickerStatus === 'loaded' && pickerResults.length > 0 && (
                  <ul
                    className="flex flex-col gap-1.5"
                    aria-label={t.picker.resultsLabel}
                    data-testid="department-picker-results"
                  >
                    {pickerResults.map((user) => {
                      const alreadyMember = state.department.members.some((m) => m.id === user.id)
                      return (
                        <li
                          key={user.id}
                          className="flex items-center justify-between gap-3 text-sm"
                          data-testid={`department-picker-result-${user.id}`}
                        >
                          <MemberName name={user.name ?? user.email} email={user.email} />
                          <Button
                            size="sm"
                            onClick={() => void handleAddMember(user)}
                            disabled={alreadyMember || addingUserId === user.id}
                            busy={addingUserId === user.id}
                            data-testid={`department-picker-add-${user.id}`}
                          >
                            {alreadyMember
                              ? t.picker.alreadyMember
                              : addingUserId === user.id
                                ? strings.common.actions.adding
                                : strings.common.actions.add}
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </section>
  )
}

/** A person's name with their email beside it, muted. */
function MemberName({ name, email }: { name: string; email: string }) {
  return (
    <span className="text-text">
      {name} <span className="text-soft">({email})</span>
    </span>
  )
}
