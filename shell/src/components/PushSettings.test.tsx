/**
 * @vitest-environment jsdom
 *
 * Component tests for PushSettings (specs/029-push-notifications, T9; AC-1.1-1.6, 1.8, 3.1, 3.2, 6.1;
 * design.md § Screens & states, § Accessibility). `../lib/push` is replaced at its edge (the calls
 * the browser and notify-api sit behind); `PushError` stays real so the component's error mapping
 * is exercised.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('../lib/session', () => ({
  useSession: vi.fn(() => ({ data: { user: { id: 'u1' } } })),
  apiFetch: vi.fn(),
  getCachedSession: vi.fn(),
  getNotifyBaseUrl: vi.fn(),
  getSession: vi.fn(),
  navigateSuite: vi.fn(),
  onBeforeSignOut: vi.fn(),
}))

vi.mock('../lib/push', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/push')>()
  return {
    ...actual,
    getPushConfig: vi.fn(),
    reconcilePush: vi.fn(),
    listPushDevices: vi.fn(),
    enablePush: vi.fn(),
    disablePush: vi.fn(),
    removePushDevice: vi.fn(),
    isPushSupported: vi.fn(),
    readPermission: vi.fn(),
    subscribePermission: vi.fn(),
  }
})

import * as push from '../lib/push'
import { PushSettings } from './PushSettings'

const m = vi.mocked(push)

const CHROME = { id: 'd1', label: 'Chrome · macOS', createdAt: '2026-10-31T09:00:00.000Z' }
const FIREFOX = { id: 'd2', label: 'Firefox · macOS', createdAt: '2026-10-20T09:00:00.000Z' }
const EDGE = { id: 'd3', label: 'Edge · Windows', createdAt: '2026-10-10T09:00:00.000Z' }

let permissionListener: ((p: NotificationPermission) => void) | undefined

interface Setup {
  config?: Awaited<ReturnType<typeof push.getPushConfig>> | Error
  devices?: (typeof CHROME)[]
  reconcile?: Awaited<ReturnType<typeof push.reconcilePush>>
  supported?: boolean
  permission?: NotificationPermission | null
}

function setup({
  config,
  devices = [],
  reconcile = { status: 'off' },
  supported = true,
  permission = 'default',
}: Setup = {}) {
  m.getPushConfig.mockImplementation(() =>
    config instanceof Error
      ? Promise.reject(config)
      : Promise.resolve(config ?? { enabled: true, vapidPublicKey: 'KEY' }),
  )
  m.reconcilePush.mockResolvedValue(reconcile)
  m.listPushDevices.mockResolvedValue(devices)
  m.isPushSupported.mockReturnValue(supported)
  m.readPermission.mockReturnValue(supported ? permission : null)
  m.subscribePermission.mockImplementation((listener) => {
    permissionListener = listener
    return () => {}
  })
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const toggle = () => screen.getByTestId('account-push-toggle')
const loaded = () => screen.findByTestId('account-push-status')

beforeEach(() => {
  permissionListener = undefined
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('visibility (AC-6.1, AC-1.8)', () => {
  it('renders nothing while the config is pending and when push is disabled', async () => {
    const config = deferred<Awaited<ReturnType<typeof push.getPushConfig>>>()
    setup()
    m.getPushConfig.mockReturnValue(config.promise)
    const { container } = render(<PushSettings />)
    expect(container.innerHTML).toBe('')
    await act(async () => config.resolve({ enabled: false }))
    expect(container.innerHTML).toBe('')
    expect(m.listPushDevices).not.toHaveBeenCalled()
  })

  it('shows a warning Banner with Retry when the config cannot be loaded, and retry refetches (AC-1.8)', async () => {
    setup({ config: new push.PushError('generic') })
    render(<PushSettings />)
    const banner = await screen.findByTestId('account-push-load-error')
    expect(banner.textContent).toContain("Couldn't load your push notification settings.")
    expect(screen.getByRole('heading', { name: 'Push notifications' })).toBeTruthy()
    expect(screen.queryByTestId('account-push-toggle')).toBeNull()

    setup({ devices: [CHROME] })
    fireEvent.click(within(banner).getByRole('button', { name: 'Retry' }))
    await loaded()
    expect(m.getPushConfig).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('account-push-device-d1')).toBeTruthy()
  })

  it('treats an unverified reconcile and a failed device list as load-failed, without the toggle', async () => {
    setup({ reconcile: { status: 'unverified' } })
    const { unmount } = render(<PushSettings />)
    expect((await screen.findByTestId('account-push-load-error')).textContent).toContain("Couldn't load")
    expect(screen.queryByTestId('account-push-toggle')).toBeNull()
    unmount()

    setup()
    m.listPushDevices.mockRejectedValue(new push.PushError('generic'))
    render(<PushSettings />)
    expect((await screen.findByTestId('account-push-load-error')).textContent).toContain("Couldn't load")
    expect(screen.queryByTestId('account-push-toggle')).toBeNull()
  })

  it('still shows the unsupported card when the load failed (it needs no server state)', async () => {
    setup({ config: new push.PushError('generic'), supported: false })
    render(<PushSettings />)
    await screen.findByTestId('account-push-load-error')
    expect(screen.getByTestId('account-push-status').textContent).toBe('Not available')
  })

  it('announces the loading state politely', async () => {
    const list = deferred<(typeof CHROME)[]>()
    setup()
    m.listPushDevices.mockReturnValue(list.promise)
    render(<PushSettings />)
    const line = await screen.findByText('Loading push notification settings…')
    expect(line.getAttribute('aria-live')).toBe('polite')
    await act(async () => list.resolve([]))
  })
})

describe('this browser, off (AC-1.1)', () => {
  it('shows Off and Turn on, and never asks for permission on load', async () => {
    setup({ devices: [CHROME, FIREFOX] })
    render(<PushSettings />)
    expect((await loaded()).textContent).toBe('Off')
    expect(toggle().textContent).toBe('Turn on')
    expect(m.enablePush).not.toHaveBeenCalled()
    expect(screen.getByText('Your browser will ask for permission to show notifications.')).toBeTruthy()
  })

  it('shows the push section as a sibling outside the address region heading structure', async () => {
    setup()
    render(<PushSettings />)
    await loaded()
    const section = screen.getByTestId('account-push-section')
    expect(section.tagName).toBe('SECTION')
    expect(section.getAttribute('aria-labelledby')).toBe('account-push-heading')
    expect(document.getElementById('account-push-heading')?.tagName).toBe('H2')
  })
})

describe('this browser, on (AC-1.7, AC-3.1)', () => {
  it('shows On, Turn off, and marks only this browser in the device list with formatted dates', async () => {
    setup({ devices: [CHROME, FIREFOX], reconcile: { status: 'on', deviceId: 'd1' } })
    render(<PushSettings />)
    expect((await loaded()).textContent).toContain('On')
    expect(toggle().textContent).toBe('Turn off')
    const chrome = screen.getByTestId('account-push-device-d1')
    expect(chrome.textContent).toContain('Chrome · macOS')
    expect(chrome.textContent).toContain('This browser')
    expect(chrome.textContent).toContain('31.10.2026')
    const firefox = screen.getByTestId('account-push-device-d2')
    expect(firefox.textContent).not.toContain('This browser')
    expect(
      within(firefox)
        .getByRole('button', { name: 'Remove Firefox · macOS, turned on 20.10.2026' })
        .getAttribute('aria-haspopup'),
    ).toBe('dialog')
  })
})

describe('unsupported browser (AC-1.6)', () => {
  it('says so, offers no Turn on, and still lists devices with Remove', async () => {
    setup({ supported: false, devices: [FIREFOX] })
    render(<PushSettings />)
    await loaded()
    expect(screen.getByTestId('account-push-status').textContent).toBe('Not available')
    expect(screen.queryByTestId('account-push-toggle')).toBeNull()
    expect(screen.getByText(/not available on this browser/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Remove Firefox/ })).toBeTruthy()
  })
})

describe('blocked browser (AC-1.4)', () => {
  it('shows Blocked with a static note, no Turn on, and does not steal focus', async () => {
    setup({ permission: 'denied' })
    render(<PushSettings />)
    await loaded()
    expect(screen.getByTestId('account-push-status').textContent).toBe('Blocked')
    expect(screen.queryByTestId('account-push-toggle')).toBeNull()
    const banner = screen.getByTestId('account-push-banner')
    expect(banner.getAttribute('role')).toBe('note')
    expect(banner.textContent).toContain('Notifications are blocked for Operai')
    expect(document.activeElement).not.toBe(banner)
  })

  it('goes back to Off, with no announcement, when the user allows notifications in the browser', async () => {
    setup({ permission: 'denied' })
    render(<PushSettings />)
    await loaded()
    m.readPermission.mockReturnValue('default')
    act(() => permissionListener?.('default'))
    expect(screen.getByTestId('account-push-status').textContent).toBe('Off')
    expect(toggle().textContent).toBe('Turn on')
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('turn on (AC-1.2, AC-1.3)', () => {
  it('calls enablePush from the click, shows the busy label, then On with the new device first and focus kept', async () => {
    const enabling = deferred<typeof CHROME>()
    setup({ devices: [FIREFOX] })
    m.enablePush.mockReturnValue(enabling.promise)
    render(<PushSettings />)
    await loaded()
    toggle().focus()
    fireEvent.click(toggle())
    expect(m.enablePush).toHaveBeenCalledWith({ userId: 'u1', vapidPublicKey: 'KEY' })
    expect(toggle().textContent).toBe('Waiting for your browser…')
    expect(toggle().getAttribute('aria-busy')).toBe('true')
    fireEvent.click(toggle())
    expect(m.enablePush).toHaveBeenCalledTimes(1)

    await act(async () => enabling.resolve(CHROME))
    expect(screen.getByTestId('account-push-status').textContent).toContain('On')
    expect(toggle().textContent).toBe('Turn off')
    expect(document.activeElement).toBe(toggle())
    const rows = within(screen.getByTestId('account-push-devices')).getAllByRole('row').slice(1)
    expect(rows[0].getAttribute('data-testid')).toBe('account-push-device-d1')
    expect(rows[0].textContent).toContain('This browser')
    const banner = screen.getByTestId('account-push-banner')
    expect(banner.getAttribute('role')).toBe('status')
    expect(banner.textContent).toContain('Push notifications are on for this browser.')
  })

  it('refused (permission now denied): shows Blocked, removes Turn on and moves focus to the banner', async () => {
    setup()
    m.enablePush.mockRejectedValue(new push.PushError('blocked'))
    render(<PushSettings />)
    await loaded()
    m.readPermission.mockReturnValue('denied')
    fireEvent.click(toggle())
    await waitFor(() => expect(screen.getByTestId('account-push-status').textContent).toBe('Blocked'))
    expect(screen.queryByTestId('account-push-toggle')).toBeNull()
    const banner = screen.getByTestId('account-push-banner')
    expect(banner.getAttribute('role')).toBe('status')
    expect(banner.getAttribute('tabindex')).toBe('-1')
    expect(banner.textContent).toContain('Notifications are blocked')
    expect(document.activeElement).toBe(banner)
  })

  it('a later passive block is static again: the refusal flag does not outlive an allowed permission', async () => {
    setup()
    m.enablePush.mockRejectedValue(new push.PushError('blocked'))
    render(<PushSettings />)
    await loaded()
    fireEvent.click(toggle())
    await waitFor(() => expect(screen.getByTestId('account-push-status').textContent).toBe('Blocked'))
    act(() => permissionListener?.('default'))
    expect(toggle().textContent).toBe('Turn on')
    act(() => permissionListener?.('denied'))
    expect(screen.getByTestId('account-push-banner').getAttribute('role')).toBe('note')
  })

  it('dismissed prompt: stays Off, keeps Turn on and its focus, explains politely', async () => {
    setup()
    m.enablePush.mockRejectedValue(new push.PushError('not_allowed'))
    render(<PushSettings />)
    await loaded()
    toggle().focus()
    fireEvent.click(toggle())
    const banner = await screen.findByTestId('account-push-banner')
    expect(banner.getAttribute('role')).toBe('status')
    expect(banner.textContent).toContain("didn't allow notifications")
    expect(toggle().textContent).toBe('Turn on')
    expect(toggle().getAttribute('aria-busy')).toBeNull()
    expect(document.activeElement).toBe(toggle())
    expect(screen.getByTestId('account-push-status').textContent).toBe('Off')
  })

  it.each([
    ['generic', "Couldn't change push notifications."],
    ['device_limit', 'You already have 20 devices.'],
    ['endpoint_not_allowed', "This browser's notification service isn't supported"],
    ['push_disabled', 'Push notifications are switched off right now.'],
    ['subscribe_failed', "Your browser couldn't set up push notifications."],
  ] as const)(
    'a %s failure shows a danger alert above the button and Turn on stays as the retry',
    async (code, text) => {
      setup()
      m.enablePush.mockRejectedValue(new push.PushError(code))
      render(<PushSettings />)
      await loaded()
      fireEvent.click(toggle())
      const banner = await screen.findByTestId('account-push-banner')
      expect(banner.getAttribute('role')).toBe('alert')
      expect(banner.textContent).toContain(text)
      expect(toggle().textContent).toBe('Turn on')
      expect(screen.getByTestId('account-push-status').textContent).toBe('Off')
      expect(banner.compareDocumentPosition(toggle()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      m.enablePush.mockResolvedValue(CHROME)
      fireEvent.click(toggle())
      await waitFor(() => expect(toggle().textContent).toBe('Turn off'))
      expect(screen.queryByText(text)).toBeNull()
    },
  )

  it('treats a non-PushError rejection as generic', async () => {
    setup()
    m.enablePush.mockRejectedValue(new Error('boom'))
    render(<PushSettings />)
    await loaded()
    fireEvent.click(toggle())
    expect((await screen.findByTestId('account-push-banner')).textContent).toContain("Couldn't change")
  })
})

describe('turn off (AC-1.5)', () => {
  it('turns off: busy label, then Off, Turn on, the row leaves the list, focus stays, success banner', async () => {
    const disabling = deferred<void>()
    setup({ devices: [CHROME, FIREFOX], reconcile: { status: 'on', deviceId: 'd1' } })
    m.disablePush.mockReturnValue(disabling.promise)
    render(<PushSettings />)
    await loaded()
    toggle().focus()
    fireEvent.click(toggle())
    expect(toggle().textContent).toBe('Turning off…')
    await act(async () => disabling.resolve())
    expect(screen.getByTestId('account-push-status').textContent).toBe('Off')
    expect(toggle().textContent).toBe('Turn on')
    expect(document.activeElement).toBe(toggle())
    expect(screen.queryByTestId('account-push-device-d1')).toBeNull()
    expect(screen.getByTestId('account-push-device-d2')).toBeTruthy()
    expect(screen.getByTestId('account-push-banner').textContent).toContain(
      'Push notifications are off for this browser.',
    )
  })

  it('on failure stays On, shows a danger alert, and Turn off is the retry', async () => {
    setup({ devices: [CHROME], reconcile: { status: 'on', deviceId: 'd1' } })
    m.disablePush.mockRejectedValue(new push.PushError('generic'))
    render(<PushSettings />)
    await loaded()
    fireEvent.click(toggle())
    const banner = await screen.findByTestId('account-push-banner')
    expect(banner.getAttribute('role')).toBe('alert')
    expect(banner.textContent).toContain("Couldn't turn off push notifications. Try again.")
    expect(toggle().textContent).toBe('Turn off')
    expect(screen.getByTestId('account-push-device-d1')).toBeTruthy()
  })
})

describe('device list and removal (AC-3.1, AC-3.2)', () => {
  it('shows an empty state when there are no devices', async () => {
    setup()
    render(<PushSettings />)
    await loaded()
    expect(screen.getByText('No devices yet')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('asks for confirmation (focus on Cancel), and Cancel removes nothing', async () => {
    setup({ devices: [CHROME, FIREFOX] })
    render(<PushSettings />)
    await loaded()
    const trigger = screen.getByTestId('account-push-device-remove-d2')
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('Remove Firefox · macOS?')).toBeTruthy()
    expect(
      within(dialog).getByText(
        /It will stop receiving push notifications\. You can turn them on again from that browser\./,
      ),
    ).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByTestId('account-push-remove-cancel'))
    fireEvent.click(screen.getByTestId('account-push-remove-cancel'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(m.removePushDevice).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
  })

  it('removes another device: dialog closes, row gone, success banner names it, focus moves to the next row', async () => {
    setup({ devices: [CHROME, FIREFOX, EDGE], reconcile: { status: 'on', deviceId: 'd1' } })
    m.removePushDevice.mockResolvedValue({ wasThisBrowser: false })
    render(<PushSettings />)
    await loaded()
    fireEvent.click(screen.getByTestId('account-push-device-remove-d2'))
    fireEvent.click(screen.getByTestId('account-push-remove-confirm'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(m.removePushDevice).toHaveBeenCalledWith('d2')
    expect(screen.queryByTestId('account-push-device-d2')).toBeNull()
    expect(screen.getByTestId('account-push-banner').textContent).toContain('Removed Firefox · macOS.')
    expect(toggle().textContent).toBe('Turn off')
    const next = within(screen.getByTestId('account-push-device-d3')).getByRole('rowheader')
    expect(document.activeElement).toBe(next)
  })

  it('focuses the previous row when the last one was removed', async () => {
    setup({ devices: [CHROME, FIREFOX] })
    m.removePushDevice.mockResolvedValue({ wasThisBrowser: false })
    render(<PushSettings />)
    await loaded()
    fireEvent.click(screen.getByTestId('account-push-device-remove-d2'))
    fireEvent.click(screen.getByTestId('account-push-remove-confirm'))
    await waitFor(() => expect(screen.queryByTestId('account-push-device-d2')).toBeNull())
    expect(document.activeElement).toBe(within(screen.getByTestId('account-push-device-d1')).getByRole('rowheader'))
  })

  it('focuses the empty state when the list becomes empty', async () => {
    setup({ devices: [FIREFOX] })
    m.removePushDevice.mockResolvedValue({ wasThisBrowser: false })
    render(<PushSettings />)
    await loaded()
    fireEvent.click(screen.getByTestId('account-push-device-remove-d2'))
    fireEvent.click(screen.getByTestId('account-push-remove-confirm'))
    const heading = await screen.findByText('No devices yet')
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('shows the busy state, then keeps the dialog open with an inline error on failure; Confirm retries', async () => {
    const removing = deferred<{ wasThisBrowser: boolean }>()
    setup({ devices: [FIREFOX] })
    m.removePushDevice.mockReturnValueOnce(removing.promise)
    render(<PushSettings />)
    await loaded()
    fireEvent.click(screen.getByTestId('account-push-device-remove-d2'))
    fireEvent.click(screen.getByTestId('account-push-remove-confirm'))
    expect(screen.getByTestId('account-push-remove-confirm').textContent).toContain('Removing…')
    await act(async () => removing.reject(new push.PushError('generic')))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByTestId('account-push-remove-error').textContent).toContain(
      "Couldn't remove this device. Try again.",
    )
    expect(screen.getByTestId('account-push-device-d2')).toBeTruthy()

    m.removePushDevice.mockResolvedValue({ wasThisBrowser: false })
    fireEvent.click(screen.getByTestId('account-push-remove-confirm'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.queryByTestId('account-push-device-d2')).toBeNull()
  })

  it("removing this browser's row uses its own body and flips the control to Off", async () => {
    setup({ devices: [CHROME, FIREFOX], reconcile: { status: 'on', deviceId: 'd1' } })
    m.removePushDevice.mockResolvedValue({ wasThisBrowser: true })
    render(<PushSettings />)
    await loaded()
    fireEvent.click(screen.getByTestId('account-push-device-remove-d1'))
    expect(
      within(screen.getByRole('alertdialog')).getByText(/This browser will stop receiving push notifications/),
    ).toBeTruthy()
    fireEvent.click(screen.getByTestId('account-push-remove-confirm'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByTestId('account-push-status').textContent).toBe('Off')
    expect(toggle().textContent).toBe('Turn on')
    expect(screen.queryByTestId('account-push-device-d1')).toBeNull()
  })

  it('removes a device from an unsupported browser too', async () => {
    setup({ supported: false, devices: [FIREFOX] })
    m.removePushDevice.mockResolvedValue({ wasThisBrowser: false })
    render(<PushSettings />)
    await loaded()
    fireEvent.click(screen.getByTestId('account-push-device-remove-d2'))
    fireEvent.click(screen.getByTestId('account-push-remove-confirm'))
    await waitFor(() => expect(screen.queryByTestId('account-push-device-d2')).toBeNull())
  })
})
