import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { usePermissions } from 'shell/session'
import { importProjectFromJson, uid, DEF_PARAMS } from '../lib/projects'
import { TEMPLATES } from '../lib/templates'
import type { EstimateIdentity, EstimateListItem } from '../lib/estimatesApi'
import * as estimatesApi from '../lib/estimatesApi'
import ImportOfferModal from '../components/ImportOfferModal'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import AccessLevelBadge from '../components/AccessLevelBadge'
import DealBadge from '../components/DealBadge'
import EstimateFilters from '../components/EstimateFilters'
import {
  filtersFromSearch,
  searchFromFilters,
  writeStoredFilters,
} from '../lib/listFilters'
import type { ListFilters, StatusFilter, Whose } from '../lib/listFilters'
import { formatIdentity } from '../lib/identity'
import { useImportOffer } from '../hooks/useImportOffer'
import {
  Banner,
  Button,
  Icon,
  ListRows,
  PageHeader,
  SkeletonRows,
  StatePanel,
  StatusBadge,
  ToolLayout,
  VisuallyHidden,
  formatDate,
  listRowClassName,
  listRowMetaClassName,
} from '@operai/ui'
import { strings } from '../strings'

const t = strings.estimatesList

/**
 * Defensive fallback for a shared row whose `owner` came back `null` despite
 * `access !== 'owner'` — `EstimateListItem`'s contract (estimatesApi.ts) says
 * `owner` is populated whenever the row isn't the caller's own, but
 * `formatIdentity` must never be handed `null`; routing a contract-violating
 * response through the same "unknown" placeholder keeps AC-10.5's "never
 * blank, never a raw id, never an error" bar even then (T14's `formatIdentity`
 * is the one place that owns this decision — this fallback stays a plain
 * data object, not a second rendering rule).
 */
const UNKNOWN_OWNER: EstimateIdentity = { status: 'unknown', name: null }

/**
 * `formatIdentity` (T14, ../lib/identity.ts) is typed to take a full
 * `Identity` (id + status + name) — its own doc comment claims it "accepts
 * this shape too despite the missing id" for the id-less `EstimateIdentity`
 * embedded on `EstimateListItem.owner`, but the actual TS signature still
 * requires `id`, so a bare `EstimateIdentity` doesn't type-check at this call
 * site. `formatIdentity`'s implementation only ever reads `.status`/`.name`
 * (verified by reading it), so padding in the row's own id as a throwaway,
 * unused `id` is behaviorally inert — a narrow workaround kept local to this
 * file rather than widening `identity.ts`'s exported type, which is outside
 * this task's touch list (T23, specs/20260807-estimate-sharing/tasks.md). Flagged
 * back to the caller as a real (if small) T14/T23 contract gap.
 */
const ownerIdentityFor = (item: EstimateListItem) => ({
  id: item.id,
  ...(item.owner ?? UNKNOWN_OWNER),
})

/** The row's date (INC-26): the suite's numeric dd.mm.yyyy; an unparseable value shows a dash. */
const updatedOn = (iso: string): string => (Number.isNaN(Date.parse(iso)) ? '—' : formatDate(iso))

type ListState =
  | { status: 'loading' }
  | { status: 'loaded'; items: EstimateListItem[] }
  | { status: 'error'; message: string }
  /** 403 `oversight_required`: the permission to list everything is not granted (or was withdrawn). */
  | { status: 'denied' }
  /** 503 `authz_unavailable` on `whose=all`: `auth` cannot say whether the caller may. */
  | { status: 'authzUnavailable' }

/** The empty-state copy for a filter combination (design.md § Empty matrix). */
const emptyCopy = (filters: ListFilters): { heading: string; body: string } => {
  const e = t.empty
  if (filters.whose === 'mine') return filters.status === 'open' ? e.mineOpen : e.mineClosed
  return filters.status === 'open' ? e.allOpen : e.allClosed
}

// ---------------------------------------------------------------------------
// Delete modal state
// ---------------------------------------------------------------------------

/**
 * A failed page action (INC-18: never `window.alert()`). Create and Load
 * example failed on the network and can simply be retried — `warning` with
 * Retry; a rejected import file cannot (the person must pick another file) —
 * `danger`, no Retry (INC-20).
 */
type ActionError = { kind: 'create' | 'example' | 'import'; message: string }

type DeleteModalState =
  | { open: false }
  | { open: true; item: EstimateListItem; isDeleting: boolean; error: string | null }

export default function EstimatesPage() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/estimates' })
  const permissions = usePermissions()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [listState, setListState] = useState<ListState>({ status: 'loading' })
  // The caller's own account list, open AND closed, for the import offer only:
  // it dedupes local estimates against the account, so it must never be filtered
  // by the page's Status (a closed estimate would be offered again).
  const [accountList, setAccountList] = useState<EstimateListItem[] | null>(null)
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({ open: false })
  const [actionError, setActionError] = useState<ActionError | null>(null)
  // INC-19: a delete confirms where it happened, above the list.
  const [deletedNotice, setDeletedNotice] = useState(false)

  // ---------------------------------------------------------------------------
  // Filters (specs/20261108-estimate-list-oversight): URL search params, mirrored to sessionStorage
  // ---------------------------------------------------------------------------

  // UX gating only — the server answers 403 to `whose=all` without the permission.
  const canReadAll = permissions.permissions.some((p) => p.resource === 'estimate' && p.action === 'read-all')
  const canOpenCrm =
    permissions.apps.includes('crm') ||
    permissions.permissions.some((p) => p.resource === 'crm' && p.action === 'access')
  // No "loaded" flag exists: an unresolved result is EMPTY_PERMISSIONS (epoch 0, no apps).
  const permissionsLoaded = permissions.epoch > 0 || permissions.apps.length > 0

  const requested = filtersFromSearch(search)
  // `whose=all` from the URL or storage is honoured only with the permission; until
  // permissions have resolved it is neither fetched nor dropped.
  const waitingForPermissions = requested.whose === 'all' && !permissionsLoaded
  const filters: ListFilters = {
    whose: requested.whose === 'all' && canReadAll ? 'all' : 'mine',
    status: requested.status,
  }
  const { whose, status } = filters

  const applyFilters = useCallback(
    (next: ListFilters) => {
      // Stored BEFORE navigating: the route restores a stored choice when entered
      // without params, which would otherwise undo a switch back to the defaults.
      writeStoredFilters(next)
      void navigate({ to: '/estimates', search: searchFromFilters(next), replace: true })
    },
    [navigate],
  )

  useEffect(() => {
    if (requested.whose === 'all' && permissionsLoaded && !canReadAll) {
      applyFilters({ whose: 'mine', status: requested.status })
    }
  }, [requested.whose, requested.status, permissionsLoaded, canReadAll, applyFilters])

  useEffect(() => {
    if (!waitingForPermissions) writeStoredFilters(filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `filters` is rebuilt every render; its two fields are the deps
  }, [whose, status, waitingForPermissions])

  // ---------------------------------------------------------------------------
  // Load list from API on mount and whenever a filter changes
  // ---------------------------------------------------------------------------

  // Out-of-order responses (a select fires `change` per arrow key) are discarded.
  const requestSeq = useRef(0)

  const fetchList = useCallback(async () => {
    const seq = ++requestSeq.current
    setListState({ status: 'loading' })
    try {
      const items = await estimatesApi.list({ whose, status })
      if (seq !== requestSeq.current) return
      // Sort by updatedAt descending (server may already sort; defensive sort here)
      const sorted = [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      setListState({ status: 'loaded', items: sorted })
    } catch (err) {
      if (seq !== requestSeq.current) return
      if (err instanceof estimatesApi.ApiError && err.status === 403 && err.code === 'oversight_required') {
        setListState({ status: 'denied' })
      } else if (err instanceof estimatesApi.ApiError && err.status === 503 && err.code === 'authz_unavailable') {
        setListState({ status: 'authzUnavailable' })
      } else {
        setListState({ status: 'error', message: whose === 'all' ? t.loadFailedAll : t.loadFailed })
      }
    }
  }, [whose, status])

  useEffect(() => {
    if (waitingForPermissions) return
    void fetchList()
  }, [fetchList, waitingForPermissions])

  const fetchAccountList = useCallback(async () => {
    try {
      setAccountList(await estimatesApi.list())
    } catch {
      // Nothing is offered while the account list is unknown.
      setAccountList(null)
    }
  }, [])

  useEffect(() => {
    void fetchAccountList()
  }, [fetchAccountList])

  const refreshAll = useCallback(() => {
    void fetchList()
    void fetchAccountList()
  }, [fetchList, fetchAccountList])

  // ---------------------------------------------------------------------------
  // Import offer (one-time per session when legacy localStorage estimates exist)
  // AC-5.1 / AC-5.2 / AC-5.3 / AC-5.4
  // ---------------------------------------------------------------------------

  const {
    showOffer,
    localEstimates,
    phase: importPhase,
    results: importResults,
    handleAccept: handleImportAccept,
    handleDecline: handleImportDecline,
    handleClose: handleImportClose,
  } = useImportOffer(accountList, refreshAll)

  // ---------------------------------------------------------------------------
  // Create / open
  // ---------------------------------------------------------------------------

  const handleNew = useCallback(async () => {
    setActionError(null)
    try {
      const estimate = await estimatesApi.create({
        name: t.untitled,
        author: '',
        content: {
          params: { ...DEF_PARAMS },
          releases: [],
          acts: [],
        },
      })
      navigate({ to: '/estimates/$estimateId', params: { estimateId: estimate.id } })
    } catch {
      setActionError({ kind: 'create', message: t.createFailed })
    }
  }, [navigate])

  const handleLoadExample = useCallback(async () => {
    const tpl = TEMPLATES[0] // REST API Backend
    setActionError(null)
    try {
      const estimate = await estimatesApi.create({
        name: tpl.name,
        author: '',
        content: {
          params: { ...DEF_PARAMS },
          releases: tpl.releases.map((r) => ({ ...r, id: uid() })),
          acts: tpl.activities.map((a) => ({ ...a, id: uid(), num: '' })),
        },
      })
      navigate({ to: '/estimates/$estimateId', params: { estimateId: estimate.id } })
    } catch {
      setActionError({ kind: 'example', message: t.exampleFailed })
    }
  }, [navigate])

  const handleOpen = useCallback(
    (id: string) => {
      navigate({ to: '/estimates/$estimateId', params: { estimateId: id } })
    },
    [navigate],
  )

  // ---------------------------------------------------------------------------
  // Delete — accessible ConfirmDeleteModal (T10, AC-3.1 / AC-3.2)
  // ---------------------------------------------------------------------------

  /** Opens the confirm modal for a row's delete button. */
  const handleDeleteRequest = useCallback((item: EstimateListItem) => {
    setDeleteModal({ open: true, item, isDeleting: false, error: null })
  }, [])

  /** Cancel / Escape: close the modal without any API call (AC-3.2). */
  const handleDeleteCancel = useCallback(() => {
    setDeleteModal({ open: false })
  }, [])

  /** Confirm: call the API, refresh list on success, show inline error on failure. */
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteModal.open) return
    const { item } = deleteModal
    setDeleteModal({ open: true, item, isDeleting: true, error: null })
    try {
      await estimatesApi.remove(item.id)
      setDeleteModal({ open: false })
      setDeletedNotice(true)
      refreshAll()
    } catch {
      setDeleteModal({ open: true, item, isDeleting: false, error: t.deleteFailed })
    }
  }, [deleteModal, refreshAll])

  // ---------------------------------------------------------------------------
  // Import JSON (legacy file-based import; T12 handles the localStorage offer)
  // ---------------------------------------------------------------------------

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setActionError(null)
      const reader = new FileReader()
      reader.onload = async (ev) => {
        try {
          // Parse locally to validate shape, then POST to the API
          const raw = ev.target?.result as string
          // Validate shape using importProjectFromJson's parsing logic; we don't
          // want to save to localStorage — just extract the parsed data
          const tempId = importProjectFromJson(raw)
          // importProjectFromJson saves to localStorage as a side effect;
          // read that data back so we can POST it to the API
          const stored = localStorage.getItem(`estimai_project_${tempId}`)
          if (!stored) throw new Error(t.importReadFailed)
          const data = JSON.parse(stored) as {
            name: string
            author: string
            params: import('../types').Parameters
            releases: import('../types').Release[]
            acts: import('../types').Activity[]
          }
          const estimate = await estimatesApi.create({
            name: data.name || t.importedName,
            author: data.author || '',
            content: { params: data.params, releases: data.releases, acts: data.acts },
          })
          navigate({ to: '/estimates/$estimateId', params: { estimateId: estimate.id } })
        } catch (err) {
          const message = err instanceof Error && err.message ? err.message : t.importFailed
          setActionError({ kind: 'import', message })
        }
      }
      reader.readAsText(file)
      e.target.value = ''
    },
    [navigate],
  )

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderListBody = () => {
    if (listState.status === 'denied') {
      return (
        <StatePanel
          title={t.denied.title}
          role="alert"
          focusOnMount
          testId="estimates-denied"
          action={
            <Button variant="secondary" onClick={() => applyFilters({ whose: 'mine', status })}>
              {t.denied.action}
            </Button>
          }
        >
          <p>{t.denied.body}</p>
        </StatePanel>
      )
    }

    if (listState.status === 'loading') {
      return (
        <>
          <VisuallyHidden live>{t.loading}</VisuallyHidden>
          <SkeletonRows rows={3} actions={2} testId="skeleton-list-rows" />
        </>
      )
    }

    if (listState.status === 'authzUnavailable') {
      return (
        <Banner
          tone="warning"
          title={t.authzUnavailableTitle}
          onRetry={() => void fetchList()}
          retryLabel={t.retry}
          data-testid="estimates-authz-unavailable"
        >
          {t.authzUnavailableBody}
        </Banner>
      )
    }

    if (listState.status === 'error') {
      return (
        <Banner tone="warning" onRetry={() => void fetchList()} retryLabel={t.retry}>
          {listState.message}
        </Banner>
      )
    }

    const { items } = listState

    if (items.length === 0) {
      // INC-22: a StatePanel (h3 under the PageHeader's h2). Open-empty no longer
      // means "never created one" (closed estimates are filtered out), so the
      // copy follows the filters; only Mine + Open carries the way forward, since
      // the page header hides "New estimate" there.
      const copy = emptyCopy(filters)
      const firstRun = whose === 'mine' && status === 'open'
      return (
        <StatePanel
          title={copy.heading}
          testId="estimates-empty"
          action={
            firstRun ? (
              <span className="flex gap-2.5 justify-center">
                <Button variant="primary" onClick={() => void handleNew()}>
                  {t.newEstimate}
                </Button>
                <Button variant="secondary" onClick={() => void handleLoadExample()}>
                  {t.loadExample}
                </Button>
              </span>
            ) : undefined
          }
        >
          <p>{copy.body}</p>
          {firstRun && <p className="mt-2 text-2xs font-mono">{t.empty.mineOpen.features}</p>}
        </StatePanel>
      )
    }

    // Populated list (AC-2.1)
    return (
      <>
        <VisuallyHidden live>{t.loadedContext(whose, status, items.length)}</VisuallyHidden>
        {/* INC-14: each row opens one estimate → ListRows. The row is a
            `.list-row` <div>, not a <Link>, because it also holds the owner's
            Delete button (a button cannot sit inside a link) and the Deal badge
            (a link cannot nest in a link); the name and meta line are the row's
            links, Open stays the visible action. */}
        <ListRows label={whose === 'all' ? t.headingAll : t.heading} testId="estimates-list">
          {items.map((p) => (
            <div
              key={p.id}
              data-testid={
                p.access === 'owner'
                  ? 'estimate-row-owned'
                  : p.access === 'oversight'
                    ? 'estimate-row-oversight'
                    : 'estimate-row-shared'
              }
              className={`${listRowClassName} is-interactive`}
            >
              <div className="flex-1 min-w-0">
                <span className="flex items-center gap-2">
                  <Link
                    to="/estimates/$estimateId"
                    params={{ estimateId: p.id }}
                    tabIndex={-1}
                    className="min-w-0 text-text no-underline"
                  >
                    <span className="block text-sm font-medium truncate">{p.name || t.untitled}</span>
                  </Link>
                  {p.closedAt && (
                    <StatusBadge status="settled" data-testid="estimate-closed-badge">
                      {strings.lifecycle.statusClosed}
                    </StatusBadge>
                  )}
                  {p.crmDealId && (
                    <DealBadge dealId={p.crmDealId} estimateName={p.name || t.untitled} canOpen={canOpenCrm} />
                  )}
                  {p.access !== 'owner' && <AccessLevelBadge level={p.access} />}
                </span>
                <Link
                  to="/estimates/$estimateId"
                  params={{ estimateId: p.id }}
                  tabIndex={-1}
                  className="block text-text no-underline"
                >
                  <span className={`${listRowMetaClassName} block font-mono mt-0.5`}>
                    {p.access === 'owner' ? (
                      <>
                        {whose === 'all' ? t.you : p.author}
                        {(whose === 'all' || p.author) && t.metaSeparator}
                        {updatedOn(p.updatedAt)}
                      </>
                    ) : (
                      <>
                        <span>{formatIdentity(ownerIdentityFor(p))}</span>
                        {t.metaSeparator}
                        {updatedOn(p.updatedAt)}
                      </>
                    )}
                  </span>
                </Link>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button variant="secondary" size="sm" onClick={() => handleOpen(p.id)}>
                  {t.open}
                </Button>
                {/* Owner-only action — absent on shared and oversight rows, including the
                    orphaned-owner case (AC-10.4/AC-3.3): never rendered-then-disabled. */}
                {p.access === 'owner' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    onClick={() => handleDeleteRequest(p)}
                    title={t.deleteTitle}
                    aria-label={t.deleteAction(p.name || t.untitled)}
                  >
                    <Icon name="trash" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </ListRows>
        {/* No FAB — the page header's "New estimate" is the single, consistent CTA. */}
      </>
    )
  }

  // The empty state of Mine + Open carries its own New estimate / Load example.
  const hideHeaderNew =
    listState.status === 'loaded' && listState.items.length === 0 && whose === 'mine' && status === 'open'

  // Page frame (INC-12): ToolLayout owns the tool title (h1) and the column;
  // PageHeader the page title (h2) and its actions. No <main> — the shell owns it.
  return (
    <ToolLayout title={strings.toolTitle}>
      {/* Import offer modal (one-time per session, AC-5.1) */}
      {showOffer && (
        <ImportOfferModal
          localEstimates={localEstimates}
          phase={importPhase}
          results={importResults}
          onAccept={() => void handleImportAccept()}
          onDecline={handleImportDecline}
          onClose={handleImportClose}
        />
      )}

      {/* Delete confirm modal (AC-3.1 / AC-3.2) */}
      {deleteModal.open && (
        <ConfirmDeleteModal
          estimateName={deleteModal.item.name}
          isDeleting={deleteModal.isDeleting}
          errorMessage={deleteModal.error}
          onConfirm={() => void handleDeleteConfirm()}
          onCancel={handleDeleteCancel}
        />
      )}

      <section aria-labelledby="estimai-estimates-heading">
        <PageHeader
          title={whose === 'all' ? t.headingAll : t.heading}
          titleId="estimai-estimates-heading"
          actions={
            <>
              <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                {t.importJson}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImport}
              />
              {!hideHeaderNew && (
                <Button variant="primary" onClick={() => void handleNew()}>
                  {t.newEstimate}
                </Button>
              )}
            </>
          }
        />

        {actionError && (
          <Banner
            tone={actionError.kind === 'import' ? 'danger' : 'warning'}
            className="mb-4"
            onRetry={
              actionError.kind === 'create'
                ? () => void handleNew()
                : actionError.kind === 'example'
                  ? () => void handleLoadExample()
                  : undefined
            }
            retryLabel={t.retry}
            retryTestId="estimates-action-retry"
            onDismiss={() => setActionError(null)}
            dismissLabel={t.dismiss}
            data-testid="estimates-action-error"
          >
            {actionError.message}
          </Banner>
        )}

        {deletedNotice && (
          <Banner
            tone="success"
            compact
            autoDismiss
            className="mb-4"
            onDismiss={() => setDeletedNotice(false)}
            dismissLabel={t.dismiss}
            data-testid="estimates-deleted-notice"
          >
            {t.deleted}
          </Banner>
        )}

        <EstimateFilters
          whose={whose}
          status={status}
          canChooseWhose={canReadAll}
          onWhoseChange={(next: Whose) => applyFilters({ whose: next, status })}
          onStatusChange={(next: StatusFilter) => applyFilters({ whose, status: next })}
        />

        {renderListBody()}
      </section>
    </ToolLayout>
  )
}
