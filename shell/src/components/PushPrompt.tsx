/**
 * PushPrompt — the on-load offer to turn push on (specs/20261111-push-notifications, AC-1.9).
 *
 * `ShellLayout` mounts it when `findPushOffer` says this user has not answered yet in this browser.
 * It is Operai's own question, never the browser's: the browser asks for notification permission only
 * after "Turn on", because `enablePush` is called straight from that click (Safari refuses a permission
 * request that is not tied to a gesture, and other browsers penalise one shown on load).
 *
 * Answers:
 *   - Turn on and it works -> closed; the profile shows it as on.
 *   - Turn on and the browser blocks notifications -> closed; the blocked permission is the answer.
 *   - Turn on and the browser prompt is dismissed -> recorded as "no", closed.
 *   - Turn on fails for another reason -> the error stays in the dialog; a later "No thanks" is not
 *     recorded (the person said yes), so the offer can return on a later load.
 *   - No thanks, Escape, the backdrop or × -> recorded as "no"; the offer does not come back. The
 *     setting stays in My profile.
 */

import { useRef, useState } from 'react'
import { ConfirmDialog } from '@operai/ui'
import { enablePush, recordPushDeclined } from '../lib/push'
import type { PushOffer } from '../lib/push'
import { describeEnableFailure } from '../lib/pushSettingsModel'
import { strings } from '../strings'

export interface PushPromptProps {
  offer: PushOffer
  onClose: () => void
}

export default function PushPrompt({ offer, onClose }: PushPromptProps) {
  const t = strings.pushPrompt
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)
  const saidYes = useRef(false)

  const turnOn = () => {
    if (busyRef.current) return
    busyRef.current = true
    saidYes.current = true
    setBusy(true)
    setError(null)
    // Called synchronously from the click: the browser's permission prompt is its first await.
    enablePush({ userId: offer.userId, vapidPublicKey: offer.vapidPublicKey }).then(
      () => {
        busyRef.current = false
        onClose()
      },
      (failure: unknown) => {
        busyRef.current = false
        const described = describeEnableFailure(failure)
        if (described.kind === 'blocked') {
          onClose()
          return
        }
        if (described.kind === 'warning') {
          recordPushDeclined(offer.userId)
          onClose()
          return
        }
        setBusy(false)
        setError(described.message)
      },
    )
  }

  const decline = () => {
    if (busyRef.current) return
    if (!saidYes.current) recordPushDeclined(offer.userId)
    onClose()
  }

  return (
    <ConfirmDialog
      tone="primary"
      title={t.title}
      confirmLabel={t.confirm}
      busyLabel={t.busy}
      cancelLabel={t.cancel}
      closeLabel={t.close}
      busy={busy}
      error={error}
      onConfirm={turnOn}
      onCancel={decline}
      testIdPrefix="push-prompt"
    >
      {t.body}
    </ConfirmDialog>
  )
}
