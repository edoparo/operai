/**
 * @vitest-environment jsdom
 *
 * PushPrompt — the on-load offer (specs/20261111-push-notifications, AC-1.9). The push library is mocked:
 * its own behaviour (permission, subscribe, the remembered answer) is lib/push.test.ts's business.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/push', async () => {
  class PushError extends Error {
    readonly code: string
    constructor(code: string) {
      super(code)
      this.code = code
    }
  }
  return { PushError, enablePush: vi.fn(), recordPushDeclined: vi.fn() }
})

const push = await import('../lib/push')
const { default: PushPrompt } = await import('./PushPrompt')

const OFFER = { userId: 'user-1', vapidPublicKey: 'key' }

const renderPrompt = () => {
  const onClose = vi.fn()
  render(<PushPrompt offer={OFFER} onClose={onClose} />)
  return onClose
}

const failWith = (code: string) =>
  vi.mocked(push.enablePush).mockRejectedValueOnce(new (push.PushError as unknown as new (c: string) => Error)(code))

beforeEach(() => {
  vi.mocked(push.enablePush).mockReset()
  vi.mocked(push.recordPushDeclined).mockReset()
})

afterEach(cleanup)

describe('PushPrompt (AC-1.9)', () => {
  it('is an Operai question, not the browser prompt: nothing is asked until Turn on', () => {
    renderPrompt()

    expect(screen.getByRole('alertdialog', { name: 'Turn on push notifications?' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'No thanks' })).toBe(document.activeElement)
    expect(push.enablePush).not.toHaveBeenCalled()
  })

  it('Turn on enables push for the offered user and closes', async () => {
    vi.mocked(push.enablePush).mockResolvedValueOnce({
      id: 'dev-1',
      label: 'Chrome',
      createdAt: '2026-11-14T00:00:00Z',
    })
    const onClose = renderPrompt()

    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))

    expect(push.enablePush).toHaveBeenCalledWith(OFFER)
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(push.recordPushDeclined).not.toHaveBeenCalled()
  })

  it('No thanks records the answer and closes', async () => {
    const onClose = renderPrompt()

    await userEvent.click(screen.getByRole('button', { name: 'No thanks' }))

    expect(push.recordPushDeclined).toHaveBeenCalledWith('user-1')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape counts as no', async () => {
    const onClose = renderPrompt()

    await userEvent.keyboard('{Escape}')

    expect(push.recordPushDeclined).toHaveBeenCalledWith('user-1')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('the browser prompt dismissed: recorded as no and closed', async () => {
    failWith('not_allowed')
    const onClose = renderPrompt()

    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(push.recordPushDeclined).toHaveBeenCalledWith('user-1')
  })

  it('notifications blocked in the browser: closed, the browser holds the answer', async () => {
    failWith('blocked')
    const onClose = renderPrompt()

    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(push.recordPushDeclined).not.toHaveBeenCalled()
  })

  it('any other failure stays in the dialog; closing after it is not recorded as no', async () => {
    failWith('subscribe_failed')
    const onClose = renderPrompt()

    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))

    expect((await screen.findByTestId('push-prompt-error')).textContent).toMatch(/couldn't set up push notifications/i)
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'No thanks' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(push.recordPushDeclined).not.toHaveBeenCalled()
  })
})
