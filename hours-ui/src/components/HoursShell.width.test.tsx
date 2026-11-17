/**
 * @vitest-environment jsdom
 *
 * HoursShell's column (specs/20261116-record-hours-in-place T10; design S6 "Width", C1): `wide` — the full width, the
 * EstimAI workspace's — while My hours shows the Week, `default` (80 rem) everywhere else: the List, Everyone's hours
 * and Settings, whatever their address carries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', async () =>
  (await import('../test-support/fakeSession')).shellSessionMock(apiFetch, {
    permissions: (await import('../test-support/fakeSession')).READ_ALL_HOLDER,
  }),
)

import { createAppRouter } from '../router'
import { fakeApi } from '../test-support/fakeApi'
import HoursShell from './HoursShell'

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockImplementation(fakeApi())
})
afterEach(() => cleanup())

const renderAt = async (path: string, page: string) => {
  const history = createMemoryHistory({ initialEntries: [path] })
  const router = createAppRouter('/hours', HoursShell, history)
  render(<RouterProvider router={router} />)
  await screen.findByTestId(page)
  return router
}

const isWide = () => screen.getByTestId('hours-shell').classList.contains('tool-width-wide')

describe('the column of the tool (C1)', () => {
  it('is the default width on the List', async () => {
    await renderAt('/hours', 'hours-my-page')
    expect(isWide()).toBe(false)
    expect(screen.getByTestId('hours-shell').className).not.toContain('tool-width')
  })

  it('is wide on the Week', async () => {
    await renderAt('/hours?view=week', 'hours-my-page')
    expect(isWide()).toBe(true)
  })

  it('reads the address with its trailing slash the same: /hours/?view=week is the Week', async () => {
    await renderAt('/hours/?view=week', 'hours-my-page')
    expect(isWide()).toBe(true)
  })

  it('is the default width again on a view this page does not have: ?view=anything-else is the List', async () => {
    await renderAt('/hours?view=month', 'hours-my-page')
    expect(isWide()).toBe(false)
  })

  it('follows the address from the List to the Week and back, without remounting the page', async () => {
    const router = await renderAt('/hours', 'hours-my-page')
    const page = screen.getByTestId('hours-my-page')
    expect(isWide()).toBe(false)

    await act(() => router.navigate({ to: '/', search: { view: 'week' } as never }))
    await waitFor(() => expect(isWide()).toBe(true))

    await act(() => router.navigate({ to: '/', search: {} as never }))
    await waitFor(() => expect(isWide()).toBe(false))
    expect(screen.getByTestId('hours-my-page')).toBe(page)
  })

  it('stays the default width on Everyone’s hours and Settings, which have no Week, even with view=week in the address (WA4)', async () => {
    await renderAt('/hours/all?view=week', 'hours-everyone-page')
    expect(isWide()).toBe(false)
    cleanup()
    await renderAt('/hours/settings?view=week', 'hours-shell')
    expect(isWide()).toBe(false)
  })
})
