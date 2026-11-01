/**
 * @vitest-environment jsdom
 *
 * SuccessBanner (INC-19) and the flash hand-over between screens.
 *
 * Covers:
 *   (A) nothing renders without a message;
 *   (B) a success is a polite role="status" compact banner whose test id
 *       holds exactly the message, dismissed after ~3 s or with ×;
 *   (C) the warning tone (an action that succeeded with a caveat) is an
 *       alert and never auto-dismisses;
 *   (D) flash: a message left for one key is read once by that key only.
 */

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { CONFIRMATION_DISMISS_MS } from '@operai/ui'
import SuccessBanner from './SuccessBanner'
import { clearFlash, peekFlash, setFlash, useFlash } from '../lib/flash'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  clearFlash('users')
  clearFlash('roles')
})

describe('SuccessBanner', () => {
  it('renders nothing without a message', () => {
    const { container } = render(<SuccessBanner message={null} onDismiss={vi.fn()} testId="x" />)
    expect(container.textContent).toBe('')
  })

  it('is a polite, compact success status whose test id holds exactly the message', () => {
    render(<SuccessBanner message="Role deleted" onDismiss={vi.fn()} testId="roles-success" />)

    const banner = screen.getByTestId('roles-success-banner')
    expect(banner.getAttribute('role')).toBe('status')
    expect(banner.className).toContain('banner-success')
    expect(banner.className).toContain('banner-compact')
    expect(screen.getByTestId('roles-success').textContent).toBe('Role deleted')
  })

  it('auto-dismisses after about 3 seconds, and on ×', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<SuccessBanner message="Saved" onDismiss={onDismiss} testId="s" />)

    act(() => {
      vi.advanceTimersByTime(CONFIRMATION_DISMISS_MS - 1)
    })
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('s-dismiss'))
    expect(onDismiss).toHaveBeenCalledTimes(2)
  })

  it('the warning tone is an alert and stays until dismissed', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<SuccessBanner message="Email failed" tone="warning" onDismiss={onDismiss} testId="w" />)

    expect(screen.getByTestId('w-banner').getAttribute('role')).toBe('alert')
    act(() => {
      vi.advanceTimersByTime(CONFIRMATION_DISMISS_MS * 3)
    })
    expect(onDismiss).not.toHaveBeenCalled()
  })
})

describe('flash', () => {
  it('hands a message to the screen with the same key, once', () => {
    setFlash('roles', 'Role "x" deleted')
    expect(peekFlash('users')).toBeNull()

    const { result } = renderHook(() => useFlash('roles'))
    expect(result.current[0]).toBe('Role "x" deleted')
    // Consumed by the effect: a later screen with the same key starts empty.
    expect(peekFlash('roles')).toBeNull()

    act(() => result.current[1](null))
    expect(result.current[0]).toBeNull()
  })

  it('leaves another key’s message alone', () => {
    setFlash('users', 'Deleted Ada')
    clearFlash('roles')
    expect(peekFlash('users')).toBe('Deleted Ada')
  })
})
