/**
 * handoff — passing a live recording from the recording panel to the recorder widget and back (spec A13,
 * ADR 20261110-shell-floating-slot-for-remote-widgets).
 *
 * The panel lives on the meeting page. When the person leaves that page while audio is at stake, the panel asks
 * the shell (through `shell/session`) to show the widget, and the widget's hold keeps the session alive: holders
 * are counted (`RecordingSession.attach/detach`), so the hand-off is "the widget attaches, then the panel detaches"
 * and the session never sees zero holders. Back on the meeting page the panel attaches, then takes the hold back.
 *
 * While the widget holds the session this module also keeps the browser's close-the-tab prompt (AC-2.10): the
 * panel's own one went away with the panel, and the widget may fail to load (the shell then shows its fallback),
 * so the prompt must not depend on the widget's code.
 *
 * A shell that predates the floating slot has no `openFloating`: `handOffToDock` then returns false and the panel
 * keeps today's behaviour (the in-app navigation prompt, a confirmed leave stops and saves).
 *
 * Module-scope memory only: nothing is persisted (AC-4.11).
 */
import * as shellSession from 'shell/session'
import type { RecordingSession, SessionSnapshot } from '../capture/session'

/** The shell's name for the widget; its props are plain strings (ADR 20261104-host-extension-federated-panel-through-the-shell). */
export const DOCK = 'meetings.recorderDock'
export type DockProps = { meetingId: string; title: string }

type FloatingApi = {
  openFloating: (name: typeof DOCK, props: DockProps) => void
  closeFloating: (name: typeof DOCK) => void
}

/** The shell's floating slot, or null when this shell has none (a federated module may throw on a missing export). */
function floatingApi(): FloatingApi | null {
  try {
    const api = shellSession as unknown as Partial<FloatingApi>
    return typeof api.openFloating === 'function' && typeof api.closeFloating === 'function'
      ? (api as FloatingApi)
      : null
  } catch {
    return null
  }
}

/** True when the shell can show the widget, so leaving the meeting page needs no prompt. */
export const canHandOff = (): boolean => floatingApi() !== null

/** Audio is at stake: recording, paused, or still being saved. */
export const isAtStake = (snapshot: SessionSnapshot | null): boolean =>
  snapshot !== null && (snapshot.phase === 'recording' || snapshot.phase === 'paused' || snapshot.phase === 'saving')

type Held = { session: RecordingSession; removeUnloadGuard: () => void }
let held: Held | null = null

/**
 * The panel is going away while `session` has audio at stake: the widget takes it. Returns false when the shell
 * has no floating slot (the caller then lets the session stop and save, as before).
 */
export function handOffToDock(session: RecordingSession, title: string): boolean {
  const api = floatingApi()
  if (!api) return false
  if (held?.session === session) return true
  if (held) release(held) // one widget: a newer recording replaces an older, finished one
  session.attach()
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!isAtStake(session.getSnapshot())) return
    event.preventDefault()
    event.returnValue = ''
  }
  window.addEventListener('beforeunload', onBeforeUnload)
  held = { session, removeUnloadGuard: () => window.removeEventListener('beforeunload', onBeforeUnload) }
  try {
    api.openFloating(DOCK, { meetingId: session.meetingId, title })
  } catch {
    // The shell failed to show it: the session is still held and the tab-close prompt still applies.
  }
  return true
}

/** The widget's session for `meetingId`, if it holds one. */
export const dockSession = (meetingId: string): RecordingSession | undefined =>
  held?.session.meetingId === meetingId ? held.session : undefined

function release(current: Held) {
  if (held === current) held = null
  current.removeUnloadGuard()
  try {
    floatingApi()?.closeFloating(DOCK)
  } catch {
    // nothing to close
  }
  current.session.detach()
}

/**
 * The panel is showing `meetingId` again (it has attached already), or the widget is done: the widget lets go
 * and closes. A no-op when the widget does not hold that meeting.
 */
export function takeBackFromDock(meetingId: string): void {
  if (held?.session.meetingId === meetingId) release(held)
}

/** Tests only. */
export function resetHandoffForTests(): void {
  held = null
}
