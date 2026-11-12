/**
 * @vitest-environment jsdom
 *
 * Unit tests for src/lib/push.ts (specs/029-push-notifications, T8): support detection, enable /
 * disable / remove against a fake PushManager and a fake apiFetch, boot reconciliation, the
 * sign-out release and the service worker's `{navigate}` message.
 *
 * The browser is faked at its edges only: `navigator`, `Notification`, `PushManager`, a minimal
 * `indexedDB` (so the real store code runs) and `apiFetch`. Nothing inside push.ts is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./session', () => ({
  apiFetch: vi.fn(),
  getNotifyBaseUrl: () => 'http://notify.test',
  onBeforeSignOut: vi.fn(() => () => {}),
  navigateSuite: vi.fn(),
  getCachedSession: vi.fn(),
  getSession: vi.fn(),
}))

const session = await import('./session')
const push = await import('./push')

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const NOTIFY = 'http://notify.test'
const USER = 'user-a'
const OTHER_USER = 'user-b'
const VAPID_KEY = 'AQID'
const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36'

const json = (status: number, body: unknown = {}): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

interface FakeSubscription {
  endpoint: string
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } }
  unsubscribe: ReturnType<typeof vi.fn>
}

interface Browser {
  permission: NotificationPermission
  /** What the permission prompt resolves to. */
  promptResult: NotificationPermission
  subscription: FakeSubscription | null
  subscribe: ReturnType<typeof vi.fn>
  getSubscription: ReturnType<typeof vi.fn>
  register: ReturnType<typeof vi.fn>
  getRegistration: ReturnType<typeof vi.fn>
  requestPermission: ReturnType<typeof vi.fn>
  subscribeError: Error | null
  registration: unknown
}

let browser: Browser
let idb: ReturnType<typeof createFakeIndexedDb>

function createFakeIndexedDb() {
  const data = new Map<string, unknown>()
  const state = { failOpen: false, failWrite: false }
  const indexedDB = {
    open: () => {
      const request: Record<string, unknown> = {}
      queueMicrotask(() => {
        if (state.failOpen) {
          request.error = new Error('idb unavailable')
          ;(request.onerror as (() => void) | undefined)?.()
          return
        }
        const db = {
          objectStoreNames: { contains: () => false },
          createObjectStore: () => ({}),
          close: () => {},
          transaction: () => {
            const tx: Record<string, unknown> = {}
            tx.objectStore = () => ({
              get: (key: string) => settle(tx, { result: data.get(key) }),
              put: (value: unknown, key: string) => {
                if (state.failWrite) return fail(tx)
                data.set(key, value)
                return settle(tx, { result: key })
              },
              delete: (key: string) => {
                data.delete(key)
                return settle(tx, { result: undefined })
              },
            })
            return tx
          },
        }
        request.result = db
        ;(request.onupgradeneeded as (() => void) | undefined)?.()
        ;(request.onsuccess as (() => void) | undefined)?.()
      })
      return request
    },
  }
  const settle = (tx: Record<string, unknown>, request: { result: unknown }) => {
    queueMicrotask(() => (tx.oncomplete as (() => void) | undefined)?.())
    return request
  }
  const fail = (tx: Record<string, unknown>) => {
    tx.error = new Error('write failed')
    queueMicrotask(() => (tx.onabort as (() => void) | undefined)?.())
    return { result: undefined }
  }
  return {
    indexedDB,
    state,
    peek: () => [...data.values()][0] as { deviceId: string; userId: string } | undefined,
    seed: (value: unknown) => data.set('this-browser', value),
    size: () => data.size,
  }
}

function makeSubscription(endpoint = 'https://web.push.apple.com/abc'): FakeSubscription {
  const subscription: FakeSubscription = {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'P256', auth: 'AUTH' } }),
    unsubscribe: vi.fn(async () => {
      if (browser.subscription === subscription) browser.subscription = null
      return true
    }),
  }
  return subscription
}

interface BrowserOptions {
  permission?: NotificationPermission
  promptResult?: NotificationPermission
  subscription?: FakeSubscription | null
  userAgent?: string
  userAgentData?: { mobile: boolean }
  withServiceWorker?: boolean
  withPushManager?: boolean
  withNotification?: boolean
}

function installBrowser(options: BrowserOptions = {}) {
  const {
    permission = 'default',
    promptResult = 'granted',
    subscription = null,
    userAgent = SAFARI_UA,
    userAgentData,
    withServiceWorker = true,
    withPushManager = true,
    withNotification = true,
  } = options

  browser = {
    permission,
    promptResult,
    subscription,
    subscribeError: null,
    subscribe: vi.fn(async () => {
      if (browser.subscribeError) throw browser.subscribeError
      browser.subscription = makeSubscription('https://web.push.apple.com/new')
      return browser.subscription
    }),
    getSubscription: vi.fn(async () => browser.subscription),
    register: vi.fn(),
    getRegistration: vi.fn(),
    requestPermission: vi.fn(async () => {
      browser.permission = browser.promptResult
      return browser.promptResult
    }),
    registration: null,
  }
  browser.registration = { pushManager: { subscribe: browser.subscribe, getSubscription: browser.getSubscription } }
  browser.register.mockImplementation(async () => browser.registration)
  browser.getRegistration.mockImplementation(async () => browser.registration)

  const navigatorFake: Record<string, unknown> = { userAgent, ...(userAgentData ? { userAgentData } : {}) }
  if (withServiceWorker) {
    navigatorFake.serviceWorker = {
      register: browser.register,
      getRegistration: browser.getRegistration,
      ready: Promise.resolve(browser.registration),
      addEventListener: vi.fn(),
    }
  }
  vi.stubGlobal('navigator', navigatorFake)
  vi.stubGlobal('PushManager', withPushManager ? class {} : undefined)
  vi.stubGlobal(
    'Notification',
    withNotification
      ? {
          get permission() {
            return browser.permission
          },
          requestPermission: browser.requestPermission,
        }
      : undefined,
  )
}

type Route = (url: string, init: RequestInit | undefined) => Response | Promise<Response> | undefined
let routes: Route[]
const calls = () => vi.mocked(session.apiFetch).mock.calls.map(([url, init]) => ({ url: String(url), init }))
const callsTo = (method: string, path: string) =>
  calls().filter((c) => (c.init?.method ?? 'GET') === method && c.url === `${NOTIFY}${path}`)

const DEVICE = { id: 'dev-1', label: 'Safari . macOS', createdAt: '2026-11-11T10:00:00.000Z' }

function route(method: string, path: string, response: () => Response | Promise<Response>) {
  routes.unshift((url, init) =>
    (init?.method ?? 'GET') === method && url === `${NOTIFY}${path}` ? response() : undefined,
  )
}

beforeEach(() => {
  idb = createFakeIndexedDb()
  vi.stubGlobal('indexedDB', idb.indexedDB)
  installBrowser()
  routes = []
  vi.mocked(session.apiFetch).mockReset()
  vi.mocked(session.apiFetch).mockImplementation(async (input, init) => {
    for (const r of routes) {
      const response = r(String(input), init)
      if (response) return response
    }
    throw new Error(`unrouted ${init?.method ?? 'GET'} ${String(input)}`)
  })
  vi.mocked(session.navigateSuite).mockReset()
  vi.mocked(session.onBeforeSignOut).mockClear()
  vi.mocked(session.getCachedSession).mockReset()
  vi.mocked(session.getSession).mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// isPushSupported (AC-1.6)
// ---------------------------------------------------------------------------

describe('isPushSupported', () => {
  const cases: Array<[string, BrowserOptions, boolean]> = [
    ['Chrome desktop', { userAgent: CHROME_UA, userAgentData: { mobile: false } }, true],
    ['Edge desktop', { userAgent: CHROME_UA + ' Edg/130.0', userAgentData: { mobile: false } }, true],
    [
      'Firefox desktop (no userAgentData)',
      { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Firefox/130.0' },
      true,
    ],
    ['Safari on macOS (no userAgentData)', { userAgent: SAFARI_UA }, true],
    ['Chrome on Android (userAgentData.mobile)', { userAgent: CHROME_UA, userAgentData: { mobile: true } }, false],
    [
      'Firefox on Android (UA says Android)',
      { userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Firefox/130.0' },
      false,
    ],
    [
      'iPhone Safari, even with a PushManager (home-screen app)',
      { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148' },
      false,
    ],
    ['iPad UA', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Mobile/15E148' }, false],
    ['no PushManager (iPhone Safari outside a home-screen app)', { withPushManager: false }, false],
    ['no serviceWorker', { withServiceWorker: false }, false],
    ['no Notification', { withNotification: false }, false],
  ]
  it.each(cases)('%s', (_name, options, expected) => {
    installBrowser(options)
    expect(push.isPushSupported()).toBe(expected)
  })
})

describe('readPermission', () => {
  it('returns the browser permission, or null when push is not supported', () => {
    installBrowser({ permission: 'denied' })
    expect(push.readPermission()).toBe('denied')
    installBrowser({ withPushManager: false })
    expect(push.readPermission()).toBeNull()
  })
})

describe('subscribePermission', () => {
  it('re-reads the permission on window focus and stops after unsubscribe', () => {
    installBrowser({ permission: 'denied' })
    const listener = vi.fn()
    const stop = push.subscribePermission(listener)
    browser.permission = 'granted'
    window.dispatchEvent(new Event('focus'))
    expect(listener).toHaveBeenCalledWith('granted')
    stop()
    window.dispatchEvent(new Event('focus'))
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// getPushConfig (AC-6.1, AC-1.8) / listPushDevices
// ---------------------------------------------------------------------------

describe('getPushConfig', () => {
  it('returns disabled', async () => {
    route('GET', '/push/config', () => json(200, { enabled: false }))
    await expect(push.getPushConfig()).resolves.toEqual({ enabled: false })
  })

  it('returns the VAPID public key when enabled', async () => {
    route('GET', '/push/config', () => json(200, { enabled: true, vapidPublicKey: VAPID_KEY }))
    await expect(push.getPushConfig()).resolves.toEqual({ enabled: true, vapidPublicKey: VAPID_KEY })
  })

  it.each([
    ['a 500', () => json(500, { code: 'x' })],
    ['a 401', () => json(401, {})],
    ['an enabled answer without a key', () => json(200, { enabled: true })],
    ['a body that is not the contract', () => json(200, { hello: 1 })],
  ])('throws on %s (the section shows the load-failed banner)', async (_name, response) => {
    route('GET', '/push/config', response)
    await expect(push.getPushConfig()).rejects.toBeInstanceOf(push.PushError)
  })

  it('throws when the network fails', async () => {
    route('GET', '/push/config', () => Promise.reject(new TypeError('offline')))
    await expect(push.getPushConfig()).rejects.toBeInstanceOf(push.PushError)
  })
})

describe('listPushDevices', () => {
  it('returns the items', async () => {
    route('GET', '/push/devices', () => json(200, { items: [DEVICE] }))
    await expect(push.listPushDevices()).resolves.toEqual([DEVICE])
  })

  it('throws on a non-ok answer or a malformed body', async () => {
    route('GET', '/push/devices', () => json(503, {}))
    await expect(push.listPushDevices()).rejects.toBeInstanceOf(push.PushError)
    routes = []
    route('GET', '/push/devices', () => json(200, { items: 'nope' }))
    await expect(push.listPushDevices()).rejects.toBeInstanceOf(push.PushError)
  })
})

// ---------------------------------------------------------------------------
// enablePush (AC-1.1 - 1.4)
// ---------------------------------------------------------------------------

describe('enablePush', () => {
  const enable = () => push.enablePush({ userId: USER, vapidPublicKey: VAPID_KEY })

  it('asks for permission synchronously (inside the click), registers the worker, subscribes, PUTs and stores {deviceId,userId}', async () => {
    route('PUT', '/push/devices', () => json(201, DEVICE))

    const pending = enable()
    // still inside the user gesture: nothing has been awaited before the prompt
    expect(browser.requestPermission).toHaveBeenCalledOnce()
    const device = await pending

    expect(browser.register).toHaveBeenCalledWith('/push-sw.js', { scope: '/' })
    expect(browser.subscribe).toHaveBeenCalledOnce()
    const subscribeOptions = browser.subscribe.mock.calls[0]![0] as {
      userVisibleOnly: boolean
      applicationServerKey: Uint8Array
    }
    expect(subscribeOptions.userVisibleOnly).toBe(true)
    expect([...subscribeOptions.applicationServerKey]).toEqual([1, 2, 3])
    const put = callsTo('PUT', '/push/devices')
    expect(put).toHaveLength(1)
    expect(JSON.parse(put[0]!.init!.body as string)).toEqual({
      endpoint: 'https://web.push.apple.com/new',
      keys: { p256dh: 'P256', auth: 'AUTH' },
    })
    expect(device).toEqual(DEVICE)
    expect(idb.peek()).toEqual({ deviceId: 'dev-1', userId: USER })
  })

  it('a worker that never activates: rejects subscribe_failed after the timeout, with no subscription, no PUT and nothing stored (D-2)', async () => {
    vi.useFakeTimers()
    try {
      installBrowser({ permission: 'granted' })
      ;(navigator.serviceWorker as unknown as { ready: Promise<unknown> }).ready = new Promise(() => {})
      const pending = enable()
      const outcome = pending.then(
        () => 'resolved',
        (error: unknown) => error,
      )
      await vi.advanceTimersByTimeAsync(push.SERVICE_WORKER_READY_TIMEOUT_MS - 1)
      let settled = false
      void outcome.then(() => (settled = true))
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const error = await outcome
      expect(error).toBeInstanceOf(push.PushError)
      expect((error as InstanceType<typeof push.PushError>).code).toBe('subscribe_failed')
      expect(browser.subscribe).not.toHaveBeenCalled()
      expect(callsTo('PUT', '/push/devices')).toHaveLength(0)
      expect(idb.size()).toBe(0)

      // the retry is a fresh attempt: once the worker is active it succeeds
      ;(navigator.serviceWorker as unknown as { ready: Promise<unknown> }).ready = Promise.resolve(browser.registration)
      route('PUT', '/push/devices', () => json(201, DEVICE))
      await expect(enable()).resolves.toEqual(DEVICE)
    } finally {
      vi.useRealTimers()
    }
  })

  it('AC-1.7: after an explicit sign-out and signing in again it is off, and Turn on with permission still granted subscribes without changing permission', async () => {
    installBrowser({ permission: 'granted', subscription: makeSubscription('https://web.push.apple.com/live') })
    idb.seed({ deviceId: 'dev-1', userId: USER })
    route('DELETE', '/push/devices/dev-1', () => json(204))

    await push.releasePushOnSignOut()
    expect(browser.subscription).toBeNull()
    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'off' })
    expect(browser.permission).toBe('granted')

    route('PUT', '/push/devices', () => json(201, DEVICE))
    await expect(enable()).resolves.toEqual(DEVICE)
    expect(browser.permission).toBe('granted')
    expect(browser.subscribe).toHaveBeenCalledOnce()
    expect(idb.peek()).toEqual({ deviceId: 'dev-1', userId: USER })
  })

  it('accepts 200 (the endpoint already existed) as well as 201', async () => {
    route('PUT', '/push/devices', () => json(200, DEVICE))
    await expect(enable()).resolves.toEqual(DEVICE)
  })

  it('decodes a base64url key with - and _ and padding-free length', async () => {
    route('PUT', '/push/devices', () => json(201, DEVICE))
    await push.enablePush({ userId: USER, vapidPublicKey: 'AB-_' })
    const key = (browser.subscribe.mock.calls[0]![0] as { applicationServerKey: Uint8Array }).applicationServerKey
    expect([...key]).toEqual([0, 31, 191])
  })

  it('stores only {deviceId,userId} - never a token or the keys (ADR-0001)', async () => {
    route('PUT', '/push/devices', () => json(201, DEVICE))
    await enable()
    expect(Object.keys(idb.peek()!).sort()).toEqual(['deviceId', 'userId'])
  })

  it('denied: a "blocked" error, no worker, no subscription, nothing sent', async () => {
    installBrowser({ promptResult: 'denied' })
    await expect(enable()).rejects.toMatchObject({ code: 'blocked' })
    expect(browser.register).not.toHaveBeenCalled()
    expect(browser.subscribe).not.toHaveBeenCalled()
    expect(calls()).toHaveLength(0)
    expect(idb.size()).toBe(0)
  })

  it('dismissed (default): a "not_allowed" error, nothing sent', async () => {
    installBrowser({ promptResult: 'default' })
    await expect(enable()).rejects.toMatchObject({ code: 'not_allowed' })
    expect(browser.subscribe).not.toHaveBeenCalled()
    expect(calls()).toHaveLength(0)
  })

  it('a throwing subscribe() is its own error and sends nothing (Chromium forks)', async () => {
    browser.subscribeError = new DOMException('push service error', 'AbortError')
    await expect(enable()).rejects.toMatchObject({ code: 'subscribe_failed' })
    expect(calls()).toHaveLength(0)
    expect(idb.size()).toBe(0)
  })

  it('unsupported browser: an "unsupported" error and no prompt', async () => {
    installBrowser({ withPushManager: false })
    await expect(enable()).rejects.toMatchObject({ code: 'unsupported' })
    expect(browser.requestPermission).not.toHaveBeenCalled()
  })

  it('a leftover browser subscription is replaced, not reused (its key may differ)', async () => {
    const leftover = makeSubscription('https://web.push.apple.com/old')
    installBrowser({ permission: 'granted', subscription: leftover })
    route('PUT', '/push/devices', () => json(201, DEVICE))
    await enable()
    expect(leftover.unsubscribe).toHaveBeenCalledOnce()
    expect(browser.subscribe).toHaveBeenCalledOnce()
  })

  it.each([
    ['409 device_limit', json(409, { code: 'device_limit' }), 'device_limit'],
    ['422 endpoint_not_allowed', json(422, { code: 'endpoint_not_allowed' }), 'endpoint_not_allowed'],
    ['503 push_disabled', json(503, { code: 'push_disabled' }), 'push_disabled'],
    ['400 invalid_body', json(400, { code: 'invalid_body' }), 'generic'],
    ['500 without a code', json(500, {}), 'generic'],
    ['a non-JSON 502', new Response('bad gateway', { status: 502 }), 'generic'],
  ])(
    'PUT answers %s: mapped error, the browser subscription is released, nothing stored',
    async (_n, response, code) => {
      route('PUT', '/push/devices', () => response.clone())
      await expect(enable()).rejects.toMatchObject({ code })
      expect(browser.subscription).toBeNull()
      expect(idb.size()).toBe(0)
    },
  )

  it('a network failure on PUT releases the subscription too', async () => {
    route('PUT', '/push/devices', () => Promise.reject(new TypeError('offline')))
    await expect(enable()).rejects.toMatchObject({ code: 'generic' })
    expect(browser.subscription).toBeNull()
  })

  it('a malformed 201 body releases the subscription (a device id is required to remember it)', async () => {
    route('PUT', '/push/devices', () => json(201, { nope: true }))
    await expect(enable()).rejects.toMatchObject({ code: 'generic' })
    expect(browser.subscription).toBeNull()
  })

  it('a subscription without keys is rolled back before anything is sent', async () => {
    browser.subscribe.mockImplementationOnce(async () => {
      const bad = makeSubscription()
      bad.toJSON = () => ({ endpoint: bad.endpoint, keys: {} as never })
      browser.subscription = bad
      return bad
    })
    await expect(enable()).rejects.toMatchObject({ code: 'generic' })
    expect(browser.subscription).toBeNull()
    expect(callsTo('PUT', '/push/devices')).toHaveLength(0)
  })

  it('when the store cannot be written, the device is deleted again and the subscription released', async () => {
    idb.state.failWrite = true
    route('PUT', '/push/devices', () => json(201, DEVICE))
    route('DELETE', '/push/devices/dev-1', () => json(204))
    await expect(enable()).rejects.toMatchObject({ code: 'generic' })
    expect(callsTo('DELETE', '/push/devices/dev-1')).toHaveLength(1)
    expect(browser.subscription).toBeNull()
  })

  it('a worker registration failure is a generic error', async () => {
    browser.register.mockRejectedValueOnce(new Error('SecurityError'))
    await expect(enable()).rejects.toMatchObject({ code: 'generic' })
    expect(calls()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// disablePush / removePushDevice (AC-1.5, AC-3.2)
// ---------------------------------------------------------------------------

describe('disablePush', () => {
  beforeEach(() => {
    browser.subscription = makeSubscription()
    browser.permission = 'granted'
    idb.seed({ deviceId: 'dev-1', userId: USER })
  })

  it('DELETEs the device, unsubscribes and clears the store', async () => {
    route('DELETE', '/push/devices/dev-1', () => json(204))
    const subscription = browser.subscription!
    await push.disablePush()
    expect(callsTo('DELETE', '/push/devices/dev-1')).toHaveLength(1)
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
    expect(idb.size()).toBe(0)
  })

  it('treats a 404 as success (already gone)', async () => {
    route('DELETE', '/push/devices/dev-1', () => json(404, { code: 'not_found' }))
    await expect(push.disablePush()).resolves.toBeUndefined()
    expect(browser.subscription).toBeNull()
    expect(idb.size()).toBe(0)
  })

  it('a failing DELETE leaves it ON: still subscribed, store kept, error thrown (the button is the retry)', async () => {
    route('DELETE', '/push/devices/dev-1', () => json(500, {}))
    await expect(push.disablePush()).rejects.toMatchObject({ code: 'generic' })
    expect(browser.subscription).not.toBeNull()
    expect(idb.peek()).toEqual({ deviceId: 'dev-1', userId: USER })
  })

  it('a network failure also leaves it on', async () => {
    route('DELETE', '/push/devices/dev-1', () => Promise.reject(new TypeError('offline')))
    await expect(push.disablePush()).rejects.toMatchObject({ code: 'generic' })
    expect(browser.subscription).not.toBeNull()
  })

  it('with no stored device it still releases the browser subscription', async () => {
    idb = createFakeIndexedDb()
    vi.stubGlobal('indexedDB', idb.indexedDB)
    await push.disablePush()
    expect(browser.subscription).toBeNull()
    expect(callsTo('DELETE', '/push/devices/dev-1')).toHaveLength(0)
  })
})

describe('removePushDevice', () => {
  beforeEach(() => {
    browser.subscription = makeSubscription()
    browser.permission = 'granted'
    idb.seed({ deviceId: 'dev-1', userId: USER })
  })

  it("another device: only the DELETE; this browser's subscription and store are untouched", async () => {
    route('DELETE', '/push/devices/dev-2', () => json(204))
    const result = await push.removePushDevice('dev-2')
    expect(result).toEqual({ wasThisBrowser: false })
    expect(browser.subscription).not.toBeNull()
    expect(idb.peek()).toEqual({ deviceId: 'dev-1', userId: USER })
  })

  it("this browser's own row: DELETE, unsubscribe and clear the store", async () => {
    route('DELETE', '/push/devices/dev-1', () => json(204))
    const result = await push.removePushDevice('dev-1')
    expect(result).toEqual({ wasThisBrowser: true })
    expect(browser.subscription).toBeNull()
    expect(idb.size()).toBe(0)
  })

  it('a 404 is success', async () => {
    route('DELETE', '/push/devices/dev-2', () => json(404, {}))
    await expect(push.removePushDevice('dev-2')).resolves.toEqual({ wasThisBrowser: false })
  })

  it('a failure throws and changes nothing locally', async () => {
    route('DELETE', '/push/devices/dev-1', () => json(500, {}))
    await expect(push.removePushDevice('dev-1')).rejects.toMatchObject({ code: 'generic' })
    expect(browser.subscription).not.toBeNull()
    expect(idb.size()).toBe(1)
  })

  it('url-encodes the id', async () => {
    route('DELETE', '/push/devices/a%2Fb', () => json(204))
    await push.removePushDevice('a/b')
    expect(callsTo('DELETE', '/push/devices/a%2Fb')).toHaveLength(1)
  })
})

describe('getThisBrowserDeviceId', () => {
  it('is the stored id only while a browser subscription exists for the same user', async () => {
    idb.seed({ deviceId: 'dev-1', userId: USER })
    browser.subscription = makeSubscription()
    await expect(push.getThisBrowserDeviceId(USER)).resolves.toBe('dev-1')
    await expect(push.getThisBrowserDeviceId(OTHER_USER)).resolves.toBeNull()
    browser.subscription = null
    await expect(push.getThisBrowserDeviceId(USER)).resolves.toBeNull()
  })

  it('is null when the store is unreadable', async () => {
    idb.state.failOpen = true
    browser.subscription = makeSubscription()
    await expect(push.getThisBrowserDeviceId(USER)).resolves.toBeNull()
  })

  it('ignores a stored value of the wrong shape', async () => {
    idb.seed({ deviceId: 5, token: 'x' })
    browser.subscription = makeSubscription()
    await expect(push.getThisBrowserDeviceId(USER)).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// reconcilePush (AC-1.7, AC-5.3, design G4)
// ---------------------------------------------------------------------------

describe('reconcilePush', () => {
  const withSubscription = (permission: NotificationPermission = 'granted') => {
    installBrowser({ permission, subscription: makeSubscription('https://web.push.apple.com/live') })
  }

  it('on: subscription + same user + id in the server list -> on, no PUT, no prompt', async () => {
    withSubscription()
    idb.seed({ deviceId: 'dev-1', userId: USER })
    route('GET', '/push/devices', () => json(200, { items: [DEVICE] }))

    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'on', deviceId: 'dev-1' })
    expect(callsTo('PUT', '/push/devices')).toHaveLength(0)
    expect(browser.requestPermission).not.toHaveBeenCalled()
    expect(browser.subscription).not.toBeNull()
  })

  it('server row missing: silently re-PUTs the existing subscription (no prompt), stores the new id', async () => {
    withSubscription()
    idb.seed({ deviceId: 'pruned', userId: USER })
    route('GET', '/push/devices', () => json(200, { items: [] }))
    route('PUT', '/push/devices', () => json(201, { ...DEVICE, id: 'dev-9' }))

    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'on', deviceId: 'dev-9' })
    const put = callsTo('PUT', '/push/devices')
    expect(put).toHaveLength(1)
    expect(JSON.parse(put[0]!.init!.body as string).endpoint).toBe('https://web.push.apple.com/live')
    expect(browser.requestPermission).not.toHaveBeenCalled()
    expect(browser.subscribe).not.toHaveBeenCalled()
    expect(idb.peek()).toEqual({ deviceId: 'dev-9', userId: USER })
  })

  it('server row missing and the re-PUT is refused (e.g. 503 push_disabled): subscription released, store cleared -> off', async () => {
    withSubscription()
    idb.seed({ deviceId: 'pruned', userId: USER })
    route('GET', '/push/devices', () => json(200, { items: [] }))
    route('PUT', '/push/devices', () => json(503, { code: 'push_disabled' }))

    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'off' })
    expect(browser.subscription).toBeNull()
    expect(idb.size()).toBe(0)
  })

  it('server row missing and the re-PUT fails transiently (5xx/network): keeps the subscription, "unverified", retried next boot', async () => {
    withSubscription()
    idb.seed({ deviceId: 'pruned', userId: USER })
    route('GET', '/push/devices', () => json(200, { items: [] }))
    route('PUT', '/push/devices', () => json(502, {}))

    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'unverified' })
    expect(browser.subscription).not.toBeNull()
    expect(idb.peek()).toEqual({ deviceId: 'pruned', userId: USER })
  })

  it('stored user is not the current user: unsubscribes and clears, sends nothing (AC-5.3)', async () => {
    withSubscription()
    idb.seed({ deviceId: 'dev-1', userId: OTHER_USER })

    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'off' })
    expect(browser.subscription).toBeNull()
    expect(idb.size()).toBe(0)
    expect(calls()).toHaveLength(0)
  })

  it("a subscription with no stored owner is released (cannot be proven to be this user's)", async () => {
    withSubscription()
    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'off' })
    expect(browser.subscription).toBeNull()
    expect(calls()).toHaveLength(0)
  })

  it('permission revoked (denied): DELETE (404 = success), unsubscribe, clear -> off (design G4)', async () => {
    withSubscription('denied')
    idb.seed({ deviceId: 'dev-1', userId: USER })
    route('DELETE', '/push/devices/dev-1', () => json(404, {}))

    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'off' })
    expect(callsTo('DELETE', '/push/devices/dev-1')).toHaveLength(1)
    expect(browser.subscription).toBeNull()
    expect(idb.size()).toBe(0)
  })

  it('permission revoked and the DELETE fails: still unsubscribes and clears (the endpoint dies, the row is pruned later)', async () => {
    withSubscription('denied')
    idb.seed({ deviceId: 'dev-1', userId: USER })
    route('DELETE', '/push/devices/dev-1', () => Promise.reject(new TypeError('offline')))

    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'off' })
    expect(browser.subscription).toBeNull()
    expect(idb.size()).toBe(0)
  })

  it('permission reset to "default" counts as revoked', async () => {
    withSubscription('default')
    idb.seed({ deviceId: 'dev-1', userId: USER })
    route('DELETE', '/push/devices/dev-1', () => json(204))
    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'off' })
    expect(browser.subscription).toBeNull()
  })

  it('browser subscription gone (Safari cancelled it) while the server row exists: off, the dead row is deleted best-effort, store cleared (T1 spike)', async () => {
    installBrowser({ permission: 'granted', subscription: null })
    idb.seed({ deviceId: 'dev-1', userId: USER })
    route('DELETE', '/push/devices/dev-1', () => json(204))

    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'off' })
    expect(callsTo('DELETE', '/push/devices/dev-1')).toHaveLength(1)
    expect(idb.size()).toBe(0)
  })

  it('nothing stored and no subscription: off, no request at all', async () => {
    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'off' })
    expect(calls()).toHaveLength(0)
  })

  it('cannot reach the server list: "unverified", nothing is changed or released', async () => {
    withSubscription()
    idb.seed({ deviceId: 'dev-1', userId: USER })
    route('GET', '/push/devices', () => Promise.reject(new TypeError('offline')))

    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'unverified' })
    expect(browser.subscription).not.toBeNull()
    expect(idb.peek()).toEqual({ deviceId: 'dev-1', userId: USER })
  })

  it('unsupported browser: off, never touches the worker or the network', async () => {
    installBrowser({ withPushManager: false })
    idb.seed({ deviceId: 'dev-1', userId: USER })
    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'off' })
    expect(calls()).toHaveLength(0)
  })

  it('an unreadable store with a live subscription: released (identity cannot be proven)', async () => {
    withSubscription()
    idb.state.failOpen = true
    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'off' })
    expect(browser.subscription).toBeNull()
  })

  it('a throwing getSubscription() is "unverified", never an exception', async () => {
    withSubscription()
    idb.seed({ deviceId: 'dev-1', userId: USER })
    browser.getSubscription.mockRejectedValueOnce(new Error('boom'))
    await expect(push.reconcilePush(USER)).resolves.toEqual({ status: 'unverified' })
  })
})

// ---------------------------------------------------------------------------
// releasePushOnSignOut (AC-5.1)
// ---------------------------------------------------------------------------

describe('releasePushOnSignOut', () => {
  it('DELETEs the device, unsubscribes and clears the store', async () => {
    browser.subscription = makeSubscription()
    const subscription = browser.subscription
    idb.seed({ deviceId: 'dev-1', userId: USER })
    route('DELETE', '/push/devices/dev-1', () => json(204))

    await push.releasePushOnSignOut()

    expect(callsTo('DELETE', '/push/devices/dev-1')).toHaveLength(1)
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
    expect(idb.size()).toBe(0)
  })

  it('a failing DELETE still unsubscribes and clears (the row is pruned on the next send)', async () => {
    browser.subscription = makeSubscription()
    const subscription = browser.subscription
    idb.seed({ deviceId: 'dev-1', userId: USER })
    route('DELETE', '/push/devices/dev-1', () => json(500, {}))

    await expect(push.releasePushOnSignOut()).resolves.toBeUndefined()
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
    expect(idb.size()).toBe(0)
  })

  it('a hanging DELETE does not delay the unsubscribe (sign-out gives up after 2 s)', async () => {
    browser.subscription = makeSubscription()
    const subscription = browser.subscription
    idb.seed({ deviceId: 'dev-1', userId: USER })
    route('DELETE', '/push/devices/dev-1', () => new Promise<Response>(() => {}))

    void push.releasePushOnSignOut()
    await vi.waitFor(() => expect(subscription.unsubscribe).toHaveBeenCalledOnce())
  })

  it('nothing stored and no subscription: no request', async () => {
    await push.releasePushOnSignOut()
    expect(calls()).toHaveLength(0)
  })

  it('a subscription with no stored device is still released', async () => {
    browser.subscription = makeSubscription()
    const subscription = browser.subscription
    await push.releasePushOnSignOut()
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
    expect(calls()).toHaveLength(0)
  })

  it('unsupported browser: does nothing', async () => {
    installBrowser({ withServiceWorker: false })
    idb.seed({ deviceId: 'dev-1', userId: USER })
    await push.releasePushOnSignOut()
    expect(calls()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// initPush (boot)
// ---------------------------------------------------------------------------

describe('initPush', () => {
  it('registers the before-sign-out release and reconciles for the signed-in user', async () => {
    vi.mocked(session.getCachedSession).mockReturnValue({ data: { user: { id: USER } } } as never)
    installBrowser({ permission: 'granted', subscription: makeSubscription() })
    idb.seed({ deviceId: 'dev-1', userId: OTHER_USER })

    await push.initPush()

    expect(session.onBeforeSignOut).toHaveBeenCalledWith(push.releasePushOnSignOut)
    expect(browser.subscription).toBeNull() // the other user's subscription was released
  })

  it('falls back to resolving the session when none is cached yet', async () => {
    vi.mocked(session.getCachedSession).mockReturnValue(null)
    vi.mocked(session.getSession).mockResolvedValue({ data: { user: { id: USER } } } as never)
    installBrowser({ permission: 'granted', subscription: makeSubscription() })
    idb.seed({ deviceId: 'dev-1', userId: OTHER_USER })

    await push.initPush()

    expect(browser.subscription).toBeNull()
  })

  it('no signed-in user: still registers the release, never reconciles', async () => {
    vi.mocked(session.getCachedSession).mockReturnValue({ data: null } as never)
    installBrowser({ permission: 'granted', subscription: makeSubscription() })

    await push.initPush()

    expect(session.onBeforeSignOut).toHaveBeenCalled()
    expect(browser.subscription).not.toBeNull()
    expect(calls()).toHaveLength(0)
  })

  it('never rejects when the sign-out registration itself throws', async () => {
    vi.mocked(session.onBeforeSignOut).mockImplementationOnce(() => {
      throw new Error('seam missing')
    })
    await expect(push.initPush()).resolves.toBeUndefined()
  })

  it('never rejects, whatever the session lookup does', async () => {
    vi.mocked(session.getCachedSession).mockReturnValue(null)
    vi.mocked(session.getSession).mockRejectedValue(new Error('auth down'))
    await expect(push.initPush()).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// handleServiceWorkerMessage (T7 contract)
// ---------------------------------------------------------------------------

// S-M1 (specs/029): paths that normalise to a scheme-relative URL or move the origin. Same table as
// shell/src/sw/pushHandlers.test.ts; here each is appended to this page's origin.
const OPEN_REDIRECT_VECTORS = [
  '/..//evil.io',
  '/.//evil.io',
  '/a/..//evil.io',
  '/%2e%2e//evil.io',
  '/\t/evil.io',
  '/\n/evil.io',
  '/\r/evil.io',
]

describe('handleServiceWorkerMessage', () => {
  const origin = window.location.origin

  it('navigates the suite to path + search + hash of a same-origin URL', () => {
    push.handleServiceWorkerMessage({ navigate: `${origin}/crm/deals/7?tab=notes#top` })
    expect(session.navigateSuite).toHaveBeenCalledWith('/crm/deals/7?tab=notes#top')
  })

  it.each<[string, unknown]>([
    ['another origin', { navigate: 'https://evil.example.com/crm' }],
    ['a look-alike origin', { navigate: `${origin}.evil.example.com/x` }],
    ['a userinfo trick', { navigate: `${origin}@evil.example.com/x` }],
    ['a javascript: URL', { navigate: 'javascript:alert(1)' }],
    ['a data: URL', { navigate: 'data:text/html,<script>1</script>' }],
    ['a relative path', { navigate: '/notify' }],
    ['a non-string', { navigate: 42 }],
    ['no navigate member', { other: `${origin}/x` }],
    ['null', null],
    ['undefined', undefined],
    ['a string', `${origin}/x`],
    ['an array', [`${origin}/x`]],
    ...OPEN_REDIRECT_VECTORS.map((v): [string, unknown] => [
      `open-redirect vector ${JSON.stringify(v)}`,
      { navigate: `${origin}${v}` },
    ]),
  ])('ignores %s', (_name, data) => {
    expect(() => push.handleServiceWorkerMessage(data)).not.toThrow()
    expect(session.navigateSuite).not.toHaveBeenCalled()
  })
})

describe('listenForServiceWorkerMessages', () => {
  it("passes the worker's messages to the handler until stopped", () => {
    installBrowser()
    const container = (navigator as unknown as { serviceWorker: { addEventListener: ReturnType<typeof vi.fn> } })
      .serviceWorker
    ;(container as unknown as { removeEventListener: ReturnType<typeof vi.fn> }).removeEventListener = vi.fn()

    const stop = push.listenForServiceWorkerMessages()

    expect(container.addEventListener).toHaveBeenCalledWith('message', expect.any(Function))
    const listener = container.addEventListener.mock.calls[0]![1] as (event: MessageEvent) => void
    listener(new MessageEvent('message', { data: { navigate: `${window.location.origin}/notify` } }))
    expect(session.navigateSuite).toHaveBeenCalledWith('/notify')

    stop()
    const remove = (container as unknown as { removeEventListener: ReturnType<typeof vi.fn> }).removeEventListener
    expect(remove).toHaveBeenCalledWith('message', listener)
  })

  it('is a no-op without a service worker API', () => {
    installBrowser({ withServiceWorker: false })
    expect(() => push.listenForServiceWorkerMessages()()).not.toThrow()
  })
})
