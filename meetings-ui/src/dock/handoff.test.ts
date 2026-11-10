/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const shell = vi.hoisted(() => ({
  openFloating: undefined as undefined | ReturnType<typeof vi.fn>,
  closeFloating: undefined as undefined | ReturnType<typeof vi.fn>,
}))
vi.mock('shell/session', () => ({
  get openFloating() {
    return shell.openFloating
  },
  get closeFloating() {
    return shell.closeFloating
  },
}))

import type { RecordingSession, SessionSnapshot } from '../capture/session'
import { DOCK, canHandOff, dockSession, handOffToDock, resetHandoffForTests, takeBackFromDock } from './handoff'

// Spec A13: the hand-off between the recording panel and the recorder widget.

function fakeSession(meetingId = 'm1', phase: SessionSnapshot['phase'] = 'recording') {
  let snapshot = { phase } as SessionSnapshot
  return {
    meetingId,
    attach: vi.fn(),
    detach: vi.fn(),
    getSnapshot: () => snapshot,
    set: (next: SessionSnapshot['phase']) => (snapshot = { phase: next } as SessionSnapshot),
  } as unknown as RecordingSession & {
    attach: ReturnType<typeof vi.fn>
    detach: ReturnType<typeof vi.fn>
    set: (p: SessionSnapshot['phase']) => void
  }
}

const unloadPrevented = () => {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

beforeEach(() => {
  shell.openFloating = vi.fn()
  shell.closeFloating = vi.fn()
  resetHandoffForTests()
})
afterEach(() => takeBackFromDock('m1'))

describe('handOffToDock', () => {
  it('holds the session (attach) and asks the shell to show the widget with plain-string props', () => {
    const session = fakeSession()
    expect(handOffToDock(session, 'Kick-off')).toBe(true)
    expect(session.attach).toHaveBeenCalledTimes(1)
    expect(shell.openFloating).toHaveBeenCalledWith(DOCK, { meetingId: 'm1', title: 'Kick-off' })
    expect(dockSession('m1')).toBe(session)
    expect(dockSession('m2')).toBeUndefined()
  })

  it('keeps the tab-close prompt while audio is at stake, and drops it once saved', () => {
    const session = fakeSession()
    handOffToDock(session, 'Kick-off')
    expect(unloadPrevented()).toBe(true)
    session.set('done')
    expect(unloadPrevented()).toBe(false)
  })

  it('is idempotent for the same session', () => {
    const session = fakeSession()
    handOffToDock(session, 'Kick-off')
    handOffToDock(session, 'Kick-off')
    expect(session.attach).toHaveBeenCalledTimes(1)
  })

  it('a shell without the floating slot: false, nothing held, nothing attached', () => {
    shell.openFloating = undefined
    shell.closeFloating = undefined
    const session = fakeSession()
    expect(canHandOff()).toBe(false)
    expect(handOffToDock(session, 'Kick-off')).toBe(false)
    expect(session.attach).not.toHaveBeenCalled()
    expect(unloadPrevented()).toBe(false)
  })

  it('a shell that throws while opening still leaves the session held', () => {
    shell.openFloating = vi.fn(() => {
      throw new Error('boom')
    })
    const session = fakeSession()
    expect(handOffToDock(session, 'Kick-off')).toBe(true)
    expect(dockSession('m1')).toBe(session)
  })
})

describe('takeBackFromDock', () => {
  it('closes the widget, drops the prompt and lets go of the session (detach)', () => {
    const session = fakeSession()
    handOffToDock(session, 'Kick-off')
    takeBackFromDock('m1')
    expect(shell.closeFloating).toHaveBeenCalledWith(DOCK)
    expect(session.detach).toHaveBeenCalledTimes(1)
    expect(dockSession('m1')).toBeUndefined()
    expect(unloadPrevented()).toBe(false)
  })

  it('is a no-op for a meeting the widget does not hold', () => {
    const session = fakeSession()
    handOffToDock(session, 'Kick-off')
    takeBackFromDock('other')
    expect(session.detach).not.toHaveBeenCalled()
    expect(shell.closeFloating).not.toHaveBeenCalled()
  })
})
