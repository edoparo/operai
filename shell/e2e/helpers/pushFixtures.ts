/**
 * pushFixtures — Web Push e2e support (specs/029-push-notifications, T10).
 *
 * Headless Chromium cannot obtain a real push subscription (there is no push service to talk to), so
 * `installFakePush` replaces ONLY the browser half: the page's `PushManager` (the one hanging off every
 * `ServiceWorkerRegistration`) and the notification permission. Everything else is real: the shell's
 * `push.ts`, the real `/push-sw.js` registration, IndexedDB, `apiFetch` with the real JWT, and the real
 * notify-api `/push/*` routes, which validate the fake subscription like any other:
 *   - the endpoint must pass `PUSH_ENDPOINT_HOSTS` (SSRF allowlist), hence `https://fcm.googleapis.com/...`;
 *   - `p256dh` must be 65 bytes AND a point on P-256 (a real EC key is generated here);
 *   - `auth` must be 16 bytes.
 *
 * The fake subscription survives a reload (a flag in the page's localStorage, which Playwright clears with
 * the context) so "reload -> still on" exercises the real boot reconciliation.
 *
 * Cleanup: `trackPushDevices` records every device id the server returns on `PUT /push/devices` and
 * `deleteTrackedPushDevices` deletes them with the user's JWT (a 404 is fine: the test already removed it).
 */

import { generateKeyPairSync, randomBytes } from 'node:crypto'
import type { BrowserContext, Page } from '@playwright/test'

const AUTH_ORIGIN = (process.env['E2E_AUTH_URL'] ?? process.env['VITE_AUTH_URL'] ?? 'http://localhost:3001').replace(
  /\/$/,
  '',
)

export const NOTIFY_ORIGIN = (
  process.env['E2E_NOTIFY_API_URL'] ??
  process.env['VITE_NOTIFY_API_URL'] ??
  'http://localhost:8081'
).replace(/\/$/, '')

export interface FakePushSubscription {
  /** Unique per call, on an allowlisted host. */
  endpoint: string
  /** 65-byte uncompressed P-256 point, unpadded base64url. */
  p256dh: string
  /** 16 random bytes, unpadded base64url. */
  auth: string
}

const base64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')

/** A subscription the real notify-api accepts: allowlisted endpoint host, a real curve point, 16-byte auth. */
export function makeFakeSubscription(): FakePushSubscription {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x ?? '', 'base64url'),
    Buffer.from(jwk.y ?? '', 'base64url'),
  ])
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${randomBytes(12).toString('hex')}`,
    p256dh: base64Url(point),
    auth: base64Url(randomBytes(16)),
  }
}

/**
 * Installs the fake `PushManager` and a granted `Notification.permission` on every page of `context`
 * (before the page's own scripts run, so it survives reloads). Returns the subscription it will hand out.
 */
export async function installFakePush(context: BrowserContext, origin: string): Promise<FakePushSubscription> {
  const subscription = makeFakeSubscription()
  await context.grantPermissions(['notifications'], { origin })
  await context.addInitScript((fake: FakePushSubscription) => {
    const FLAG = 'e2e-fake-push-subscribed'
    const flag = {
      get: (): boolean => {
        try {
          return window.localStorage.getItem(FLAG) === '1'
        } catch {
          return false
        }
      },
      set: (on: boolean): void => {
        try {
          if (on) window.localStorage.setItem(FLAG, '1')
          else window.localStorage.removeItem(FLAG)
        } catch {
          // opaque origin (about:blank): nothing to remember
        }
      },
    }
    const makeSubscription = () => ({
      endpoint: fake.endpoint,
      expirationTime: null,
      options: { userVisibleOnly: true },
      getKey: () => null,
      toJSON: () => ({ endpoint: fake.endpoint, expirationTime: null, keys: { p256dh: fake.p256dh, auth: fake.auth } }),
      unsubscribe: async () => {
        flag.set(false)
        return true
      },
    })
    const manager = {
      getSubscription: async () => (flag.get() ? makeSubscription() : null),
      subscribe: async () => {
        flag.set(true)
        return makeSubscription()
      },
      permissionState: async () => 'granted',
    }
    // Headless Chromium reports `Notification.permission === 'denied'` even when `navigator.permissions` says
    // `granted` (verified: grantPermissions flips the latter only), so the page would read "Blocked". Fake the
    // permission the way a person who clicked Allow would see it.
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' })
    Object.defineProperty(Notification, 'requestPermission', {
      configurable: true,
      value: async () => 'granted',
    })
    Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', {
      configurable: true,
      get: () => manager,
    })
  }, subscription)
  return subscription
}

/** Records the id of every device `PUT /push/devices` answers with, for `deleteTrackedPushDevices`. */
export function trackPushDevices(page: Page): string[] {
  const ids: string[] = []
  page.on('response', (response) => {
    const request = response.request()
    if (request.method() !== 'PUT' || !response.url().startsWith(`${NOTIFY_ORIGIN}/push/devices`)) return
    if (!response.ok()) return
    void response
      .json()
      .then((body: { id?: unknown }) => {
        if (typeof body.id === 'string' && !ids.includes(body.id)) ids.push(body.id)
      })
      .catch(() => {})
  })
  return ids
}

/** A JWT for the session behind `sessionCookie` (`name=value`), as the shell would fetch it. */
export async function tokenFor(sessionCookie: string): Promise<string> {
  const response = await fetch(`${AUTH_ORIGIN}/auth/token`, { headers: { Cookie: sessionCookie } })
  if (!response.ok) throw new Error(`[push-e2e] GET /auth/token failed (${response.status})`)
  const { token } = (await response.json()) as { token?: string }
  if (!token) throw new Error('[push-e2e] /auth/token returned no token')
  return token
}

/** The caller's push devices, straight from notify-api (what the server believes, not what the UI shows). */
export async function listServerDevices(token: string): Promise<Array<{ id: string; label: string }>> {
  const response = await fetch(`${NOTIFY_ORIGIN}/push/devices`, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok)
    throw new Error(`[push-e2e] GET /push/devices failed (${response.status}): ${await response.text()}`)
  return ((await response.json()) as { items: Array<{ id: string; label: string }> }).items
}

/** `GET /push/config` with the caller's token: the environment gate for the whole spec. */
export async function readPushConfig(token: string): Promise<{ enabled: boolean }> {
  const response = await fetch(`${NOTIFY_ORIGIN}/push/config`, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`[push-e2e] GET /push/config failed (${response.status})`)
  return (await response.json()) as { enabled: boolean }
}

/** Deletes the devices a test created (idempotent: an already-removed device answers 404). */
export async function deleteTrackedPushDevices(token: string, ids: readonly string[]): Promise<void> {
  await Promise.all(
    ids.map((id) =>
      fetch(`${NOTIFY_ORIGIN}/push/devices/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined),
    ),
  )
}
