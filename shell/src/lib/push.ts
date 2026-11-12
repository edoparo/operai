/**
 * shell/push — the browser side of Web Push (specs/029-push-notifications, T8; plan § "Enable /
 * disable / sign-out (shell)", ADR-0084/0085). No UI: `PushSettings` (T9) builds on this module.
 *
 * What lives here:
 *   - support detection (`isPushSupported`, `readPermission`, `subscribePermission`);
 *   - the notify-api `/push/*` calls through `apiFetch` (ADR-0001): `getPushConfig`,
 *     `listPushDevices`, and the writes below;
 *   - turning this browser on and off (`enablePush`, `disablePush`) and removing any device
 *     (`removePushDevice`);
 *   - boot work (`initPush`): the sign-out release is registered, and the browser is reconciled with
 *     the server (`reconcilePush`) — this is how a subscription the browser dropped (Safari cancels
 *     one after pushes that show nothing, while Apple keeps answering 201), a revoked permission or
 *     another user's leftover subscription is detected;
 *   - the service worker's `{navigate}` message (`handleServiceWorkerMessage`).
 *
 * Invariant kept throughout: "no server row" means "no browser subscription". Whenever a browser
 * subscription would outlive its server row on a DEFINITIVE failure it is unsubscribed; only an
 * inconclusive failure (network, 5xx) keeps it and reports `unverified`, to be retried next boot.
 *
 * The only thing persisted is `{deviceId, userId}` in IndexedDB — never the JWT (ADR-0001). Only
 * `enablePush` (and the silent re-register of an already remembered device) creates the database;
 * boot, sign-out and the settings reads never do (D-7). Every
 * storage access is wrapped: an unavailable store degrades to "nothing remembered", which makes
 * `reconcilePush` release the subscription rather than guess whose it is.
 *
 * Import cycle note: this module imports `./session`; `session.ts` does not import it (the sign-out
 * release is registered through `onBeforeSignOut`), and it is not part of the `shell/session`
 * federation export — remotes never touch push.
 */

import { apiFetch, getCachedSession, getNotifyBaseUrl, getSession, navigateSuite, onBeforeSignOut } from './session'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** `GET /push/config`. */
export type PushConfig = { enabled: false } | { enabled: true; vapidPublicKey: string }

/** One row of `GET /push/devices` (no endpoint or keys are ever returned). */
export interface PushDevice {
  id: string
  label: string
  /** ISO 8601. */
  createdAt: string
}

/**
 * Why a push operation failed. `PushSettings` maps each to its copy (design F6):
 *   - `unsupported`          the browser cannot do push (should not be reachable from the UI)
 *   - `blocked`              the prompt was answered "Block" (permission is now `denied`)
 *   - `not_allowed`          the prompt was dismissed (permission is still `default`; Turn on stays)
 *   - `subscribe_failed`     `pushManager.subscribe()` threw (push service unreachable, Chromium forks)
 *   - `device_limit`         409: the user already has 20 devices
 *   - `endpoint_not_allowed` 422
 *   - `push_disabled`        503
 *   - `generic`              network, 5xx, anything unrecognised
 */
export type PushErrorCode =
  | 'unsupported'
  | 'blocked'
  | 'not_allowed'
  | 'subscribe_failed'
  | 'device_limit'
  | 'endpoint_not_allowed'
  | 'push_disabled'
  | 'generic'

export class PushError extends Error {
  readonly code: PushErrorCode
  constructor(code: PushErrorCode) {
    super(code)
    this.name = 'PushError'
    this.code = code
  }
}

/** Where this browser stands after `reconcilePush`. */
export type PushReconcileResult =
  /** Subscribed, owned by the current user, and listed by the server. */
  | { status: 'on'; deviceId: string }
  /** Not subscribed (or the subscription was released). */
  | { status: 'off' }
  /** Could not be checked right now (server unreachable); nothing was changed. */
  | { status: 'unverified' }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVICE_WORKER_URL = '/push-sw.js'
const SERVICE_WORKER_SCOPE = '/'
const STORE_NAME = 'operai-push'
const STORE_OBJECTS = 'device'
const STORE_KEY = 'this-browser'
const MOBILE_UA = /Mobi|Android|iPhone|iPad/i

// ---------------------------------------------------------------------------
// Support and permission
// ---------------------------------------------------------------------------

/**
 * Whether this browser can be offered push (AC-1.6): the three APIs exist and it is not a phone or
 * tablet. `navigator.userAgentData.mobile` decides where the browser has it, otherwise a UA test.
 * iPhone/iPad Safari outside a home-screen app has no `PushManager`, so it falls out by itself.
 */
export function isPushSupported(): boolean {
  if (typeof navigator === 'undefined') return false
  if (!('serviceWorker' in navigator)) return false
  if (typeof globalThis.PushManager === 'undefined') return false
  if (typeof globalThis.Notification === 'undefined') return false
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
  if (typeof uaData?.mobile === 'boolean') return !uaData.mobile
  return !MOBILE_UA.test(navigator.userAgent)
}

/** The browser's notification permission, or `null` where push is not supported. */
export function readPermission(): NotificationPermission | null {
  return isPushSupported() ? Notification.permission : null
}

/**
 * Calls `listener` with the new permission when it may have changed in the browser's own settings
 * (`navigator.permissions` change where supported, and window focus everywhere). Returns the stop
 * function. Design F3: a passive `blocked` -> `off` change is not announced.
 */
export function subscribePermission(listener: (permission: NotificationPermission) => void): () => void {
  const emit = () => {
    const permission = readPermission()
    if (permission) listener(permission)
  }
  window.addEventListener('focus', emit)

  let status: PermissionStatus | undefined
  let stopped = false
  try {
    void navigator.permissions
      ?.query({ name: 'notifications' })
      .then((result) => {
        if (stopped) return
        status = result
        result.addEventListener('change', emit)
      })
      .catch(() => {})
  } catch {
    // the Permissions API is optional; focus alone is enough
  }

  return () => {
    stopped = true
    window.removeEventListener('focus', emit)
    status?.removeEventListener('change', emit)
  }
}

// ---------------------------------------------------------------------------
// The remembered device — {deviceId, userId} in IndexedDB, nothing else (ADR-0001)
// ---------------------------------------------------------------------------

interface StoredDevice {
  deviceId: string
  userId: string
}

/**
 * Whether the browser says the database does not exist. `indexedDB.databases()` is missing in older
 * browsers and may reject; then nothing is known and `false` is returned.
 */
async function databaseKnownAbsent(): Promise<boolean> {
  if (typeof indexedDB.databases !== 'function') return false
  try {
    return !(await indexedDB.databases()).some((database) => database.name === STORE_NAME)
  } catch {
    return false
  }
}

/**
 * Opens the database. `create` is true only for Turn on: every other caller only ever reads or
 * clears what is already there, and a browser that never turned push on must not get an empty
 * `operai-push` database from the shell's boot work (D-7; meetings AC-4.11 expects a clean device).
 * Without `create` it resolves `null` when the database is absent: `databases()` says so where it
 * exists, and otherwise the upgrade that would create it is aborted, which leaves nothing behind.
 */
const openStore = async (create: boolean): Promise<IDBDatabase | null> => {
  if (!create && (await databaseKnownAbsent())) return null
  return new Promise((resolve, reject) => {
    let uncreated = false
    const request = indexedDB.open(STORE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!create) {
        uncreated = true
        request.transaction?.abort()
        return
      }
      if (!request.result.objectStoreNames.contains(STORE_OBJECTS)) request.result.createObjectStore(STORE_OBJECTS)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      if (uncreated) resolve(null)
      else reject(request.error ?? new Error('indexedDB open failed'))
    }
  })
}

/** Runs one request in the store; `undefined` when `create` is false and there is no database. */
const withStore = async <T>(
  mode: IDBTransactionMode,
  create: boolean,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> => {
  const db = await openStore(create)
  if (!db) return undefined
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_OBJECTS, mode)
      const request = run(tx.objectStore(STORE_OBJECTS))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'))
      tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'))
    })
  } finally {
    db.close()
  }
}

const isStoredDevice = (value: unknown): value is StoredDevice =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as StoredDevice).deviceId === 'string' &&
  typeof (value as StoredDevice).userId === 'string'

/** The remembered device, or `null` when nothing (valid) is stored or the store cannot be read. */
async function readStored(): Promise<StoredDevice | null> {
  try {
    const value = await withStore<unknown>('readonly', false, (store) => store.get(STORE_KEY))
    return isStoredDevice(value) ? { deviceId: value.deviceId, userId: value.userId } : null
  } catch {
    return null
  }
}

/** `true` when written. */
async function writeStored(value: StoredDevice): Promise<boolean> {
  try {
    await withStore('readwrite', true, (store) =>
      store.put({ deviceId: value.deviceId, userId: value.userId }, STORE_KEY),
    )
    return true
  } catch {
    return false
  }
}

async function clearStored(): Promise<void> {
  try {
    await withStore('readwrite', false, (store) => store.delete(STORE_KEY))
  } catch {
    // nothing to clear, or nothing we can clear
  }
}

// ---------------------------------------------------------------------------
// The browser subscription
// ---------------------------------------------------------------------------

/** The current subscription of the worker registered at `/`, `null` if none. Rejects if the browser throws. */
async function readSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_SCOPE)
  return registration ? await registration.pushManager.getSubscription() : null
}

async function unsubscribeQuietly(subscription: PushSubscription | null): Promise<void> {
  if (!subscription) return
  try {
    await subscription.unsubscribe()
  } catch {
    // the endpoint stays alive at the push service; the server prunes it on its next 404/410
  }
}

/** Unsubscribes whatever this browser holds for the worker. Never throws. */
async function releaseBrowserSubscription(): Promise<void> {
  try {
    await unsubscribeQuietly(await readSubscription())
  } catch {
    // no readable registration: nothing to release
  }
}

/** base64url (the VAPID public key) -> bytes, for `applicationServerKey`. */
const decodeBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

// ---------------------------------------------------------------------------
// notify-api calls
// ---------------------------------------------------------------------------

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await apiFetch(`${getNotifyBaseUrl()}${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch {
    throw new PushError('generic')
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

const isDevice = (value: unknown): value is PushDevice =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as PushDevice).id === 'string' &&
  typeof (value as PushDevice).label === 'string' &&
  typeof (value as PushDevice).createdAt === 'string'

/** `GET /push/config`. Rejects with `PushError('generic')` when it cannot be loaded (AC-1.8). */
export async function getPushConfig(): Promise<PushConfig> {
  const response = await send('GET', '/push/config')
  if (!response.ok) throw new PushError('generic')
  const body = (await readJson(response)) as { enabled?: unknown; vapidPublicKey?: unknown } | undefined
  if (body?.enabled === false) return { enabled: false }
  if (body?.enabled === true && typeof body.vapidPublicKey === 'string' && body.vapidPublicKey !== '') {
    return { enabled: true, vapidPublicKey: body.vapidPublicKey }
  }
  throw new PushError('generic')
}

/** `GET /push/devices`. Rejects with `PushError('generic')` when it cannot be loaded. */
export async function listPushDevices(): Promise<PushDevice[]> {
  const response = await send('GET', '/push/devices')
  if (!response.ok) throw new PushError('generic')
  const body = (await readJson(response)) as { items?: unknown } | undefined
  if (!Array.isArray(body?.items) || !body.items.every(isDevice)) throw new PushError('generic')
  return body.items.map(({ id, label, createdAt }) => ({ id, label, createdAt }))
}

const PUT_ERROR_CODES: readonly PushErrorCode[] = ['device_limit', 'endpoint_not_allowed', 'push_disabled']

/** `PUT /push/devices` for a live subscription. Rejects with the mapped `PushError`. */
async function registerDevice(subscription: PushSubscription): Promise<PushDevice> {
  const { endpoint, keys } = subscription.toJSON()
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new PushError('generic')
  const response = await send('PUT', '/push/devices', { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } })
  if (response.status === 200 || response.status === 201) {
    const device = await readJson(response)
    if (!isDevice(device)) throw new PushError('generic')
    return { id: device.id, label: device.label, createdAt: device.createdAt }
  }
  const code = ((await readJson(response)) as { code?: unknown } | undefined)?.code
  const mapped = PUT_ERROR_CODES.find((candidate) => candidate === code)
  throw new PushError(mapped ?? 'generic')
}

/** `DELETE /push/devices/{id}`; a 404 is success (already gone). Rejects with `PushError('generic')`. */
async function deleteDevice(id: string): Promise<void> {
  const response = await send('DELETE', `/push/devices/${encodeURIComponent(id)}`)
  if (response.ok || response.status === 404) return
  throw new PushError('generic')
}

// ---------------------------------------------------------------------------
// Turning this browser on / off, removing a device
// ---------------------------------------------------------------------------

/** How long Turn on waits for the worker to become active before giving up (D-2). */
export const SERVICE_WORKER_READY_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error('rejected'))
      },
    )
  })
}

/**
 * Turns push on for this browser (AC-1.2/1.3). MUST be called straight from the click handler: the
 * permission prompt is the first thing it does, before any `await` (Safari requires a user gesture).
 *
 * Resolves with the registered device. Rejects with a `PushError`; on every rejection the browser
 * holds no subscription it created and nothing is remembered ("no half-registered state", design F6).
 * `blocked` / `not_allowed` / `subscribe_failed` send nothing to the server.
 */
export async function enablePush(input: { userId: string; vapidPublicKey: string }): Promise<PushDevice> {
  if (!isPushSupported()) throw new PushError('unsupported')

  let permission: NotificationPermission
  try {
    permission = await Notification.requestPermission()
  } catch {
    throw new PushError('generic')
  }
  if (permission === 'denied') throw new PushError('blocked')
  if (permission !== 'granted') throw new PushError('not_allowed')

  let registration: ServiceWorkerRegistration
  try {
    await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE })
  } catch {
    throw new PushError('generic')
  }
  try {
    registration = await withTimeout(navigator.serviceWorker.ready, SERVICE_WORKER_READY_TIMEOUT_MS)
  } catch {
    // The worker never became active (install failed, script error, blocked): nothing was subscribed
    // or stored yet, and Turn on is the retry (design F6, D-2).
    throw new PushError('subscribe_failed')
  }

  let subscription: PushSubscription
  try {
    // A leftover subscription may have been made with another application server key, which makes
    // subscribe() throw; start clean.
    await unsubscribeQuietly(await registration.pushManager.getSubscription())
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(input.vapidPublicKey),
    })
  } catch {
    throw new PushError('subscribe_failed')
  }

  let device: PushDevice | undefined
  try {
    device = await registerDevice(subscription)
    if (!(await writeStored({ deviceId: device.id, userId: input.userId }))) throw new PushError('generic')
    return device
  } catch (error) {
    if (device) await deleteDevice(device.id).catch(() => {})
    await unsubscribeQuietly(subscription)
    throw error instanceof PushError ? error : new PushError('generic')
  }
}

/**
 * Turns push off for this browser (AC-1.5): deletes the device (a 404 counts), then unsubscribes and
 * forgets it. If the server cannot be reached it rejects with `PushError('generic')` and changes
 * NOTHING — the browser stays on and "Turn off" is the retry (design F4).
 */
export async function disablePush(): Promise<void> {
  const stored = await readStored()
  if (stored) await deleteDevice(stored.deviceId)
  await releaseBrowserSubscription()
  await clearStored()
}

/**
 * Removes one of the user's devices (AC-3.2). When it is THIS browser's, the subscription is also
 * released and forgotten. Rejects with `PushError('generic')` and changes nothing locally on failure.
 */
export async function removePushDevice(id: string): Promise<{ wasThisBrowser: boolean }> {
  const stored = await readStored()
  const wasThisBrowser = stored?.deviceId === id
  await deleteDevice(id)
  if (wasThisBrowser) {
    await releaseBrowserSubscription()
    await clearStored()
  }
  return { wasThisBrowser }
}

/**
 * The id of this browser's device, or `null`: it needs a live browser subscription AND a remembered
 * device of `userId`. Compare it with `listPushDevices()` for the "on" state and the "this browser"
 * marker — or just use the result of `reconcilePush`, which has already done the comparison.
 */
export async function getThisBrowserDeviceId(userId: string): Promise<string | null> {
  if (!isPushSupported()) return null
  try {
    const [stored, subscription] = await Promise.all([readStored(), readSubscription()])
    return stored && subscription && stored.userId === userId ? stored.deviceId : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Reconciliation (boot, and whenever the section loads)
// ---------------------------------------------------------------------------

/**
 * Brings the browser and the server back in agreement (AC-1.7, AC-5.3, design G4). Never prompts.
 *
 *  - stored user is not `userId`, or a subscription has no remembered owner -> unsubscribe, forget (off)
 *  - permission no longer `granted` -> best-effort DELETE, unsubscribe, forget (off)
 *  - remembered device but the browser lost the subscription (Safari) -> best-effort DELETE, forget (off)
 *  - subscription and device listed by the server -> on
 *  - listed row missing (pruned) -> silent re-PUT; a definitive refusal releases the subscription (off),
 *    an inconclusive failure keeps it (unverified)
 *  - the server list cannot be read -> unverified, nothing changed
 *
 * Never rejects.
 */
export async function reconcilePush(userId: string): Promise<PushReconcileResult> {
  if (!isPushSupported()) return { status: 'off' }

  const stored = await readStored()
  let subscription: PushSubscription | null
  try {
    subscription = await readSubscription()
  } catch {
    return { status: 'unverified' }
  }

  if (!stored && !subscription) return { status: 'off' }

  if (!stored || stored.userId !== userId) {
    await unsubscribeQuietly(subscription)
    await clearStored()
    return { status: 'off' }
  }

  if (Notification.permission !== 'granted' || !subscription) {
    await unsubscribeQuietly(subscription)
    await deleteDevice(stored.deviceId).catch(() => {})
    await clearStored()
    return { status: 'off' }
  }

  let devices: PushDevice[]
  try {
    devices = await listPushDevices()
  } catch {
    return { status: 'unverified' }
  }
  if (devices.some((device) => device.id === stored.deviceId)) return { status: 'on', deviceId: stored.deviceId }

  // The server dropped the row (pruned). Permission is granted, so register the subscription again.
  try {
    const device = await registerDevice(subscription)
    if (!(await writeStored({ deviceId: device.id, userId }))) return { status: 'unverified' }
    return { status: 'on', deviceId: device.id }
  } catch (error) {
    if (error instanceof PushError && error.code !== 'generic') {
      await unsubscribeQuietly(subscription)
      await clearStored()
      return { status: 'off' }
    }
    return { status: 'unverified' }
  }
}

// ---------------------------------------------------------------------------
// Sign-out and boot
// ---------------------------------------------------------------------------

/**
 * The before-sign-out step (AC-5.1), registered by `initPush`. `signOut()` gives it 2 s and runs it
 * while the JWT is still cached. The browser subscription is released at once (it kills the endpoint
 * whatever the server says) and the device is deleted in parallel; a failed DELETE only means the
 * row is pruned on the next send. Never rejects.
 */
export async function releasePushOnSignOut(): Promise<void> {
  if (!isPushSupported()) return
  try {
    const stored = await readStored()
    const deletion = stored ? deleteDevice(stored.deviceId).catch(() => {}) : Promise.resolve()
    await releaseBrowserSubscription()
    await clearStored()
    await deletion
  } catch {
    // sign-out must go on
  }
}

const currentUserId = async (): Promise<string | undefined> => {
  type Loose = { data?: { user?: { id?: unknown } | null } | null } | null | undefined
  const cached = getCachedSession() as Loose
  const session = cached ?? ((await getSession()) as Loose)
  const id = session?.data?.user?.id
  return typeof id === 'string' ? id : undefined
}

/**
 * Shell boot (called once by `ShellLayout`): registers the sign-out release, then reconciles this
 * browser for the signed-in user. Never prompts, never rejects.
 */
export async function initPush(): Promise<void> {
  try {
    onBeforeSignOut(releasePushOnSignOut)
    const userId = await currentUserId()
    if (userId) await reconcilePush(userId)
  } catch {
    // push is an enhancement; a boot failure must never reach the shell
  }
}

// ---------------------------------------------------------------------------
// Service worker message
// ---------------------------------------------------------------------------

/**
 * Handles a message from the push service worker (T7 contract: exactly `{ navigate: <absolute
 * URL> }`, posted to a focused window on a notification click). Anything else is ignored, and the
 * URL must be on this page's origin before the suite navigates to its path.
 */
export function handleServiceWorkerMessage(data: unknown): void {
  const navigate = (data as { navigate?: unknown } | null | undefined)?.navigate
  if (typeof navigate !== 'string') return
  let url: URL
  try {
    url = new URL(navigate)
  } catch {
    return
  }
  if (url.origin !== window.location.origin) return
  // The URL parser normalises `/..//evil.io` (and strips tabs/newlines) into a `//evil.io` path,
  // which `navigateSuite` would read as scheme-relative (S-M1).
  if (url.pathname.startsWith('//')) return
  navigateSuite(`${url.pathname}${url.search}${url.hash}`)
}

/**
 * Listens for the push service worker's messages for as long as the shell is mounted and passes each
 * to `handleServiceWorkerMessage`. A no-op where there is no service worker API. Returns the stop
 * function.
 */
export function listenForServiceWorkerMessages(): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {}
  const container = navigator.serviceWorker
  const onMessage = (event: MessageEvent) => handleServiceWorkerMessage(event.data)
  container.addEventListener('message', onMessage)
  return () => container.removeEventListener('message', onMessage)
}
