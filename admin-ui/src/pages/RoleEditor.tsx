import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getRouteApi, useNavigate, Link } from '@tanstack/react-router'
import { Button, Card, Field, Icon, PageHeader } from '@operai/ui'
import * as adminApi from '../lib/adminApi'
import type {
  AttributeCondition,
  AttributeConditionKey,
  Catalog,
  CatalogAction,
  CatalogResource,
  ConditionType,
  OwnershipCondition,
  PermissionRule,
  RoleDetail,
  RuleConditions,
} from '../lib/adminApi'
import { ApiError } from '../lib/adminApi'
import SkeletonListRows from '../components/SkeletonListRows'
import ErrorBanner from '../components/ErrorBanner'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import GuardrailDialog from '../components/GuardrailDialog'
import PermissionDenied from '../components/PermissionDenied'
import SystemBadge from '../components/SystemBadge'
import ConditionChip from '../components/ConditionChip'
import SuccessBanner from '../components/SuccessBanner'
import { setFlash, useFlash } from '../lib/flash'
import type { ConditionChipKind } from '../components/ConditionChip'
import { strings } from '../strings'

const t = strings.roles.editor

/**
 * RoleEditor — Screen A2 (Role editor / rule builder, "the hardest screen"
 * per design.md) — T18, specs/20260713-auth-roles-permissions/tasks.md, refs
 * AC-2.1–2.4, AC-3.1, AC-3.2.
 *
 * New page at the new `/roles/$id` route (router.tsx, added alongside this
 * task per the prompt's note). Loads the role (`GET /admin/roles/:id`) and
 * the permission catalog (`GET /admin/catalog`) independently; renders:
 *   - Header: inline-editable name/description (PATCH), System badge,
 *     Delete (aria-disabled + tooltip if System — design.md's "not just a
 *     bare CSS disabled state" a11y note, same posture as RolesPage.tsx's
 *     table Delete action and Pagination.tsx's bounds guard).
 *   - Rule list: each rule as "Resource · Action" + condition chips + a
 *     remove "×" — a **client-side draft** (design.md F2 step 4d: "'Add'
 *     appends … to the role's in-progress rule list (client-side draft)").
 *   - Rule composer: catalog-driven Resource→Action cascade (AC-2.1 by
 *     construction — only catalog options are ever renderable) with a
 *     dynamic Conditions fieldset (AC-2.2/2.3) and an `aria-live="polite"`
 *     status line announcing Action-reset / available-conditions changes
 *     (design.md's explicit a11y hotspot for this screen).
 *   - "Save rules" persists the whole draft via `PUT /admin/roles/:id/rules`
 *     (AC-2.1–2.3); a `422` (stale catalog — AC-3.2) surfaces as an inline
 *     banner with a "Reload catalog" action, preserving the draft.
 *
 * Fetch pattern: both the role and catalog effects use the same explicit
 * Promise-chain shape as AuditPage.tsx/RolesPage.tsx (not async/await
 * invoked from the effect) — `eslint-plugin-react-hooks@7.1.1`'s
 * `react-hooks/set-state-in-effect` flags an async function that calls a
 * state setter anywhere in its body, even after an `await`, because the
 * await-continuation stays within the same function body the rule
 * inspects. Routing each transition through its own `.then()`/`.catch()`
 * closure keeps every setState call in its own function boundary. Button
 * click handlers (Save details / Save rules / Delete) are plain
 * async/await, exactly like `EstimatesPage.tsx`'s handlers — the lint rule
 * only polices effects, not event handlers.
 */

const route = getRouteApi('/roles/$id')

const ATTRIBUTE_LABELS: Record<AttributeConditionKey, string> = t.attributeLabels

const ATTRIBUTE_KEYS: AttributeConditionKey[] = ['entity', 'department', 'jobTitle']

/** The self-approval condition's catalog key (specs/20260721-self-approval-control, ADR 20260721-self-approval-condition-and-403-exception). */
const SELF_APPROVAL_KEY: AttributeConditionKey = 'self-approval'

// Hover/focus help for each attribute condition (native `title` tooltip, the
// same house pattern SystemBadge / disabled buttons use). An attribute
// condition SCOPES the grant to records matching the user's own attribute
// value instead of granting it globally.
const ATTRIBUTE_HELP: Record<AttributeConditionKey, string> = t.attributeHelp

const humanizeAppId = (appId: string): string =>
  appId.length === 0 ? appId : appId.charAt(0).toUpperCase() + appId.slice(1)

const findResource = (catalog: Catalog, appId: string, resourceKey: string): CatalogResource | undefined =>
  catalog.find((app) => app.appId === appId)?.resources.find((r) => r.key === resourceKey)

/** Best-effort resource/action label lookup for existing rule rows — falls back to the raw key when the catalog hasn't loaded, or no app declares it (a display nicety, not a correctness requirement). */
const labelForResource = (catalog: Catalog | null, resourceKey: string): string => {
  if (!catalog) return resourceKey
  for (const app of catalog) {
    const found = app.resources.find((r) => r.key === resourceKey)
    if (found) return found.label
  }
  return resourceKey
}

const labelForAction = (catalog: Catalog | null, resourceKey: string, actionKey: string): string => {
  if (!catalog) return actionKey
  for (const app of catalog) {
    const action = app.resources.find((r) => r.key === resourceKey)?.actions.find((a) => a.key === actionKey)
    if (action) return action.label
  }
  return actionKey
}

const chipsForConditions = (conditions: RuleConditions | null): ConditionChipKind[] => {
  if (!conditions) return []
  const chips: ConditionChipKind[] = []
  if (conditions.ownership) chips.push(conditions.ownership)
  for (const attr of conditions.attributes ?? []) chips.push(attr.key)
  return chips
}

const errorMessageFor = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) return error.detail ?? error.title
  return fallback
}

type RoleState =
  | { status: 'loading' }
  | { status: 'loaded'; role: RoleDetail }
  | { status: 'forbidden' }
  | { status: 'error'; message: string }

type CatalogState =
  | { status: 'loading' }
  | { status: 'loaded'; catalog: Catalog }
  | { status: 'forbidden' }
  | { status: 'error'; message: string }

type ComposerState = {
  open: boolean
  /** `"<appId>::<resourceKey>"` — composite so identically-keyed resources across apps stay distinguishable in the UI; only the bare resourceKey is ever sent to the API. */
  resourceChoice: string | null
  actionKey: string | null
  ownership: OwnershipCondition
  attributes: ReadonlySet<AttributeConditionKey>
  /** The self-approval restriction toggle (specs/20260721-self-approval-control, ADR 20260721-self-approval-condition-and-403-exception) — kept as an independent field, never merged into `attributes` (AC-1.1/1.3), since it's a distinct deny-carve-out, not an affirmative scope attribute. */
  selfApproval: boolean
  statusMessage: string
}

const CLOSED_COMPOSER: ComposerState = {
  open: false,
  resourceChoice: null,
  actionKey: null,
  ownership: 'any',
  attributes: new Set(),
  selfApproval: false,
  statusMessage: '',
}

export default function RoleEditor() {
  const { id } = route.useParams()
  const navigate = useNavigate()

  const [roleState, setRoleState] = useState<RoleState>({ status: 'loading' })
  const [roleReloadToken, setRoleReloadToken] = useState(0)
  const [catalogState, setCatalogState] = useState<CatalogState>({ status: 'loading' })
  const [catalogReloadToken, setCatalogReloadToken] = useState(0)

  const [draftRules, setDraftRules] = useState<PermissionRule[] | null>(null)

  const [headerEdit, setHeaderEdit] = useState<{ name: string; description: string } | null>(null)
  const [headerSave, setHeaderSave] = useState<{
    saving: boolean
    nameError: string | null
    generalError: string | null
  }>({ saving: false, nameError: null, generalError: null })

  const [composer, setComposer] = useState<ComposerState>(CLOSED_COMPOSER)
  const [saveRulesState, setSaveRulesState] = useState<{ saving: boolean; error: string | null }>({
    saving: false,
    error: null,
  })

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [guardrail, setGuardrail] = useState<{ title: string; message: string } | null>(null)

  // INC-19: "created" (handed over by RolesPage), then each save's confirmation.
  const [created, setCreated] = useFlash(`role:${id}`)
  const [headerSuccess, setHeaderSuccess] = useState<string | null>(null)
  const [rulesSuccess, setRulesSuccess] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // --- Fetch role ---
  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => {
        if (!cancelled) setRoleState({ status: 'loading' })
      })
      .then(() => adminApi.getRole(id))
      .then((role) => {
        if (cancelled) return
        setRoleState({ status: 'loaded', role })
        setDraftRules(role.rules)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 403) {
          setRoleState({ status: 'forbidden' })
        } else {
          setRoleState({ status: 'error', message: errorMessageFor(error, t.loadError) })
        }
      })

    return () => {
      cancelled = true
    }
  }, [id, roleReloadToken])

  // --- Fetch catalog (independent of the role fetch) ---
  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => {
        if (!cancelled) setCatalogState({ status: 'loading' })
      })
      .then(() => adminApi.getCatalog())
      .then((catalog) => {
        if (!cancelled) setCatalogState({ status: 'loaded', catalog })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 403) {
          setCatalogState({ status: 'forbidden' })
        } else {
          setCatalogState({
            status: 'error',
            message: errorMessageFor(error, t.catalogLoadError),
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [catalogReloadToken])

  const handleRoleRetry = useCallback(() => setRoleReloadToken((t) => t + 1), [])
  const handleCatalogRetry = useCallback(() => setCatalogReloadToken((t) => t + 1), [])

  // --- Header (inline name/description PATCH) ---
  const handleNameInputChange = useCallback((value: string, role: RoleDetail) => {
    setHeaderEdit((prev) => ({ name: value, description: prev?.description ?? role.description ?? '' }))
  }, [])

  const handleDescriptionInputChange = useCallback((value: string, role: RoleDetail) => {
    setHeaderEdit((prev) => ({ name: prev?.name ?? role.name, description: value }))
  }, [])

  const handleSaveHeader = useCallback(async () => {
    if (!headerEdit) return
    setHeaderSuccess(null)
    if (headerEdit.name.trim() === '') {
      setHeaderSave({ saving: false, nameError: strings.common.nameRequired, generalError: null })
      nameInputRef.current?.focus()
      return
    }
    setHeaderSave({ saving: true, nameError: null, generalError: null })
    try {
      const updated = await adminApi.patchRole(id, {
        name: headerEdit.name,
        description: headerEdit.description.trim() || null,
      })
      setRoleState((prev) =>
        prev.status === 'loaded' ? { status: 'loaded', role: { ...prev.role, ...updated } } : prev,
      )
      setHeaderEdit({ name: updated.name, description: updated.description ?? '' })
      setHeaderSave({ saving: false, nameError: null, generalError: null })
      setHeaderSuccess(t.detailsSaved)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setHeaderSave({
          saving: false,
          nameError: error.detail ?? strings.roles.nameTaken,
          generalError: null,
        })
      } else {
        setHeaderSave({ saving: false, nameError: null, generalError: t.saveFailed })
      }
    }
  }, [headerEdit, id])

  // --- Delete ---
  const handleDeleteConfirm = useCallback(async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      await adminApi.deleteRole(id)
      // INC-19: the roles list this returns to confirms the delete.
      setFlash('roles', roleState.status === 'loaded' ? strings.roles.deleted(roleState.role.name) : strings.roles.deletedFallback)
      navigate({ to: '/roles' })
    } catch (error) {
      setDeleting(false)
      if (error instanceof ApiError && error.status === 422) {
        setDeleteModalOpen(false)
        setGuardrail({ title: t.systemRoleTitle, message: error.detail ?? t.systemRoleMessage })
      } else {
        setDeleteError(strings.common.deleteFailed)
      }
    }
  }, [id, navigate, roleState])

  // --- Rule composer ---
  const catalog = catalogState.status === 'loaded' ? catalogState.catalog : null

  const selectedResource = useMemo(() => {
    if (!catalog || !composer.resourceChoice) return undefined
    const idx = composer.resourceChoice.indexOf('::')
    if (idx === -1) return undefined
    return findResource(catalog, composer.resourceChoice.slice(0, idx), composer.resourceChoice.slice(idx + 2))
  }, [catalog, composer.resourceChoice])

  const selectedAction: CatalogAction | undefined = useMemo(
    () => selectedResource?.actions.find((a) => a.key === composer.actionKey),
    [selectedResource, composer.actionKey],
  )

  const supportsOwnership = selectedAction?.supportedConditions.includes('ownership') ?? false
  const availableAttributeKeys = useMemo(
    () => ATTRIBUTE_KEYS.filter((key) => selectedAction?.supportedConditions.includes(key)),
    [selectedAction],
  )
  // AC-1.6/US-4/D3: offered only when the selected action's catalog entry
  // declares it (today, `request.approve` only) — never inferred/defaulted.
  const supportsSelfApproval = selectedAction?.supportedConditions.includes(SELF_APPROVAL_KEY) ?? false

  const handleComposerOpen = useCallback(() => setComposer({ ...CLOSED_COMPOSER, open: true }), [])
  const handleComposerCancel = useCallback(() => setComposer(CLOSED_COMPOSER), [])

  const handleResourceChange = useCallback((value: string) => {
    setComposer((prev) => ({
      ...prev,
      resourceChoice: value || null,
      actionKey: null,
      ownership: 'any',
      attributes: new Set(),
      selfApproval: false,
      statusMessage: t.actionReset,
    }))
  }, [])

  const handleActionChange = useCallback(
    (value: string) => {
      const supported: ConditionType[] =
        selectedResource?.actions.find((a) => a.key === value)?.supportedConditions ?? []
      const labels = supported.map((c) => (c === 'ownership' ? t.ownershipCondition : ATTRIBUTE_LABELS[c].toLowerCase()))
      setComposer((prev) => ({
        ...prev,
        actionKey: value || null,
        ownership: 'any',
        attributes: new Set(),
        selfApproval: false,
        statusMessage:
          labels.length > 0 ? t.conditionsAvailable(labels.join(', ')) : t.noConditions,
      }))
    },
    [selectedResource],
  )

  const handleOwnershipChange = useCallback((value: OwnershipCondition) => {
    setComposer((prev) => ({ ...prev, ownership: value }))
  }, [])

  const handleAttributeToggle = useCallback((key: AttributeConditionKey) => {
    setComposer((prev) => {
      const next = new Set(prev.attributes)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return { ...prev, attributes: next }
    })
  }, [])

  // Independent of `handleAttributeToggle`/`attributes` (AC-1.3): toggling
  // the self-approval restriction never touches the entity/department/
  // jobTitle selection, and vice versa.
  const handleSelfApprovalToggle = useCallback(() => {
    setComposer((prev) => ({ ...prev, selfApproval: !prev.selfApproval }))
  }, [])

  const handleAddRule = useCallback(() => {
    if (!selectedResource || !selectedAction) return

    let conditions: RuleConditions | null = null
    if (supportsOwnership || composer.attributes.size > 0 || composer.selfApproval) {
      conditions = {}
      if (supportsOwnership) conditions.ownership = composer.ownership
      const attributeEntries: AttributeCondition[] = availableAttributeKeys
        .filter((key) => composer.attributes.has(key))
        .map((key) => ({ key, match: 'user' as const }))
      // Self-approval composes independently, alongside any entity/department/
      // jobTitle attributes — both persist as separate `attributes[]` entries
      // on the same rule (AC-1.3/AC-2.4, ADR 20260721-self-approval-condition-and-403-exception's `match:"deny"` sentinel).
      if (composer.selfApproval) attributeEntries.push({ key: SELF_APPROVAL_KEY, match: 'deny' })
      if (attributeEntries.length > 0) conditions.attributes = attributeEntries
    }

    const rule: PermissionRule = { resource: selectedResource.key, action: selectedAction.key, conditions }
    setDraftRules((prev) => [...(prev ?? []), rule])
    setComposer(CLOSED_COMPOSER)
  }, [
    selectedResource,
    selectedAction,
    supportsOwnership,
    composer.attributes,
    composer.ownership,
    composer.selfApproval,
    availableAttributeKeys,
  ])

  const handleRemoveRule = useCallback((index: number) => {
    setDraftRules((prev) => (prev ? prev.filter((_, i) => i !== index) : prev))
  }, [])

  const handleDiscardRules = useCallback(() => {
    setRoleState((prev) => {
      if (prev.status === 'loaded') setDraftRules(prev.role.rules)
      return prev
    })
  }, [])

  const handleSaveRules = useCallback(async () => {
    if (!draftRules) return
    setSaveRulesState({ saving: true, error: null })
    setRulesSuccess(null)
    try {
      const updated = await adminApi.putRoleRules(id, draftRules)
      setRoleState({ status: 'loaded', role: updated })
      setDraftRules(updated.rules)
      setSaveRulesState({ saving: false, error: null })
      setRulesSuccess(t.rulesSaved)
    } catch (error) {
      setSaveRulesState({
        saving: false,
        error: errorMessageFor(error, t.rulesStale),
      })
    }
  }, [draftRules, id])

  const handleReloadCatalogAfterStaleSave = useCallback(() => {
    setSaveRulesState({ saving: false, error: null })
    setCatalogReloadToken((t) => t + 1)
  }, [])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (roleState.status === 'forbidden' || catalogState.status === 'forbidden') {
    return <PermissionDenied />
  }

  const backLink = (
    <Link to="/roles" data-testid="back-to-roles-link" className="link">
      <Icon name="arrow-left" /> {t.back}
    </Link>
  )

  if (roleState.status === 'loading' || catalogState.status === 'loading') {
    return (
      <section aria-labelledby="role-editor-heading" data-testid="role-editor-page">
        <PageHeader title={t.title} titleId="role-editor-heading" back={backLink} />
        <SkeletonListRows rows={3} />
      </section>
    )
  }

  if (roleState.status === 'error') {
    return (
      <section aria-labelledby="role-editor-heading" data-testid="role-editor-page">
        <PageHeader title={t.title} titleId="role-editor-heading" back={backLink} />
        <ErrorBanner message={roleState.message} onRetry={handleRoleRetry} />
      </section>
    )
  }

  const role = roleState.role
  const rules = draftRules ?? []
  const catalogReady = catalogState.status === 'loaded'

  return (
    <section aria-labelledby="role-editor-heading" data-testid="role-editor-page">
      <PageHeader
        title={t.title}
        titleId="role-editor-heading"
        back={backLink}
        status={role.isSystem ? <SystemBadge /> : undefined}
        actions={
          <Button
            variant="danger"
            aria-disabled={role.isSystem}
            title={role.isSystem ? strings.badges.systemTitle : undefined}
            onClick={() => {
              if (!role.isSystem) setDeleteModalOpen(true)
            }}
            data-testid="role-delete-button"
          >
            {t.deleteRole}
            {role.isSystem && (
              <span className="sr-only">{strings.common.disabledReason(strings.badges.systemTitle)}</span>
            )}
          </Button>
        }
      />

      {deleteModalOpen && (
        <ConfirmDeleteModal
          title={strings.roles.deleteTitle}
          itemName={role.name}
          isDeleting={deleting}
          errorMessage={deleteError}
          onConfirm={() => void handleDeleteConfirm()}
          onCancel={() => {
            setDeleteModalOpen(false)
            setDeleteError(null)
          }}
        />
      )}

      {guardrail && (
        <GuardrailDialog title={guardrail.title} message={guardrail.message} onAcknowledge={() => setGuardrail(null)} />
      )}

      <SuccessBanner message={created} onDismiss={() => setCreated(null)} testId="role-created" className="mb-4" />

      <div className="flex flex-col gap-4">
        {/* Details — name and description, saved together (INC-16: library Fields) */}
        <Card title={t.detailsTitle}>
          <div className="flex flex-col gap-3 max-w-md">
            <Field
              label={strings.common.fields.name}
              required
              error={
                headerSave.nameError && (
                  <span role="alert" data-testid="role-name-error">
                    {headerSave.nameError}
                  </span>
                )
              }
            >
              {(control) => (
                <input
                  {...control}
                  ref={nameInputRef}
                  type="text"
                  value={headerEdit?.name ?? role.name}
                  onChange={(e) => handleNameInputChange(e.target.value, role)}
                  data-testid="role-name-input"
                />
              )}
            </Field>
            <Field label={strings.common.fields.description}>
              {(control) => (
                <textarea
                  {...control}
                  value={headerEdit?.description ?? role.description ?? ''}
                  onChange={(e) => handleDescriptionInputChange(e.target.value, role)}
                  data-testid="role-description-input"
                  rows={2}
                  className="resize-none"
                />
              )}
            </Field>
            {headerSave.generalError && (
              <p role="alert" className="form-error">
                {headerSave.generalError}
              </p>
            )}
            <div>
              <Button
                size="sm"
                onClick={() => void handleSaveHeader()}
                disabled={headerSave.saving}
                busy={headerSave.saving}
                data-testid="role-header-save"
              >
                {headerSave.saving ? strings.common.actions.saving : t.saveDetails}
              </Button>
            </div>
            <SuccessBanner message={headerSuccess} onDismiss={() => setHeaderSuccess(null)} testId="role-header-success" />
          </div>
        </Card>

        {/* Rules — the draft list, the composer and Save / Discard */}
        <Card title={t.rulesTitle}>
          {rules.length === 0 && (
            <p data-testid="rules-empty-state" className="text-sm text-soft">
              {t.rulesEmpty}
            </p>
          )}

          {rules.length > 0 && (
            <ul data-testid="role-rules-list" aria-label={t.rulesLabel} className="flex flex-col gap-2">
              {rules.map((rule, index) => {
                const label = t.ruleLabel(
                  labelForResource(catalog, rule.resource),
                  labelForAction(catalog, rule.resource, rule.action),
                )
                return (
                  <li
                    key={`${rule.resource}-${rule.action}-${index}`}
                    data-testid={`role-rule-${index}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 border rounded border-rule bg-ink"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-text">{label}</span>
                      {chipsForConditions(rule.conditions).map((kind, chipIndex) => (
                        <ConditionChip key={`${kind}-${chipIndex}`} kind={kind} />
                      ))}
                    </div>
                    {catalogReady && (
                      <Button
                        variant="ghost"
                        iconOnly
                        onClick={() => handleRemoveRule(index)}
                        data-testid={`role-rule-remove-${index}`}
                        aria-label={t.removeRule(label)}
                      >
                        <Icon name="close" />
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {/* Rule composer */}
          {catalogState.status === 'error' && (
            <div className="mt-4">
              <ErrorBanner message={catalogState.message} onRetry={handleCatalogRetry} />
            </div>
          )}

          {catalogReady && catalogState.status === 'loaded' && (
            <div className="mt-4">
              {!composer.open && (
                <Button onClick={handleComposerOpen} data-testid="rule-composer-toggle">
                  {t.addRule}
                </Button>
              )}

              {composer.open && (
                <div className="border rounded p-4 mt-2 border-rule bg-ink" data-testid="rule-composer">
                  <fieldset className="flex flex-col gap-3">
                    <legend className="text-sm font-semibold mb-1 text-text">{t.resourceAndAction}</legend>

                    <Field label={t.resource}>
                      {(control) => (
                        <select
                          {...control}
                          data-testid="rule-composer-resource"
                          value={composer.resourceChoice ?? ''}
                          onChange={(e) => handleResourceChange(e.target.value)}
                        >
                          <option value="" disabled>
                            {t.selectResource}
                          </option>
                          {catalogState.catalog.map((app) => (
                            <optgroup key={app.appId} label={humanizeAppId(app.appId)}>
                              {app.resources.map((res) => (
                                <option key={`${app.appId}::${res.key}`} value={`${app.appId}::${res.key}`}>
                                  {res.label}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      )}
                    </Field>

                    <Field label={t.action}>
                      {(control) => (
                        <select
                          {...control}
                          data-testid="rule-composer-action"
                          value={composer.actionKey ?? ''}
                          onChange={(e) => handleActionChange(e.target.value)}
                          disabled={!selectedResource}
                        >
                          <option value="" disabled>
                            {t.selectAction}
                          </option>
                          {selectedResource?.actions.map((action) => (
                            <option key={action.key} value={action.key}>
                              {action.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  </fieldset>

                  {/* AC-2.3 a11y hotspot: announces Action-reset / available-conditions changes */}
                  <p aria-live="polite" data-testid="rule-composer-status" className="sr-only">
                    {composer.statusMessage}
                  </p>

                  <fieldset className="mt-4 flex flex-col gap-3">
                    <legend className="text-sm font-semibold mb-1 text-text">{t.conditions}</legend>

                    {!selectedAction && <p className="text-xs text-soft">{t.chooseFirst}</p>}

                    {selectedAction &&
                      !supportsOwnership &&
                      availableAttributeKeys.length === 0 &&
                      !supportsSelfApproval && (
                        <p data-testid="rule-composer-no-conditions" className="text-xs text-soft">
                          {t.noConditions}
                        </p>
                      )}

                    {selectedAction && supportsOwnership && (
                      <div>
                        <span id="rule-composer-ownership-label" className="text-xs font-medium text-soft">
                          {t.ownership}
                        </span>
                        <div
                          role="radiogroup"
                          aria-labelledby="rule-composer-ownership-label"
                          className="flex items-center gap-4 mt-1"
                        >
                          <label className="flex items-center gap-1.5 text-sm text-text">
                            <input
                              type="radio"
                              name="rule-composer-ownership"
                              checked={composer.ownership === 'any'}
                              onChange={() => handleOwnershipChange('any')}
                              data-testid="rule-composer-ownership-any"
                            />
                            {t.anyRecords}
                          </label>
                          <label className="flex items-center gap-1.5 text-sm text-text">
                            <input
                              type="radio"
                              name="rule-composer-ownership"
                              checked={composer.ownership === 'own'}
                              onChange={() => handleOwnershipChange('own')}
                              data-testid="rule-composer-ownership-own"
                            />
                            {t.ownRecordsOnly}
                          </label>
                        </div>
                      </div>
                    )}

                    {selectedAction && availableAttributeKeys.length > 0 && (
                      <fieldset>
                        <legend className="text-xs font-medium text-soft">{t.attributeConditions}</legend>
                        <div className="flex items-center gap-4 mt-1">
                          {availableAttributeKeys.map((attribute) => (
                            <div key={attribute} className="flex items-center gap-1">
                              <label className="flex items-center gap-1.5 text-sm text-text">
                                <input
                                  type="checkbox"
                                  checked={composer.attributes.has(attribute)}
                                  onChange={() => handleAttributeToggle(attribute)}
                                  data-testid={`rule-composer-attr-${attribute}`}
                                />
                                {ATTRIBUTE_LABELS[attribute]}
                              </label>
                              {/* Help affordance — outside the <label> so focusing it never toggles the checkbox. */}
                              <ConditionHelp
                                label={t.helpLabel(ATTRIBUTE_LABELS[attribute], ATTRIBUTE_HELP[attribute])}
                                help={ATTRIBUTE_HELP[attribute]}
                                testId={`rule-composer-attr-${attribute}-help`}
                              />
                            </div>
                          ))}
                        </div>
                      </fieldset>
                    )}

                    {/*
                     * Self-approval restriction (specs/20260721-self-approval-control T4,
                     * ADR 20260721-self-approval-condition-and-403-exception) — deliberately its OWN fieldset, separate from the
                     * entity/department/jobTitle group above (AC-1.1): opposite
                     * polarity (`match:"deny"` vs `match:"user"`), independently
                     * toggleable, and composes with — never replaces — the entity
                     * condition (AC-1.3/AC-2.4).
                     */}
                    {selectedAction && supportsSelfApproval && (
                      <fieldset>
                        <legend className="text-xs font-medium text-soft">{t.segregation}</legend>
                        <div className="flex items-center gap-1 mt-1">
                          <label className="flex items-center gap-1.5 text-sm text-text">
                            <input
                              type="checkbox"
                              checked={composer.selfApproval}
                              onChange={handleSelfApprovalToggle}
                              data-testid="rule-composer-self-approval"
                            />
                            {t.cannotApproveOwn}
                          </label>
                          <ConditionHelp
                            label={t.helpLabel(ATTRIBUTE_LABELS['self-approval'], ATTRIBUTE_HELP['self-approval'])}
                            help={ATTRIBUTE_HELP['self-approval']}
                            testId="rule-composer-self-approval-help"
                          />
                        </div>
                      </fieldset>
                    )}
                  </fieldset>

                  <div className="flex items-center justify-end gap-3 mt-4">
                    <Button variant="ghost" onClick={handleComposerCancel} data-testid="rule-composer-cancel">
                      {strings.common.actions.cancel}
                    </Button>
                    <Button
                      onClick={handleAddRule}
                      disabled={!selectedResource || !selectedAction}
                      data-testid="rule-composer-add"
                    >
                      {t.addRule}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer — Save / Discard */}
          <div className="mt-4">
            {saveRulesState.error && (
              <div className="mb-2">
                {/* A failed save: red (INC-20), with the catalog reload as its remedy. */}
                <ErrorBanner
                  tone="danger"
                  message={saveRulesState.error}
                  onRetry={handleReloadCatalogAfterStaleSave}
                  retryLabel={t.reloadCatalog}
                />
              </div>
            )}
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                onClick={() => void handleSaveRules()}
                disabled={saveRulesState.saving || !catalogReady}
                busy={saveRulesState.saving}
                data-testid="role-save-rules"
              >
                {saveRulesState.saving ? strings.common.actions.saving : t.saveRules}
              </Button>
              <Button variant="ghost" onClick={handleDiscardRules} data-testid="role-discard-rules">
                {t.discard}
              </Button>
            </div>
            <SuccessBanner
              message={rulesSuccess}
              onDismiss={() => setRulesSuccess(null)}
              testId="role-rules-success"
              className="mt-2"
            />
          </div>
        </Card>
      </div>
    </section>
  )
}

/**
 * A condition's help: a focusable, named help icon whose native `title`
 * tooltip carries the explanation (house pattern), outside the checkbox's
 * <label> so focusing it never toggles the checkbox.
 */
function ConditionHelp({ label, help, testId }: { label: string; help: string; testId: string }) {
  return (
    <span
      role="img"
      tabIndex={0}
      aria-label={label}
      title={help}
      data-testid={testId}
      className="inline-flex items-center cursor-help text-soft"
    >
      <Icon name="help" />
    </span>
  )
}
