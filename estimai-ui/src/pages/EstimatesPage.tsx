import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { importProjectFromJson, uid, DEF_PARAMS } from '../lib/projects'
import { TEMPLATES } from '../lib/templates'
import type { EstimateIdentity, EstimateListItem } from '../lib/estimatesApi'
import * as estimatesApi from '../lib/estimatesApi'
import ImportOfferModal from '../components/ImportOfferModal'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import AccessLevelBadge from '../components/AccessLevelBadge'
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
 * this task's touch list (T23, specs/013-estimate-sharing/tasks.md). Flagged
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [listState, setListState] = useState<ListState>({ status: 'loading' })
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({ open: false })
  const [actionError, setActionError] = useState<ActionError | null>(null)
  // INC-19: a delete confirms where it happened, above the list.
  const [deletedNotice, setDeletedNotice] = useState(false)

  // ---------------------------------------------------------------------------
  // Load list from API on mount
  // ---------------------------------------------------------------------------

  const fetchList = useCallback(async () => {
    setListState({ status: 'loading' })
    try {
      const items = await estimatesApi.list()
      // Sort by updatedAt descending (server may already sort; defensive sort here)
      const sorted = [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      setListState({ status: 'loaded', items: sorted })
    } catch {
      setListState({ status: 'error', message: t.loadFailed })
    }
  }, [])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

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
  } = useImportOffer(fetchList)

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
      void fetchList()
    } catch {
      setDeleteModal({ open: true, item, isDeleting: false, error: t.deleteFailed })
    }
  }, [deleteModal, fetchList])

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
    if (listState.status === 'loading') {
      return (
        <>
          <VisuallyHidden live>{t.loading}</VisuallyHidden>
          <SkeletonRows rows={3} actions={2} testId="skeleton-list-rows" />
        </>
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
      // The COMBINED owned+shared list is empty (AC-2.3): `estimatesApi.list()`
      // returns both in one array, so a user with only shared estimates never
      // lands here. INC-22: a StatePanel (h3 under the PageHeader's h2). Its
      // actions are the way forward because the page header hides "New
      // estimate" in this state.
      return (
        <StatePanel
          title={t.empty.heading}
          testId="estimates-empty"
          action={
            <span className="flex gap-2.5 justify-center">
              <Button variant="primary" onClick={() => void handleNew()}>
                {t.newEstimate}
              </Button>
              <Button variant="secondary" onClick={() => void handleLoadExample()}>
                {t.loadExample}
              </Button>
            </span>
          }
        >
          <p>{t.empty.body}</p>
          <p className="mt-2 text-2xs font-mono">{t.empty.features}</p>
        </StatePanel>
      )
    }

    // Populated list (AC-2.1)
    return (
      <>
        <VisuallyHidden live>{t.loaded(items.length)}</VisuallyHidden>
        {/* INC-14: each row opens one estimate → ListRows. The row is a
            `.list-row` <div>, not a <Link>, because it also holds the owner's
            Delete button (a button cannot sit inside a link); the name and
            meta line are the row's link, Open stays the visible action. */}
        <ListRows label={t.heading} testId="estimates-list">
          {items.map((p) => (
            <div
              key={p.id}
              data-testid={p.access === 'owner' ? 'estimate-row-owned' : 'estimate-row-shared'}
              className={`${listRowClassName} is-interactive`}
            >
              <Link
                to="/estimates/$estimateId"
                params={{ estimateId: p.id }}
                tabIndex={-1}
                className="flex-1 min-w-0 text-text no-underline"
              >
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{p.name || t.untitled}</span>
                  {p.access !== 'owner' && <AccessLevelBadge level={p.access} />}
                  {p.closedAt && (
                    <StatusBadge status="settled" data-testid="estimate-closed-badge">
                      {strings.lifecycle.statusClosed}
                    </StatusBadge>
                  )}
                </span>
                <span className={`${listRowMetaClassName} block font-mono mt-0.5`}>
                  {p.access === 'owner' ? (
                    <>
                      {p.author && `${p.author}${t.metaSeparator}`}
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

              <div className="flex items-center gap-1 shrink-0">
                <Button variant="secondary" size="sm" onClick={() => handleOpen(p.id)}>
                  {t.open}
                </Button>
                {/* Owner-only action — absent on shared rows, including the orphaned-owner
                    case (AC-10.4/AC-3.3): never rendered-then-disabled. */}
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

  const isEmptyOrList = listState.status === 'loaded' && listState.items.length === 0

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
          title={t.heading}
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
              {!isEmptyOrList && (
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

        {renderListBody()}
      </section>
    </ToolLayout>
  )
}
