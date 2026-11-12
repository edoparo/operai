/**
 * The push service worker's behaviour (specs/029 T7; AC-2.3, AC-2.4, AC-4.1, AC-4.2, ADR-0085),
 * driven through a fake service-worker global scope — jsdom has no worker runtime.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  registerPushHandlers,
  type ClientLike,
  type NotificationClickEventLike,
  type PushEventLike,
  type PushScope,
} from './pushHandlers.ts'

const ORIGIN = 'https://operai.example'
const SAFARI = 'https://web.push.apple.com/QAbc123'
const CHROME = 'https://fcm.googleapis.com/fcm/send/abc'

interface Fake {
  scope: PushScope
  show: ReturnType<typeof vi.fn>
  openWindow: ReturnType<typeof vi.fn>
  push: (data: unknown) => Promise<void>
  click: (data: unknown) => Promise<{ close: ReturnType<typeof vi.fn> }>
}

function fake(opts: {
  clients?: ClientLike[]
  endpoint?: string | null
  getSubscription?: () => Promise<{ endpoint: string } | null>
  matchAll?: () => Promise<ClientLike[]>
  openWindow?: () => Promise<unknown>
}): Fake {
  const listeners = new Map<string, (event: never) => void>()
  const show = vi.fn(async () => undefined)
  const openWindow = vi.fn(opts.openWindow ?? (async () => null))
  const endpoint = opts.endpoint === undefined ? CHROME : opts.endpoint
  const scope: PushScope = {
    location: { origin: ORIGIN },
    registration: {
      showNotification: show,
      pushManager: {
        getSubscription: opts.getSubscription ?? (async () => (endpoint ? { endpoint } : null)),
      },
    },
    clients: {
      matchAll: opts.matchAll ?? (async () => opts.clients ?? []),
      openWindow,
      claim: async () => undefined,
    },
    skipWaiting: async () => undefined,
    addEventListener: (type: string, l: (event: never) => void) => {
      listeners.set(type, l)
    },
  } as PushScope
  registerPushHandlers(scope)
  return {
    scope,
    show,
    openWindow,
    async push(data) {
      const waits: Promise<unknown>[] = []
      const event: PushEventLike = {
        data:
          data === undefined
            ? null
            : {
                json: () => {
                  if (typeof data === 'string') return JSON.parse(data) as unknown
                  return data
                },
              },
        waitUntil: (p) => void waits.push(p),
      }
      listeners.get('push')?.(event as never)
      await Promise.all(waits)
    },
    async click(data) {
      const waits: Promise<unknown>[] = []
      const close = vi.fn()
      const event: NotificationClickEventLike = {
        notification: { close, data },
        waitUntil: (p) => void waits.push(p),
      }
      listeners.get('notificationclick')?.(event as never)
      await Promise.all(waits)
      return { close }
    },
  }
}

const win = (visibilityState: 'visible' | 'hidden', extra: Partial<ClientLike> = {}): ClientLike => ({
  visibilityState,
  focus: vi.fn(async () => undefined) as unknown as ClientLike['focus'],
  postMessage: vi.fn(),
  ...extra,
})

const payload = (over: Record<string, unknown> = {}) => ({
  v: 1,
  id: 'n1',
  title: 'Deal won',
  body: 'Acme signed',
  originApp: 'crm',
  href: '/crm/deals/7',
  ...over,
})

// S-M1 (specs/029): values that normalise to a scheme-relative URL or move the origin. The same
// table is in shell/src/lib/push.test.ts (absolute form) and notify-api's schema test.
const OPEN_REDIRECT_VECTORS = [
  '/..//evil.io',
  '/.//evil.io',
  '/a/..//evil.io',
  '/%2e%2e//evil.io',
  '/\t/evil.io',
  '/\n/evil.io',
  '/\r/evil.io',
]

describe('push event', () => {
  it('shows nothing when a window is visible (AC-2.3)', async () => {
    const f = fake({ clients: [win('hidden'), win('visible')] })
    await f.push(payload())
    expect(f.show).not.toHaveBeenCalled()
  })

  it('still shows when the subscription is on web.push.apple.com, even with a visible window (Safari, AC-2.3 amended)', async () => {
    const f = fake({ clients: [win('visible')], endpoint: SAFARI })
    await f.push(payload())
    expect(f.show).toHaveBeenCalledTimes(1)
  })

  it('does not treat a lookalike host as Safari', async () => {
    const f = fake({ clients: [win('visible')], endpoint: 'https://web.push.apple.com.evil.io/x' })
    await f.push(payload())
    expect(f.show).not.toHaveBeenCalled()
  })

  it('shows with tag = id, lang en, the push icon and data.href when no window is visible (AC-2.4)', async () => {
    const f = fake({ clients: [win('hidden')] })
    await f.push(payload())
    expect(f.show).toHaveBeenCalledWith('Deal won', {
      body: 'Acme signed',
      tag: 'n1',
      lang: 'en',
      icon: '/push-icon.png',
      data: { href: '/crm/deals/7' },
    })
  })

  it('shows when there is no window at all', async () => {
    const f = fake({ clients: [] })
    await f.push(payload())
    expect(f.show).toHaveBeenCalledTimes(1)
  })

  it.each<[string, unknown, string]>([
    ['absent', undefined, '/notify'],
    ['absolute other origin', 'https://evil.io/x', '/notify'],
    ['protocol-relative', '//evil.io/x', '/notify'],
    ['backslash trick', '/\\evil.io', '/notify'],
    ...OPEN_REDIRECT_VECTORS.map((v): [string, unknown, string] => [
      `open-redirect vector ${JSON.stringify(v)}`,
      v,
      '/notify',
    ]),
    ['javascript url', 'javascript:alert(1)', '/notify'],
    ['not a string', 42, '/notify'],
    ['relative with query', '/refund/requests?x=1#a', '/refund/requests?x=1#a'],
  ])('href %s -> %s', async (_name, href, expected) => {
    const f = fake({ clients: [] })
    await f.push(payload({ href }))
    expect(f.show).toHaveBeenCalledTimes(1)
    const options = f.show.mock.calls[0]?.[1] as { data: { href: string } }
    expect(options.data.href).toBe(expected)
  })

  it.each([
    ['another version', payload({ v: 2 })],
    ['no version', { id: 'n1', title: 't', body: 'b' }],
    ['no id', payload({ id: undefined })],
    ['empty id', payload({ id: '' })],
    ['no title', payload({ title: undefined })],
    ['non-string body', payload({ body: 5 })],
    ['not an object', 'null'],
    ['an array', '[]'],
    ['malformed json', '{not json'],
  ])('shows nothing and does not throw for %s', async (_name, data) => {
    const f = fake({ clients: [] })
    await expect(f.push(typeof data === 'string' ? data : data)).resolves.toBeUndefined()
    expect(f.show).not.toHaveBeenCalled()
  })

  it('shows nothing for an empty push (no data)', async () => {
    const f = fake({ clients: [] })
    await f.push(undefined)
    expect(f.show).not.toHaveBeenCalled()
  })

  it('shows anyway when the window list cannot be read (never lose a notification)', async () => {
    const f = fake({
      matchAll: async () => {
        throw new Error('boom')
      },
    })
    await f.push(payload())
    expect(f.show).toHaveBeenCalledTimes(1)
  })

  it('shows anyway when the subscription cannot be read, protecting a Safari subscription', async () => {
    const f = fake({
      clients: [win('visible')],
      getSubscription: async () => {
        throw new Error('boom')
      },
    })
    await f.push(payload())
    expect(f.show).toHaveBeenCalledTimes(1)
  })

  it('does not reject the event when showNotification fails', async () => {
    const f = fake({ clients: [] })
    f.show.mockRejectedValueOnce(new Error('denied'))
    await expect(f.push(payload())).resolves.toBeUndefined()
  })
})

describe('notificationclick', () => {
  it('closes the notification, focuses an existing window and posts the absolute target', async () => {
    const existing = win('hidden')
    const f = fake({ clients: [existing] })
    const { close } = await f.click({ href: '/crm/deals/7' })
    expect(close).toHaveBeenCalled()
    expect(existing.focus).toHaveBeenCalled()
    expect(existing.postMessage).toHaveBeenCalledWith({ navigate: `${ORIGIN}/crm/deals/7` })
    expect(f.openWindow).not.toHaveBeenCalled()
  })

  it('goes to /notify when the notification carries no href', async () => {
    const existing = win('visible')
    const f = fake({ clients: [existing] })
    await f.click(undefined)
    expect(existing.postMessage).toHaveBeenCalledWith({ navigate: `${ORIGIN}/notify` })
  })

  it('refuses a foreign href stored in data and goes to /notify', async () => {
    const existing = win('visible')
    const f = fake({ clients: [existing] })
    await f.click({ href: 'https://evil.io/phish' })
    expect(existing.postMessage).toHaveBeenCalledWith({ navigate: `${ORIGIN}/notify` })
  })

  it('opens a window at the target when none exists', async () => {
    const f = fake({ clients: [] })
    await f.click({ href: '/crm/deals/7' })
    expect(f.openWindow).toHaveBeenCalledWith(`${ORIGIN}/crm/deals/7`)
  })

  it('opens /notify in a new window when none exists and no href', async () => {
    const f = fake({ clients: [] })
    await f.click({})
    expect(f.openWindow).toHaveBeenCalledWith(`${ORIGIN}/notify`)
  })

  it('prefers a visible window over a hidden one', async () => {
    const hidden = win('hidden')
    const visible = win('visible')
    const f = fake({ clients: [hidden, visible] })
    await f.click({ href: '/x' })
    expect(visible.postMessage).toHaveBeenCalled()
    expect(hidden.postMessage).not.toHaveBeenCalled()
  })

  it('falls back to opening a window when focusing fails', async () => {
    const broken = win('hidden', {
      focus: vi.fn(async () => {
        throw new Error('no')
      }) as unknown as ClientLike['focus'],
    })
    const f = fake({ clients: [broken] })
    await f.click({ href: '/x' })
    expect(f.openWindow).toHaveBeenCalledWith(`${ORIGIN}/x`)
  })

  it('does not throw when opening a window fails', async () => {
    const f = fake({
      clients: [],
      openWindow: async () => {
        throw new Error('blocked')
      },
    })
    await expect(f.click({})).resolves.toBeDefined()
  })
})
