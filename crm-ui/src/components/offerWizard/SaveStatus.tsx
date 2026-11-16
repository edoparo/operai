import { useEffect, useRef } from 'react'
import { formatDateTime, Icon, Spinner, VisuallyHidden } from '@operai/ui'
import { strings } from '../../strings'

const t = strings.offerWizard.save

export type SaveState = 'saved' | 'saving' | 'retrying'

/** A saved state is announced at most this often; a retry is announced at once (design § Accessibility). */
const ANNOUNCE_EVERY_MS = 10_000

/**
 * What autosave is doing, in words (design S9): saved (with the time as a title), saving, retrying. It goes in
 * the page header's `actions` slot, no button. The polite live region speaks the terminal states only,
 * throttled, so typing does not chatter; a conflict or a gone draft is the page's `alert` Banner, not this line.
 */
export default function SaveStatus({ state, savedAt }: { state: SaveState; savedAt?: string }) {
  const liveRef = useRef<HTMLSpanElement>(null)
  const lastSaved = useRef<number | null>(null)

  useEffect(() => {
    if (state === 'saving') return
    const now = Date.now()
    if (state === 'saved') {
      if (lastSaved.current !== null && now - lastSaved.current < ANNOUNCE_EVERY_MS) return
      lastSaved.current = now
    }
    // written straight into the region: an announcement is not state the page renders from
    if (liveRef.current) liveRef.current.textContent = state === 'saved' ? t.saved : t.retrying
  }, [state])

  return (
    <span className="inline-flex items-center gap-2 text-xs text-soft" data-testid="offer-wizard-save-status">
      {state === 'saving' ? (
        <>
          <Spinner />
          <span>{t.saving}</span>
        </>
      ) : state === 'retrying' ? (
        <>
          <Icon name="alert" className="text-org-text" />
          <span className="text-org-text">{t.retrying}</span>
        </>
      ) : (
        <span className="inline-flex items-center gap-2" title={savedAt ? formatDateTime(savedAt) : undefined}>
          <Icon name="check" className="text-grn-text" />
          <span>{t.saved}</span>
        </span>
      )}
      <VisuallyHidden live>
        <span ref={liveRef} />
      </VisuallyHidden>
    </span>
  )
}
