/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// specs/021-meetings A13, ADR-0078: the shell's floating slot. The widget is the meetings remote's
// `./RecorderDock`; here it is a stub, or missing.

const dock = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'throw' }))
vi.mock('meetings/RecorderDock', () => ({
  default: ({ meetingId, title }: { meetingId: string; title: string }) => {
    if (dock.mode === 'throw') throw new Error('widget broke')
    return <span data-testid="dock-stub">{`${meetingId}|${title}`}</span>
  },
}))
const navigate = vi.hoisted(() => vi.fn())
vi.mock('../lib/session', () => ({ navigateSuite: navigate }))

import { closeFloating, openFloating, resetFloatingForTests } from '../lib/floating'
import { strings } from '../strings'
import FloatingHost from './FloatingHost'

const t = strings.floating.recorder

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
  })
}

afterEach(() => {
  cleanup()
  resetFloatingForTests()
  dock.mode = 'ok'
  navigate.mockReset()
  vi.spyOn(console, 'error').mockRestore()
})

describe('FloatingHost', () => {
  it('shows nothing until a remote opens a widget, then the widget in a movable named region, until it is closed', async () => {
    render(<FloatingHost />)
    expect(screen.queryByTestId('shell-floating')).toBeNull()

    act(() => openFloating('meetings.recorderDock', { meetingId: 'm1', title: 'Kick-off' }))
    await settle()
    expect(screen.getByRole('region', { name: t.label })).not.toBeNull()
    expect(screen.getByRole('button', { name: t.moveLabel })).not.toBeNull()
    expect((await screen.findByTestId('dock-stub')).textContent).toBe('m1|Kick-off')

    act(() => closeFloating('meetings.recorderDock'))
    expect(screen.queryByTestId('shell-floating')).toBeNull()
  })

  it('a widget that throws is replaced by the shell fallback, which still says a recording runs and leads back to it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dock.mode = 'throw'
    render(<FloatingHost />)
    act(() => openFloating('meetings.recorderDock', { meetingId: 'm1', title: 'Kick-off' }))
    await settle()
    const fallback = await screen.findByTestId('shell-floating-fallback')
    expect(fallback.textContent).toContain(t.fallback)
    act(() => screen.getByRole('button', { name: t.open }).click())
    expect(navigate).toHaveBeenCalledWith('/meetings/m/m1')
  })

  it('a widget that loads at once never shows the loading fallback; a slow one shows it after the delay', async () => {
    render(<FloatingHost />)
    act(() => openFloating('meetings.recorderDock', { meetingId: 'm1', title: 'Kick-off' }))
    expect(screen.queryByTestId('shell-floating-fallback')).toBeNull()
    await settle()
    expect(screen.queryByTestId('shell-floating-fallback')).toBeNull()
    expect(await screen.findByTestId('dock-stub')).not.toBeNull()
  })

  it('moving it with the keyboard keeps the new place when it is opened again in the same tab', async () => {
    render(<FloatingHost />)
    act(() => openFloating('meetings.recorderDock', { meetingId: 'm1', title: 'Kick-off' }))
    await settle()
    const region = () => screen.getByTestId('shell-floating')
    expect(region().getAttribute('data-edge')).toBe('bottom')
    act(() => {
      screen
        .getByRole('button', { name: t.moveLabel })
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    })
    const moved = region().getAttribute('data-edge')
    expect(moved).toBe('right')
    act(() => closeFloating('meetings.recorderDock'))
    act(() => openFloating('meetings.recorderDock', { meetingId: 'm1', title: 'Kick-off' }))
    await settle()
    expect(region().getAttribute('data-edge')).toBe(moved)
  })
})
