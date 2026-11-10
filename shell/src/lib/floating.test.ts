import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeFloating, getOpenFloating, openFloating, resetFloatingForTests, subscribeFloating } from './floating'

// specs/021-meetings A13, ADR-0078: the floating-slot registry behind `shell/session`'s openFloating/closeFloating.

afterEach(resetFloatingForTests)

describe('floating registry', () => {
  it('open shows a known widget with its plain-string props, close hides it, listeners hear both', () => {
    const listener = vi.fn()
    subscribeFloating(listener)
    openFloating('meetings.recorderDock', { meetingId: 'm1', title: 'Kick-off' })
    expect(getOpenFloating()).toEqual([
      { name: 'meetings.recorderDock', props: { meetingId: 'm1', title: 'Kick-off' } },
    ])
    closeFloating('meetings.recorderDock')
    expect(getOpenFloating()).toEqual([])
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('opening the same widget again replaces its props: one widget per name', () => {
    openFloating('meetings.recorderDock', { meetingId: 'm1', title: 'A' })
    openFloating('meetings.recorderDock', { meetingId: 'm2', title: 'B' })
    expect(getOpenFloating()).toEqual([{ name: 'meetings.recorderDock', props: { meetingId: 'm2', title: 'B' } }])
  })

  it('an unknown name, or props that are not plain strings, are ignored without throwing', () => {
    openFloating('nope' as never, {} as never)
    openFloating('meetings.recorderDock', { meetingId: 'm1', title: { evil: true } } as never)
    openFloating('meetings.recorderDock', { meetingId: 'm1', title: 'x'.repeat(501) })
    expect(getOpenFloating()).toEqual([])
  })

  it('closing what is not open notifies nobody; a throwing listener does not stop the others', () => {
    const quiet = vi.fn()
    subscribeFloating(quiet)
    closeFloating('meetings.recorderDock')
    expect(quiet).not.toHaveBeenCalled()
    subscribeFloating(() => {
      throw new Error('bad listener')
    })
    expect(() => openFloating('meetings.recorderDock', { meetingId: 'm1', title: 'A' })).not.toThrow()
    expect(quiet).toHaveBeenCalledTimes(1)
  })

  it('getOpenFloating is a stable array between changes (useSyncExternalStore)', () => {
    openFloating('meetings.recorderDock', { meetingId: 'm1', title: 'A' })
    expect(getOpenFloating()).toBe(getOpenFloating())
  })
})
