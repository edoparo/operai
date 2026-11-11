/**
 * FloatingHost (specs/021-meetings A13, ADR-0078) — mounted once by `ShellLayout`, outside the routed page, so it
 * survives every navigation. It shows the widget a remote asked for (`openFloating` in `shell/session`) in a
 * library `FloatingPanel` the person can move around the window's edge.
 *
 * The rule of every shell↔remote seam (ADR-0030, ADR-0060): the remote's failure is never the shell's. The widget
 * loads through `HostExtension` (5 s timeout, error boundary). If it cannot load, and while a slow load passes
 * `LOADING_FALLBACK_DELAY_MS`, the shell's own fallback still says that a recording is running and offers the way
 * back to it: a microphone that is on must never be invisible.
 *
 * The position is kept in module memory for the tab (nothing persisted, ADR-0001's posture).
 */
import { Button, FloatingPanel } from '@operai/ui'
import type { FloatingInset, PerimeterPosition } from '@operai/ui'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { HostExtension } from '../lib/extensions'
import { getOpenFloating, subscribeFloating } from '../lib/floating'
import type { FloatingEntry } from '../lib/floating'
import * as session from '../lib/session'
import { strings } from '../strings'

const t = strings.floating

/** Bottom-right by default; wherever the person last left it, for the rest of the tab. */
let remembered: PerimeterPosition = { edge: 'bottom', offset: 1 }

/** The meeting page the fallback leads back to (a route path, not copy). */
const MEETING_PATH_PREFIX = '/meetings/m/'
const meetingPath = (meetingId: string) => MEETING_PATH_PREFIX + encodeURIComponent(meetingId)

function RecorderFallback({ meetingId }: { meetingId: string }) {
  return (
    <span className="flex items-center gap-3" data-testid="shell-floating-fallback">
      <span className="text-sm">{t.recorder.fallback}</span>
      <Button size="sm" variant="ghost" onClick={() => session.navigateSuite(meetingPath(meetingId))}>
        {t.recorder.open}
      </Button>
    </span>
  )
}

/**
 * While the widget loads, the fallback appears only if loading takes longer than this: the remote is usually
 * already in the page and answers at once, and a fallback shown for one frame makes the panel jump in size.
 */
export const LOADING_FALLBACK_DELAY_MS = 400

function AfterDelay({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), LOADING_FALLBACK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  return shown ? <>{children}</> : null
}

function Widget({ entry }: { entry: FloatingEntry }) {
  const fallback = <RecorderFallback meetingId={entry.props.meetingId} />
  return (
    <HostExtension
      name={entry.name}
      props={entry.props}
      fallback={fallback}
      loading={<AfterDelay>{fallback}</AfterDelay>}
    />
  )
}

export default function FloatingHost({ inset }: { inset?: FloatingInset }) {
  const entries = useSyncExternalStore(subscribeFloating, getOpenFloating, getOpenFloating)
  const [position, setPosition] = useState<PerimeterPosition>(remembered)
  const entry = entries[entries.length - 1]
  if (!entry) return null
  const move = (next: PerimeterPosition) => {
    remembered = next
    setPosition(next)
  }
  return (
    <FloatingPanel
      label={t.recorder.label}
      moveLabel={t.recorder.moveLabel}
      moveHint={t.recorder.moveHint}
      position={position}
      onPositionChange={move}
      inset={inset}
      testId="shell-floating"
    >
      <Widget key={entry.name} entry={entry} />
    </FloatingPanel>
  )
}
