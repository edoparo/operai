/**
 * The push service worker's behaviour (specs/029, ADR-0085), written against a minimal view of the
 * worker scope so a test can drive it with a fake. `push-sw.ts` binds it to the real `self`.
 *
 * The server builds the content (design.md F8); this code only decides show-or-suppress and where a
 * click goes. Nothing here may throw out of an event: a rejected `waitUntil` promise makes the
 * browser count the push as unhandled, and Safari cancels a subscription that shows nothing.
 */

/** Payload version this worker understands (notify-api `push` channel). Anything else is ignored. */
const PAYLOAD_VERSION = 1
const ICON = '/push-icon.png'
const FALLBACK_HREF = '/notify'
/** Safari's push service. Safari cancels the subscription after pushes that show nothing (T1 spike). */
const SAFARI_PUSH_HOST = 'web.push.apple.com'

export interface ClientLike {
  readonly visibilityState: 'visible' | 'hidden' | 'prerender'
  focus(): Promise<unknown>
  postMessage(message: unknown): void
}

export interface PushEventLike {
  readonly data: { json(): unknown } | null
  waitUntil(promise: Promise<unknown>): void
}

export interface NotificationClickEventLike {
  readonly notification: { close(): void; readonly data: unknown }
  waitUntil(promise: Promise<unknown>): void
}

export interface PushScope {
  readonly location: { readonly origin: string }
  readonly registration: {
    showNotification(title: string, options: NotificationOptions): Promise<void>
    readonly pushManager: { getSubscription(): Promise<{ readonly endpoint: string } | null> }
  }
  readonly clients: {
    matchAll(options: { type: 'window'; includeUncontrolled: true }): Promise<readonly ClientLike[]>
    openWindow(url: string): Promise<unknown>
    claim(): Promise<void>
  }
  skipWaiting(): Promise<void>
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendEventLike) => void): void
  addEventListener(type: 'push', listener: (event: PushEventLike) => void): void
  addEventListener(type: 'notificationclick', listener: (event: NotificationClickEventLike) => void): void
}

interface ExtendEventLike {
  waitUntil(promise: Promise<unknown>): void
}

interface PushMessage {
  id: string
  title: string
  body: string
  href: string
}

/**
 * Only a same-origin relative path is followed; anything else becomes `/notify` (AC-4.1/4.2). The
 * URL parser is the judge, not a prefix check: it strips tabs and newlines, so `/\t/evil.io` is a
 * protocol-relative URL once parsed.
 */
export function safeHref(value: unknown, origin: string): string {
  if (typeof value !== 'string') return FALLBACK_HREF
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return FALLBACK_HREF
  try {
    const url = new URL(value, origin)
    if (url.origin !== origin) return FALLBACK_HREF
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return FALLBACK_HREF
  }
}

function parsePayload(raw: unknown, origin: string): PushMessage | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const p = raw as Record<string, unknown>
  if (p['v'] !== PAYLOAD_VERSION) return null
  const { id, title, body } = p
  if (typeof id !== 'string' || id === '') return null
  if (typeof title !== 'string' || title === '') return null
  if (typeof body !== 'string') return null
  return { id, title, body, href: safeHref(p['href'], origin) }
}

async function isSafari(scope: PushScope): Promise<boolean> {
  try {
    const subscription = await scope.registration.pushManager.getSubscription()
    if (!subscription) return false
    return new URL(subscription.endpoint).hostname === SAFARI_PUSH_HOST
  } catch {
    // Unknown: showing costs one duplicate on a browser that did not need it; suppressing could
    // cost a Safari subscription. Fail toward showing.
    return true
  }
}

async function hasVisibleWindow(scope: PushScope): Promise<boolean> {
  try {
    const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true })
    return windows.some((w) => w.visibilityState === 'visible')
  } catch {
    return false
  }
}

async function onPush(scope: PushScope, event: PushEventLike): Promise<void> {
  let message: PushMessage | null
  try {
    message = event.data ? parsePayload(event.data.json(), scope.location.origin) : null
  } catch {
    message = null
  }
  if (!message) return

  // Safari first: it must show every push (ADR-0085 amended), so the window lookup is moot there.
  if (!(await isSafari(scope)) && (await hasVisibleWindow(scope))) return

  try {
    await scope.registration.showNotification(message.title, {
      body: message.body,
      tag: message.id,
      lang: 'en',
      icon: ICON,
      data: { href: message.href },
    })
  } catch {
    // Nothing useful to do; the in-app notification stands.
  }
}

async function onClick(scope: PushScope, event: NotificationClickEventLike): Promise<void> {
  event.notification.close()
  const data = event.notification.data
  const stored = typeof data === 'object' && data !== null ? (data as Record<string, unknown>)['href'] : undefined
  const target = new URL(safeHref(stored, scope.location.origin), scope.location.origin).href

  try {
    const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find((w) => w.visibilityState === 'visible') ?? windows[0]
    if (existing) {
      try {
        await existing.focus()
        // Contract with the shell (T8): { navigate: <absolute same-origin URL> }.
        existing.postMessage({ navigate: target })
        return
      } catch {
        // The window went away or refused focus: open a fresh one below.
      }
    }
    await scope.clients.openWindow(target)
  } catch {
    // openWindow can be refused (no user activation); the notification is already closed.
  }
}

export function registerPushHandlers(scope: PushScope): void {
  scope.addEventListener('install', (event) => {
    event.waitUntil(scope.skipWaiting())
  })
  scope.addEventListener('activate', (event) => {
    event.waitUntil(scope.clients.claim())
  })
  scope.addEventListener('push', (event) => {
    event.waitUntil(onPush(scope, event))
  })
  scope.addEventListener('notificationclick', (event) => {
    event.waitUntil(onClick(scope, event))
  })
}
