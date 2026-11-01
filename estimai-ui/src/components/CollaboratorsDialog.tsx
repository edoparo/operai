/**
 * CollaboratorsDialog — add/list/change-level/remove/leave collaborators on
 * an estimate (T20/T21, specs/013-estimate-sharing/tasks.md; design.md
 * "## Screens & states → S2 — owner mode, S3 — collaborator/member mode").
 *
 * Two render branches, one component (design.md's Component inventory:
 * "CollaboratorsDialog.tsx, member mode — NEW (same file, second render
 * branch)"), selected by `access` in the default export below:
 *   - `access === 'owner'`      → `OwnerCollaboratorsDialog` (T20): email +
 *     level add form, live list with per-row level switch and remove.
 *   - `access === 'viewer' | 'editor'` → `MemberCollaboratorsDialog` (T21):
 *     deliberately spare — no add form, no collaborator list (the API never
 *     returns other collaborators to a non-owner; `GET …/collaborators` is
 *     owner-only and 403s a collaborator, so there is nothing to fetch here),
 *     just a "Shared with you by {owner}" line, the caller's own access
 *     level, and one Leave action.
 * Both branches own their own state/mutations independently; the outer
 * default export itself has no hooks, so switching `access` across a
 * re-render swaps which component mounts rather than tripping the Rules of
 * Hooks (see the comment at the guard below).
 *
 * `OwnerCollaboratorsDialog` is self-sufficient: it owns its own
 * collaborator-list fetch, its own add/remove/level-change mutations, and
 * reads the signed-in user's own email via `authClient.useSession()` (the
 * same pattern EstimatorApp.tsx already uses for author backfill) for the
 * client-side self-add short-circuit. `MemberCollaboratorsDialog` needs no
 * fetch of its own — the owner identity it displays arrives as a prop
 * (`owner`, the same `EstimateIdentity` shape `estimatesApi.ts`'s
 * `EstimateFull`/`EstimateListItem` already embed) from whatever page loaded
 * the estimate; T22 (the toolbar wiring) is the first real caller of either
 * branch — out of scope here.
 *
 * The frame is @operai/ui's `Dialog` (ADR-0050): backdrop, header with a close icon,
 * modal semantics, focus trap, Escape and focus return.
 *
 * Every failure state named by design.md S2 is a distinct, reachable render:
 *   - generic 422 (`CollaboratorNotEligibleError`) — copy is the fixed server
 *     detail via strings.ts, verbatim, never paraphrased (AC-1.2: must not
 *     hint at which of the two collapsed causes applied).
 *   - 409 already-a-collaborator (`AlreadyCollaboratorError`) — names the
 *     EXISTING level, looked up from the already-fetched collaborator list
 *     (falling back to one re-fetch if the target row isn't loaded yet, e.g.
 *     a fast double-submit before the initial GET resolves) and focuses that
 *     row's level <select> (AC-1.3).
 *   - self-add (`CannotShareWithSelfError`) — both the client-side short-
 *     circuit (own email, no request fired) and the server's alias-address
 *     round trip render the same copy (AC-1.4).
 *   - 429 rate-limited (`RateLimitedError`) — the Add button gets a short
 *     client-side cooldown (no live countdown, per design.md).
 *   - 503 auth-unavailable (`AuthorizationServiceUnavailableError`) — a
 *     visibly different message from the generic 422, on purpose.
 *
 * A11y (design.md "## Accessibility → CollaboratorsDialog (S2/S3)"):
 *   - role="dialog" aria-modal="true", labelled by its title, both branches
 *     (library `Dialog`).
 *   - Focus trap over every currently-enabled focusable element, queried live,
 *     so the owner branch's changing row set is always covered (library).
 *   - Default focus: the email input in owner mode (its natural first
 *     action); the dialog HEADING in member mode (`initialFocus="title"`),
 *     since there is no input to land on there.
 *   - Escape closes the dialog UNLESS a nested confirm layer is open (Remove
 *     in owner mode, Leave in member mode): the library's dialog stack gives
 *     the keyboard to the topmost dialog only, so Escape and Tab belong to the
 *     confirm until it closes, then to this dialog again.
 *   - Every Remove button carries `aria-label="Remove {email}"` (never a bare
 *     close icon) — the icon is decorative (INC-31), the accessible name names the email.
 *   - A visually-hidden `aria-live="polite"` region (always mounted, a
 *     sibling of the interactive elements it describes — Bell.tsx's pattern)
 *     announces add/remove/level-change outcomes in owner mode.
 *   - Inline field errors (generic 422, 409, self, rate-limit, 503, leave
 *     failure) are `role="alert"` — assertive, matching the library Banner's error
 *     convention.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { authClient } from '../lib/authClient'
import * as collaboratorsApi from '../lib/collaboratorsApi'
import {
  AlreadyCollaboratorError,
  AuthorizationServiceUnavailableError,
  CannotShareWithSelfError,
  CollaboratorNotEligibleError,
  InvalidInputError,
  RateLimitedError,
} from '../lib/collaboratorsApi'
import type { CollaboratorGrant } from '../lib/collaboratorsApi'
import type { EstimateAccess, EstimateIdentity } from '../lib/estimatesApi'
import { formatIdentity } from '../lib/identity'
import AccessLevelBadge from './AccessLevelBadge'
import type { AccessLevel } from './AccessLevelBadge'
import {
  Banner,
  Button,
  Dialog,
  Field,
  Icon,
  ListRows,
  SkeletonRows,
  StatePanel,
  VisuallyHidden,
  listRowClassName,
} from '@operai/ui'
import ConfirmDeleteModal from './ConfirmDeleteModal'
import { strings } from '../strings'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * No `Retry-After` header, or a non-numeric one, is the common case at this
 * ceiling (20/10min — nobody hits it by accident). Design.md: "Add button
 * stays disabled for a short client-side cool-down (no live countdown)" —
 * this is that cooldown's fallback length when the server doesn't give one.
 * A pragmatic constant, not an AC-specified value; flagged in the T20 report.
 */
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000

/**
 * An add failure is either about the address typed (INC-16: a field error —
 * red, `aria-invalid`, the input's description) or not about any one field
 * (429, 503, network: a `.form-error` above the button). Both keep the same
 * test id and `role="alert"`.
 */
type AddError = { scope: 'field' | 'form'; message: string }

const levelLabel = (level: AccessLevel): string =>
  level === 'editor' ? strings.sharing.dialog.levelEditor : strings.sharing.dialog.levelViewer

const normalizeEmail = (email: string): string => email.trim().toLowerCase()

const findByEmail = (email: string, collaborators: CollaboratorGrant[]): CollaboratorGrant | undefined => {
  const target = normalizeEmail(email)
  return collaborators.find((c) => normalizeEmail(c.email) === target)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CollaboratorsDialogProps = {
  estimateId: string
  /** The caller's relationship to this estimate — determines dialog mode. */
  access: EstimateAccess
  /**
   * The estimate's owner identity (`estimatesApi.ts`'s `EstimateFull.owner` /
   * `EstimateListItem.owner`) — required content for member mode's "Shared
   * with you by {owner}" line (S3); owner mode ignores it entirely (an owner
   * has no owner of their own estimate to display, mirroring why that field
   * is `null` on the API response in that case). Optional here — rather than
   * required-and-always-passed — purely so T20's existing owner-mode call
   * sites/tests, which never had a reason to pass it, keep compiling
   * unchanged.
   */
  owner?: EstimateIdentity | null
  onClose: () => void
  /**
   * Member mode only: called after a successful Leave, before `onClose`, so
   * the editor can confirm it where the person acted (INC-19).
   */
  onLeft?: () => void
}

type ListStatus = 'loading' | 'error' | 'ready'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CollaboratorsDialog({ estimateId, access, owner, onClose, onLeft }: CollaboratorsDialogProps) {
  // Two mutually-exclusive branch components, chosen by `access`. Neither
  // branch is skipped conditionally *within itself* — each owns and always
  // runs its own hooks in the same order every time IT renders — so this
  // top-level switch (which itself has zero hooks) never risks the Rules of
  // Hooks, even though `access` could in principle change across a
  // re-render (React just unmounts one branch and mounts the other, same as
  // any other conditional-component-type render).
  if (access === 'owner') {
    return <OwnerCollaboratorsDialog estimateId={estimateId} onClose={onClose} />
  }
  return (
    <MemberCollaboratorsDialog
      estimateId={estimateId}
      access={access}
      owner={owner ?? null}
      onClose={onClose}
      onLeft={onLeft}
    />
  )
}

type OwnerCollaboratorsDialogProps = {
  estimateId: string
  onClose: () => void
}

function OwnerCollaboratorsDialog({ estimateId, onClose }: OwnerCollaboratorsDialogProps) {
  const emailInputRef = useRef<HTMLInputElement>(null)
  const rowSelectRefs = useRef(new Map<string, HTMLSelectElement>())
  const isMountedRef = useRef(true)
  // Set on every mount, not only at first render: StrictMode's dev remount
  // runs the cleanup below and would otherwise leave the flag false.
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const { data: session } = authClient.useSession()
  const sessionEmail = session?.user?.email ?? null

  // ---- collaborator list -----------------------------------------------
  const [listStatus, setListStatus] = useState<ListStatus>('loading')
  const [collaborators, setCollaborators] = useState<CollaboratorGrant[]>([])

  const loadList = useCallback(async () => {
    setListStatus('loading')
    try {
      const data = await collaboratorsApi.list(estimateId)
      if (!isMountedRef.current) return
      setCollaborators(data)
      setListStatus('ready')
    } catch {
      if (!isMountedRef.current) return
      setListStatus('error')
    }
  }, [estimateId])

  useEffect(() => {
    void loadList()
  }, [loadList])

  // ---- add form -----------------------------------------------------------
  const [email, setEmail] = useState('')
  const [addLevel, setAddLevel] = useState<AccessLevel>('viewer')
  const [submitting, setSubmitting] = useState(false)
  const [addError, setAddError] = useState<AddError | null>(null)
  const fieldError = (message: string): AddError => ({ scope: 'field', message })
  const formError = (message: string): AddError => ({ scope: 'form', message })
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null)

  useEffect(() => {
    if (rateLimitedUntil === null) return
    const remaining = rateLimitedUntil - Date.now()
    if (remaining <= 0) {
      setRateLimitedUntil(null)
      return
    }
    const timer = setTimeout(() => setRateLimitedUntil(null), remaining)
    return () => clearTimeout(timer)
  }, [rateLimitedUntil])

  const isRateLimited = rateLimitedUntil !== null

  // ---- live-region announcement -------------------------------------------
  const [announcement, setAnnouncement] = useState('')

  // ---- remove flow ----------------------------------------------------------
  const [removeTarget, setRemoveTarget] = useState<CollaboratorGrant | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  // ---- level-change flow ---------------------------------------------------
  const [levelChangingIds, setLevelChangingIds] = useState<ReadonlySet<string>>(new Set())
  const [levelChangeErrors, setLevelChangeErrors] = useState<Record<string, string>>({})

  const focusRow = useCallback((collaboratorId: string) => {
    const el = rowSelectRefs.current.get(collaboratorId)
    if (!el) return
    // jsdom (the test environment) doesn't implement scrollIntoView — guard
    // rather than assume a real browser's full Element API.
    el.scrollIntoView?.({ block: 'center' })
    el.focus()
  }, [])

  const handleAddError = useCallback(
    async (err: unknown, attemptedEmail: string) => {
      if (err instanceof AlreadyCollaboratorError) {
        let existing = findByEmail(attemptedEmail, collaborators)
        if (!existing) {
          // Rare race (double-submit before the initial GET resolved) —
          // one best-effort re-fetch so the message can still name a level.
          try {
            const fresh = await collaboratorsApi.list(estimateId)
            if (isMountedRef.current) setCollaborators(fresh)
            existing = findByEmail(attemptedEmail, fresh)
          } catch {
            // Fall through with existing === undefined — see fallback below.
          }
        }
        setAddError(fieldError(strings.sharing.errors.alreadyCollaborator(levelLabel(existing?.accessLevel ?? addLevel))))
        if (existing) focusRow(existing.id)
        return
      }
      if (err instanceof CannotShareWithSelfError) {
        setAddError(fieldError(strings.sharing.errors.cannotShareWithSelf))
        return
      }
      if (err instanceof CollaboratorNotEligibleError) {
        // Verbatim server detail (design.md: "not paraphrased" — AC-1.2's
        // anti-enumeration property). strings.ts already carries this exact
        // sentence, so reading it here IS reading it verbatim.
        setAddError(fieldError(strings.sharing.errors.notEligible))
        return
      }
      if (err instanceof RateLimitedError) {
        setAddError(formError(strings.sharing.errors.rateLimited))
        const cooldownMs = (err.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS / 1000) * 1000
        setRateLimitedUntil(Date.now() + cooldownMs)
        return
      }
      if (err instanceof AuthorizationServiceUnavailableError) {
        setAddError(formError(strings.sharing.errors.authUnavailable))
        return
      }
      if (err instanceof InvalidInputError) {
        setAddError(fieldError(strings.sharing.errors.invalidEmail))
        return
      }
      setAddError(formError(strings.sharing.errors.genericAddFailed))
    },
    [collaborators, estimateId, addLevel, focusRow],
  )

  const handleAddSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      const trimmed = email.trim()

      // INC-16: a submit that fails validation moves focus to the field.
      if (!EMAIL_PATTERN.test(trimmed)) {
        setAddError(fieldError(strings.sharing.errors.invalidEmail))
        emailInputRef.current?.focus()
        return
      }
      // Client-side self-check (design.md: "short-circuits the common case
      // before any request fires") — the server's post-lookup check on the
      // resolved userId still catches an alias address on the round trip.
      if (sessionEmail && normalizeEmail(trimmed) === normalizeEmail(sessionEmail)) {
        setAddError(fieldError(strings.sharing.errors.cannotShareWithSelf))
        emailInputRef.current?.focus()
        return
      }

      setSubmitting(true)
      setAddError(null)
      try {
        const grant = await collaboratorsApi.add(estimateId, { email: trimmed, accessLevel: addLevel })
        if (!isMountedRef.current) return
        setCollaborators((prev) => [...prev, grant])
        setEmail('')
        setAnnouncement(strings.sharing.dialog.addedAnnouncement(grant.email, levelLabel(grant.accessLevel)))
        emailInputRef.current?.focus()
      } catch (err) {
        if (!isMountedRef.current) return
        await handleAddError(err, trimmed)
      } finally {
        if (isMountedRef.current) setSubmitting(false)
      }
    },
    [email, sessionEmail, estimateId, addLevel, handleAddError],
  )

  const handleConfirmRemove = useCallback(async () => {
    if (!removeTarget) return
    setRemoving(true)
    setRemoveError(null)
    try {
      await collaboratorsApi.remove(estimateId, removeTarget.id)
      if (!isMountedRef.current) return
      setCollaborators((prev) => prev.filter((c) => c.id !== removeTarget.id))
      setAnnouncement(strings.sharing.dialog.removedAnnouncement(removeTarget.email))
      setRemoveTarget(null)
    } catch {
      if (!isMountedRef.current) return
      setRemoveError(strings.sharing.errors.genericRemoveFailed)
    } finally {
      if (isMountedRef.current) setRemoving(false)
    }
  }, [estimateId, removeTarget])

  const handleLevelChange = useCallback(
    async (row: CollaboratorGrant, nextLevel: AccessLevel) => {
      setLevelChangingIds((prev) => new Set(prev).add(row.id))
      setLevelChangeErrors((prev) => {
        if (!(row.id in prev)) return prev
        const next = { ...prev }
        delete next[row.id]
        return next
      })
      try {
        const updated = await collaboratorsApi.updateLevel(estimateId, row.id, { accessLevel: nextLevel })
        if (!isMountedRef.current) return
        setCollaborators((prev) => prev.map((c) => (c.id === row.id ? updated : c)))
        setAnnouncement(strings.sharing.dialog.levelChangedAnnouncement(updated.email, levelLabel(updated.accessLevel)))
      } catch {
        if (!isMountedRef.current) return
        setLevelChangeErrors((prev) => ({ ...prev, [row.id]: strings.sharing.errors.genericLevelChangeFailed }))
      } finally {
        if (isMountedRef.current) {
          setLevelChangingIds((prev) => {
            const next = new Set(prev)
            next.delete(row.id)
            return next
          })
        }
      }
    },
    [estimateId],
  )

  // ---- a11y -----------------------------------------------------------------
  // Focus on the email field, the Tab trap, Escape and focus return come from
  // @operai/ui's Dialog (ADR-0050). Its dialog stack keeps the nested
  // Remove-confirm on top: while it is open, Escape and Tab belong to it alone.

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // INC-16: validate on blur of a touched field (the format only — the
  // server-side causes are only known on submit).
  const handleEmailBlur = () => {
    const trimmed = email.trim()
    if (trimmed === '') return
    if (!EMAIL_PATTERN.test(trimmed)) setAddError(fieldError(strings.sharing.errors.invalidEmail))
    else if (addError?.message === strings.sharing.errors.invalidEmail) setAddError(null)
  }

  // Disabled only while nothing is typed (or a request/cooldown is running,
  // which the form error explains) — never as the only sign of a bad address.
  const canSubmitAdd = email.trim() !== '' && !submitting && !isRateLimited

  const addErrorText = addError && (
    <span role="alert" data-testid="collaborators-dialog-add-error">
      {addError.message}
    </span>
  )

  return (
    <>
      <Dialog
        title={strings.sharing.dialog.title}
        closeLabel={strings.sharing.dialog.close}
        onClose={onClose}
        initialFocusRef={emailInputRef}
        testIdPrefix="collaborators-dialog"
        dialogTestId="collaborators-dialog"
      >

          <p className="text-xs text-soft mb-3 shrink-0">{strings.sharing.dialog.ownerRowLabel}</p>

          {/* Add form — always visible for the owner (design.md S2) */}
          <form noValidate onSubmit={(e) => void handleAddSubmit(e)} className="flex flex-col gap-3 mb-4 shrink-0">
            <Field
              label={strings.sharing.dialog.emailLabel}
              required
              error={addError?.scope === 'field' ? addErrorText : undefined}
            >
              {(control) => (
                <input
                  {...control}
                  ref={emailInputRef}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={handleEmailBlur}
                  placeholder={strings.sharing.dialog.emailPlaceholder}
                  disabled={submitting}
                  data-testid="collaborators-dialog-email-input"
                />
              )}
            </Field>

            <Field
              label={strings.sharing.dialog.levelLabel}
              hint={
                addLevel === 'editor' ? strings.sharing.dialog.levelEditorHint : strings.sharing.dialog.levelViewerHint
              }
            >
              {(control) => (
                <select
                  {...control}
                  value={addLevel}
                  onChange={(e) => setAddLevel(e.target.value as AccessLevel)}
                  disabled={submitting}
                  data-testid="collaborators-dialog-level-select"
                >
                  <option value="viewer">{strings.sharing.dialog.levelViewer}</option>
                  <option value="editor">{strings.sharing.dialog.levelEditor}</option>
                </select>
              )}
            </Field>

            {addError?.scope === 'form' && <p className="form-error">{addErrorText}</p>}

            <Button
              type="submit"
              variant="primary"
              className="self-start"
              disabled={!canSubmitAdd}
              busy={submitting}
              data-testid="collaborators-dialog-add-button"
            >
              {submitting ? strings.sharing.dialog.addingButton : strings.sharing.dialog.addButton}
            </Button>
          </form>

          {/* Collaborator list */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {listStatus === 'loading' && (
              <>
                <VisuallyHidden live>{strings.sharing.dialog.loading}</VisuallyHidden>
                <SkeletonRows rows={2} actions={2} testId="skeleton-list-rows" />
              </>
            )}

            {listStatus === 'error' && (
              <Banner
                tone="warning"
                onRetry={() => void loadList()}
                retryLabel={strings.sharing.dialog.retry}
                data-testid="collaborators-dialog-load-error"
              >
                {strings.sharing.errors.loadFailed}
              </Banner>
            )}

            {listStatus === 'ready' && collaborators.length === 0 && (
              <StatePanel title={strings.sharing.dialog.emptyTitle} testId="collaborators-dialog-empty">
                {strings.sharing.dialog.emptyBody}
              </StatePanel>
            )}

            {listStatus === 'ready' && collaborators.length > 0 && (
              <ListRows label={strings.sharing.dialog.listLabel} testId="collaborators-dialog-list">
                {collaborators.map((row) => (
                  <div
                    key={row.id}
                    className={`${listRowClassName} flex-wrap gap-2`}
                    data-testid={`collaborators-dialog-row-${row.id}`}
                  >
                    <span className="flex-1 text-sm text-text truncate">{row.email}</span>
                    <AccessLevelBadge level={row.accessLevel} />
                    <select
                      ref={(el) => {
                        if (el) rowSelectRefs.current.set(row.id, el)
                        else rowSelectRefs.current.delete(row.id)
                      }}
                      value={row.accessLevel}
                      onChange={(e) => void handleLevelChange(row, e.target.value as AccessLevel)}
                      disabled={levelChangingIds.has(row.id)}
                      aria-label={strings.sharing.dialog.rowLevelLabel(row.email)}
                      data-testid={`collaborators-dialog-row-level-${row.id}`}
                    >
                      <option value="viewer">{strings.sharing.dialog.levelViewer}</option>
                      <option value="editor">{strings.sharing.dialog.levelEditor}</option>
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      onClick={() => {
                        setRemoveTarget(row)
                        setRemoveError(null)
                      }}
                      aria-label={strings.sharing.dialog.removeAction(row.email)}
                      data-testid={`collaborators-dialog-row-remove-${row.id}`}
                    >
                      <Icon name="close" />
                    </Button>
                    {levelChangeErrors[row.id] && (
                      <p role="alert" className="text-2xs text-red-text w-full basis-full">
                        {levelChangeErrors[row.id]}
                      </p>
                    )}
                  </div>
                ))}
              </ListRows>
            )}
          </div>

          {/* Live region — always mounted (Bell.tsx's pattern), separate from inline alerts */}
          <span className="sr-only" aria-live="polite" data-testid="collaborators-dialog-live-region">
            {announcement}
          </span>
      </Dialog>

      {removeTarget && (
        <ConfirmDeleteModal
          estimateName={removeTarget.email}
          isDeleting={removing}
          errorMessage={removeError}
          onConfirm={() => void handleConfirmRemove()}
          onCancel={() => {
            setRemoveTarget(null)
            setRemoveError(null)
          }}
          title={strings.sharing.dialog.removeConfirmTitle}
          bodyText={strings.sharing.dialog.removeConfirmBody(removeTarget.email)}
          confirmLabel={strings.sharing.dialog.removeConfirmButton}
          busyLabel={strings.sharing.dialog.removingButton}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Member mode (T21, design.md S3)
// ---------------------------------------------------------------------------

type MemberCollaboratorsDialogProps = {
  estimateId: string
  /**
   * Narrowed to the two non-owner values — the default export above only
   * ever mounts this branch when `access !== 'owner'`, so `AccessLevel`
   * (`'viewer' | 'editor'`, `EstimateAccess`'s own non-owner half) is exact
   * here, not a cast.
   */
  access: AccessLevel
  owner: EstimateIdentity | null
  onClose: () => void
  onLeft?: () => void
}

/**
 * Deliberately spare (design.md S3): no add form, no collaborator list — the
 * API never returns other collaborators to a non-owner (`GET
 * …/collaborators` is owner-only and 403s a collaborator per plan.md), so
 * there is nothing here to fetch or hide. Just who shared it, the caller's
 * own level, and one Leave action.
 */
function MemberCollaboratorsDialog({ estimateId, access, owner, onClose, onLeft }: MemberCollaboratorsDialogProps) {
  const isMountedRef = useRef(true)
  // Set on every mount, not only at first render: StrictMode's dev remount
  // runs the cleanup below and would otherwise leave the flag false.
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Defensive fallback: `owner` should always be non-null when access !==
  // 'owner' (estimatesApi.ts: "null when access === 'owner'" — the inverse
  // holds), but `formatIdentity` already has a designed "unknown" state for
  // exactly this kind of malformed input, so route through it rather than
  // rendering a blank name if a future caller ever gets this wrong.
  const ownerIdentity: EstimateIdentity = owner ?? { status: 'unknown', name: null }
  const ownerLabel = formatIdentity(ownerIdentity)

  // ---- leave flow -----------------------------------------------------
  const [leaveConfirming, setLeaveConfirming] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)

  const handleConfirmLeave = useCallback(async () => {
    setLeaving(true)
    setLeaveError(null)
    try {
      await collaboratorsApi.leave(estimateId)
      if (!isMountedRef.current) return
      // Success closes both the confirm layer and the dialog itself — the
      // caller no longer has anything to view (design.md: "it will
      // disappear from your estimates list").
      setLeaveConfirming(false)
      onLeft?.()
      onClose()
    } catch {
      if (!isMountedRef.current) return
      setLeaveError(strings.sharing.errors.genericLeaveFailed)
    } finally {
      if (isMountedRef.current) setLeaving(false)
    }
  }, [estimateId, onClose, onLeft])

  // ---- a11y -----------------------------------------------------------------
  // No field to land on: focus starts on the heading (`initialFocus="title"`).
  // Trap, Escape and focus return come from @operai/ui's Dialog, whose dialog
  // stack leaves the keyboard to the nested Leave-confirm while it is open.

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <Dialog
        title={strings.sharing.dialog.title}
        closeLabel={strings.sharing.dialog.close}
        onClose={onClose}
        initialFocus="title"
        testIdPrefix="collaborators-dialog"
        dialogTestId="collaborators-dialog"
      >
          {/* No add form, no collaborator list (design.md S3) — just who
              shared it and the caller's own level. */}
          <p className="text-sm text-text mb-2" data-testid="collaborators-dialog-shared-by">
            {strings.sharing.dialog.sharedWithYouBy(ownerLabel)}
          </p>

          <div className="flex items-center gap-2 mb-5" data-testid="collaborators-dialog-your-access">
            <span className="text-sm text-text">{strings.sharing.dialog.yourAccessLevel(levelLabel(access))}</span>
            {/* Visual echo of the text above — aria-hidden so AT doesn't hear the level announced twice. */}
            <span aria-hidden="true">
              <AccessLevelBadge level={access} />
            </span>
          </div>

          <Button
            variant="danger"
            className="self-start"
            onClick={() => {
              setLeaveConfirming(true)
              setLeaveError(null)
            }}
            data-testid="collaborators-dialog-leave-button"
          >
            {strings.sharing.dialog.leaveAction}
          </Button>
      </Dialog>

      {leaveConfirming && (
        <ConfirmDeleteModal
          estimateName={ownerLabel}
          isDeleting={leaving}
          errorMessage={leaveError}
          onConfirm={() => void handleConfirmLeave()}
          onCancel={() => {
            setLeaveConfirming(false)
            setLeaveError(null)
          }}
          title={strings.sharing.dialog.leaveConfirmTitle}
          bodyText={strings.sharing.dialog.leaveConfirmBody}
          confirmLabel={strings.sharing.dialog.leaveConfirmButton}
          busyLabel={strings.sharing.dialog.leavingButton}
        />
      )}
    </>
  )
}
