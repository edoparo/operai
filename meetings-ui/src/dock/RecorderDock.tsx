/**
 * RecorderDock — the recorder widget (`./RecorderDock`, spec A13, ADR 20261110-shell-floating-slot-for-remote-widgets): what the shell's floating slot shows
 * while a recording runs and the person is elsewhere in Operai. The shell owns the frame (position, dragging,
 * the fallback when this module cannot load); this owns the content: the state, the elapsed time, how loud the
 * microphone ("in") and the shared tab ("out") are, Pause / Resume, Stop, a way back to the meeting and, when the
 * meeting has one, its agenda with the covered ticks.
 *
 * Props are plain strings (ADR 20261104-host-extension-federated-panel-through-the-shell). The live session is found through the hand-off (`dockSession`): a widget
 * mounted with no session in this tab (it ended, or the module was loaded twice) shows only the way back.
 */
import { Button, Icon, VisuallyHidden, formatDuration } from '@operai/ui'
import { useCallback, useEffect, useReducer, useSyncExternalStore } from 'react'
import * as shellSession from 'shell/session'
import type { SessionSnapshot } from '../capture/session'
import { strings } from '../strings'
import { dockSession, takeBackFromDock } from './handoff'
import type { DockProps } from './handoff'
import DockAgenda from './DockAgenda'
import { LevelWave } from './LevelWave'

const t = strings.dock

/** A saved recording leaves the widget up this long, then it closes by itself. */
export const SAVED_CLOSE_MS = 8_000

const noop = () => undefined
const NO_SUBSCRIBE = () => noop
const NO_SNAPSHOT = (): SessionSnapshot | null => null

function statusText(snapshot: SessionSnapshot | null): string {
  switch (snapshot?.phase) {
    case 'recording':
    case 'requesting':
      return t.status.recording
    case 'paused':
      return t.status.paused
    case 'saving':
      return t.status.saving
    case 'done':
      return t.status.saved
    case 'failed':
      return t.status.failed
    default:
      return t.status.unknown
  }
}

export default function RecorderDock({ meetingId }: DockProps) {
  const session = dockSession(meetingId)
  const snapshot = useSyncExternalStore<SessionSnapshot | null>(
    session ? session.subscribe : NO_SUBSCRIBE,
    session ? session.getSnapshot : NO_SNAPSHOT,
  )
  const phase = snapshot?.phase
  const recording = phase === 'recording'
  const live = recording || phase === 'paused'

  // The clock: one render a second while time passes (not a live region).
  const [, tick] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    if (!recording) return
    const timer = setInterval(tick, 1_000)
    return () => clearInterval(timer)
  }, [recording])

  // A saved recording closes the widget after a moment; a failed one stays until closed.
  useEffect(() => {
    if (phase !== 'done') return
    const timer = setTimeout(() => takeBackFromDock(meetingId), SAVED_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [phase, meetingId])

  const readInput = useCallback(() => session?.levels().input ?? null, [session])
  const readOutput = useCallback(() => session?.levels().output ?? null, [session])
  const hasOutput = live && session?.levels().output !== null && !snapshot?.tabAudioLost

  const openMeeting = () => {
    try {
      shellSession.navigateSuite(`/meetings/m/${encodeURIComponent(meetingId)}`)
    } catch {
      window.location.assign(`/meetings/m/${encodeURIComponent(meetingId)}`)
    }
  }

  const problem = snapshot?.microphoneLost
    ? t.microphoneLost
    : snapshot?.offline
      ? t.offline
      : snapshot?.tabAudioLost && live
        ? t.tabAudioLost
        : null

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="meetings-dock">
      <span className="flex items-center gap-2 text-sm" data-testid="meetings-dock-status">
        <Icon name={phase === 'paused' ? 'pause' : 'mic'} />
        <span>{statusText(snapshot)}</span>
      </span>
      {session && (
        <span role="timer" aria-label={t.elapsed} className="font-mono text-sm" data-testid="meetings-dock-elapsed">
          {formatDuration(session.elapsedMs(), { style: 'clock' })}
        </span>
      )}
      {live && (
        <LevelWave
          read={readInput}
          active={recording}
          label={t.levels.input}
          meterLabel={t.levels.inputLabel}
          barClassName="bg-acc"
          testId="meetings-dock-input"
        />
      )}
      {hasOutput && (
        <LevelWave
          read={readOutput}
          active={recording}
          label={t.levels.output}
          meterLabel={t.levels.outputLabel}
          barClassName="bg-grn"
          testId="meetings-dock-output"
        />
      )}
      {live && session && (
        <>
          <Button
            size="sm"
            iconOnly
            aria-label={recording ? t.pause : t.resume}
            onClick={() => (recording ? session.pause() : void session.resume())}
            data-testid="meetings-dock-pause"
          >
            <Icon name={recording ? 'pause' : 'play'} />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void session.stop()} data-testid="meetings-dock-stop">
            <Icon name="stop" /> {t.stop}
          </Button>
        </>
      )}
      <Button size="sm" variant="ghost" onClick={openMeeting} data-testid="meetings-dock-open">
        {t.open}
      </Button>
      {(phase === 'done' || phase === 'failed') && (
        <Button
          size="sm"
          iconOnly
          variant="ghost"
          aria-label={t.close}
          onClick={() => takeBackFromDock(meetingId)}
          data-testid="meetings-dock-close"
        >
          <Icon name="close" />
        </Button>
      )}
      {problem && (
        <span className="basis-full text-xs text-org-text" data-testid="meetings-dock-problem">
          {problem}
        </span>
      )}
      {live && <DockAgenda meetingId={meetingId} />}
      <VisuallyHidden live>{statusText(snapshot)}</VisuallyHidden>
    </div>
  )
}
