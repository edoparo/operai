import { ConfirmDialog } from '@operai/ui'
import { useState } from 'react'
import { ApiError } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { dismissGap } from '../../lib/meetingsApi'
import type { TimeRange } from '../../lib/types'
import { strings } from '../../strings'
import { clockOf } from './exportText'

export type DismissGapDialogProps = {
  meetingId: string
  gap: TimeRange
  /** The server marked it: the gaps still open. */
  onDismissed: (gaps: TimeRange[]) => void
  /** The gap is gone or the transcript is no longer ready: the page is out of date. */
  onStale: () => void
  onClose: () => void
}

/**
 * "No speech here" (specs/021 A10): the creator listened to a possible gap and nobody speaks in it. It is a
 * confirmation (primary: nothing is deleted, but only a new transcription brings the warning back). A 404 or a 409
 * `not_ready` means the page is out of date, so the dialog closes and the page offers to reload.
 */
export function DismissGapDialog({ meetingId, gap, onDismissed, onStale, onClose }: DismissGapDialogProps) {
  const t = strings.transcript.incomplete.dismissDialog
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const confirm = async () => {
    setFailure(null)
    setBusy(true)
    try {
      onDismissed((await dismissGap(meetingId, gap)).gaps)
    } catch (error) {
      setBusy(false)
      if (error instanceof ApiError && (error.status === 404 || (error.status === 409 && error.code === 'not_ready'))) {
        onStale()
        return
      }
      setFailure(errorMessage(error))
    }
  }

  return (
    <ConfirmDialog
      title={t.title}
      tone="primary"
      confirmLabel={t.confirm}
      busyLabel={t.busy}
      cancelLabel={strings.common.cancel}
      closeLabel={strings.common.close}
      busy={busy}
      error={failure}
      onConfirm={() => void confirm()}
      onCancel={onClose}
      testIdPrefix="meetings-dismiss-gap"
    >
      {t.body(clockOf(gap.startMs), clockOf(gap.endMs))}
    </ConfirmDialog>
  )
}
