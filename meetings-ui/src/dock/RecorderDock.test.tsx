/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const shell = vi.hoisted(() => ({ navigateSuite: vi.fn(), openFloating: vi.fn(), closeFloating: vi.fn() }))
vi.mock('shell/session', () => shell)

import type { RecordingSession, SessionSnapshot } from '../capture/session'
import { en } from '../strings'
import { handOffToDock, resetHandoffForTests, takeBackFromDock } from './handoff'
import RecorderDock, { SAVED_CLOSE_MS } from './RecorderDock'
import { WAVE_SAMPLE_MS } from './LevelWave'

// Spec A13: the recorder widget the shell shows while a recording runs elsewhere in Operai.

const t = en.dock

function fakeSession(levels = { input: 0.5 as number | null, output: null as number | null }) {
  let snapshot = {
    phase: 'recording',
    offline: false,
    microphoneLost: false,
    tabAudioLost: null,
  } as unknown as SessionSnapshot
  const listeners = new Set<() => void>()
  const session = {
    meetingId: 'm1',
    attach: vi.fn(),
    detach: vi.fn(),
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    elapsedMs: () => 75_000,
    levels: () => levels,
    pause: vi.fn(() => update({ phase: 'paused' })),
    resume: vi.fn(async () => update({ phase: 'recording' })),
    stop: vi.fn(async () => update({ phase: 'saving' })),
  }
  const update = (patch: Partial<SessionSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }
  return { session: session as unknown as RecordingSession & typeof session, update }
}

beforeEach(() => {
  vi.useFakeTimers()
  resetHandoffForTests()
  shell.navigateSuite.mockReset()
  shell.closeFloating.mockReset()
})
afterEach(() => {
  takeBackFromDock('m1')
  cleanup()
  vi.useRealTimers()
})

const mount = (levels?: { input: number | null; output: number | null }) => {
  const fake = fakeSession(levels)
  handOffToDock(fake.session, 'Kick-off')
  render(<RecorderDock meetingId="m1" title="Kick-off" />)
  return fake
}

describe('RecorderDock', () => {
  it('shows the state, the elapsed time and the microphone level; no "out" without a shared tab', () => {
    mount()
    expect(screen.getByTestId('meetings-dock-status').textContent).toContain(t.status.recording)
    expect(screen.getByRole('timer', { name: t.elapsed }).textContent).toBe('00:01:15')
    expect(screen.getByRole('meter', { name: t.levels.inputLabel })).not.toBeNull()
    expect(screen.queryByRole('meter', { name: t.levels.outputLabel })).toBeNull()
  })

  it('the waves follow the levels while recording', () => {
    mount({ input: 0.5, output: 0.25 })
    act(() => {
      vi.advanceTimersByTime(WAVE_SAMPLE_MS * 2)
    })
    expect(screen.getByRole('meter', { name: t.levels.inputLabel }).getAttribute('aria-valuenow')).toBe('50')
    expect(screen.getByRole('meter', { name: t.levels.outputLabel }).getAttribute('aria-valuenow')).toBe('25')
  })

  it('Pause, Resume and Stop drive the session', () => {
    const { session } = mount()
    act(() => screen.getByRole('button', { name: t.pause }).click())
    expect(session.pause).toHaveBeenCalled()
    expect(screen.getByTestId('meetings-dock-status').textContent).toContain(t.status.paused)
    act(() => screen.getByRole('button', { name: t.resume }).click())
    expect(session.resume).toHaveBeenCalled()
    act(() => screen.getByRole('button', { name: new RegExp(t.stop) }).click())
    expect(session.stop).toHaveBeenCalled()
    expect(screen.getByTestId('meetings-dock-status').textContent).toContain(t.status.saving)
  })

  it('Open meeting goes back to the meeting through the shell', () => {
    mount()
    act(() => screen.getByRole('button', { name: t.open }).click())
    expect(shell.navigateSuite).toHaveBeenCalledWith('/meetings/m/m1')
  })

  it('once saved it closes by itself after a moment; a failure stays, with Close', () => {
    const saved = mount()
    act(() => saved.update({ phase: 'done' }))
    expect(screen.getByTestId('meetings-dock-status').textContent).toContain(t.status.saved)
    act(() => {
      vi.advanceTimersByTime(SAVED_CLOSE_MS)
    })
    expect(shell.closeFloating).toHaveBeenCalledWith('meetings.recorderDock')
    cleanup()

    shell.closeFloating.mockReset()
    const failed = mount()
    act(() => failed.update({ phase: 'failed' }))
    act(() => {
      vi.advanceTimersByTime(SAVED_CLOSE_MS * 2)
    })
    expect(shell.closeFloating).not.toHaveBeenCalled()
    act(() => screen.getByRole('button', { name: t.close }).click())
    expect(shell.closeFloating).toHaveBeenCalledWith('meetings.recorderDock')
  })

  it('says why saving is stuck', () => {
    const fake = mount()
    act(() => fake.update({ offline: true }))
    expect(screen.getByTestId('meetings-dock-problem').textContent).toBe(t.offline)
    act(() => fake.update({ offline: false, microphoneLost: true }))
    expect(screen.getByTestId('meetings-dock-problem').textContent).toBe(t.microphoneLost)
  })

  it('with no session in this tab it still offers the way back, and no controls', () => {
    render(<RecorderDock meetingId="gone" title="Kick-off" />)
    expect(screen.getByTestId('meetings-dock-status').textContent).toContain(t.status.unknown)
    expect(screen.queryByRole('button', { name: t.pause })).toBeNull()
    expect(screen.getByRole('button', { name: t.open })).not.toBeNull()
  })

  it("has no accessibility violations (inside the shell it sits in the floating panel's named region)", async () => {
    vi.useRealTimers()
    mount({ input: 0.3, output: 0.3 })
    const results = await axe.run(document.body, { rules: { region: { enabled: false } } })
    expect(results.violations.map((v) => v.id)).toEqual([])
  })
})
