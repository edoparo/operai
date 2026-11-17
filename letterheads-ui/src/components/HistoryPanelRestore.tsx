import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '@operai/ui'
import type { Entity } from '../lib/types'
import { strings } from '../strings'
import { classifyRestoreFailure, restoreVersion } from './HistoryPanelApi'

export interface RestoreDialogProps {
  entity: Entity
  /** The version to restore. */
  version: number
  /** The entity's active version: the base of the request, and what the sentence says stays as it is. */
  active: number
  /** The form holds changes (or an upload in flight) that the restore replaces: the dialog says so. */
  discardsEdits: boolean
  onCancel: () => void
  /** 201: the restore made version `next` and it is active. */
  onRestored: (next: number) => void
  /** 409: a newer version exists; the caller loads the history again behind the dialog. */
  onConflict: () => void
  /** 403: the person may no longer change this letterhead; the caller turns the page read-only. */
  onLost: () => void
}

/**
 * RestoreDialog — the confirmation before a restore (design F8, AC-4.2, AC-8.7): a primary-tone `ConfirmDialog`
 * that says what happens ("creates version {next} with the same settings and logos as version {n} … the rest of
 * the history stays as it is"). Confirm posts `{ baseVersion }`; busy and an inline error stay in the dialog,
 * which stays open on a refusal or a failure. A conflict says to reload the history and lists no retry of its
 * own: the history behind is loaded again (`onConflict`), and Confirm then uses the version it shows. A 403 says
 * so here and turns the page read-only (`onLost`).
 */
export function RestoreDialog({
  entity,
  version,
  active,
  discardsEdits,
  onCancel,
  onRestored,
  onConflict,
  onLost,
}: RestoreDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The request in flight is not aborted when the dialog goes: the restore happens (or not) at the service either way.
  const running = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // What the answer does is decided with what the page holds when it comes, not when the button was pressed.
  const latest = useRef({ onRestored, onConflict, onLost })
  useEffect(() => {
    latest.current = { onRestored, onConflict, onLost }
  })

  const confirm = () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    restoreVersion(entity, version, active).then(
      (next) => {
        running.current = false
        latest.current.onRestored(next)
      },
      (failure: unknown) => {
        running.current = false
        const outcome = classifyRestoreFailure(failure, version)
        if (outcome.kind === 'conflict') latest.current.onConflict()
        if (outcome.kind === 'lost') latest.current.onLost()
        if (!mounted.current) return
        setBusy(false)
        setError(
          outcome.kind === 'conflict'
            ? strings.restore.conflict
            : outcome.kind === 'lost'
              ? strings.save.lostTitle
              : outcome.message,
        )
      },
    )
  }

  return (
    <ConfirmDialog
      tone="primary"
      title={strings.restore.title(version)}
      confirmLabel={strings.restore.confirm(version)}
      busyLabel={strings.restore.busy}
      cancelLabel={strings.restore.cancel}
      closeLabel={strings.restore.close}
      busy={busy}
      error={error}
      onConfirm={confirm}
      onCancel={onCancel}
      testIdPrefix="letterheads-restore"
    >
      <p className="m-0">{strings.restore.body(version, active + 1, active)}</p>
      {discardsEdits && (
        <p className="mt-2 mb-0" data-testid="letterheads-restore-discards">
          {strings.restore.discards}
        </p>
      )}
    </ConfirmDialog>
  )
}
