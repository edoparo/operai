/**
 * The non-visual half of the My profile push section (specs/029-push-notifications, T9): the load
 * state machine's data, the browser mode, and the mapping from `enablePush` failures to copy.
 * `components/PushSettings.tsx` renders it. This is a `.ts` module so the state vocabulary
 * (`failed`, `denied`, `not_allowed` ...) is not mistaken for user-visible copy by the
 * no-hardcoded-strings scan, which reads `.tsx` only.
 */

import type { BannerProps, StatusMeaning } from '@operai/ui'
import { PushError, getPushConfig, listPushDevices, reconcilePush } from './push'
import type { PushDevice } from './push'
import { strings } from '../strings'

export interface LoadedPush {
  s: 'loaded'
  vapidPublicKey: string
  devices: PushDevice[]
  /** This browser's device id when push is on here; null otherwise. */
  thisId: string | null
  /** Row header to focus (DataTable `focusRowKey`) after a removal. */
  focusKey: string | null
  /** Bumped by every removal; the device table is keyed on it so a repeated `focusKey` still moves focus. */
  focusSeq: number
  /** The list became empty through a removal: the empty panel takes focus. */
  focusEmpty: boolean
}

export type PushLoad = { s: 'pending' } | { s: 'disabled' } | { s: 'loading' } | { s: 'failed' } | LoadedPush

export const PENDING: PushLoad = { s: 'pending' }
export const LOADING: PushLoad = { s: 'loading' }

/** Nothing is drawn: the config has not answered yet, or push is off for this deployment (AC-6.1). */
export const isHidden = (load: PushLoad): boolean => load.s === 'pending' || load.s === 'disabled'
export const isPending = (load: PushLoad): boolean => load.s === 'pending'
export const isFailed = (load: PushLoad): boolean => load.s === 'failed'
export const isLoading = (load: PushLoad): boolean => load.s === 'loading'
export const isLoaded = (load: PushLoad): load is LoadedPush => load.s === 'loaded'

/**
 * Config, then reconcile, then the device list. Reconcile goes first: it may re-register a pruned
 * row or release a stale subscription, which the list must then reflect. A failed config request
 * is `failed`, NOT disabled (AC-1.8); an `unverified` reconcile reads like a failed load.
 * `onConfigured` fires once push is known to be enabled, so the section can show its loading state.
 */
export async function loadPush(userId: string, onConfigured: () => void): Promise<PushLoad> {
  let config: Awaited<ReturnType<typeof getPushConfig>>
  try {
    config = await getPushConfig()
  } catch {
    return { s: 'failed' }
  }
  if (!config.enabled) return { s: 'disabled' }
  onConfigured()
  try {
    const reconciled = await reconcilePush(userId)
    if (reconciled.status === 'unverified') return { s: 'failed' }
    const devices = await listPushDevices()
    return {
      s: 'loaded',
      vapidPublicKey: config.vapidPublicKey,
      devices,
      thisId: reconciled.status === 'on' ? reconciled.deviceId : null,
      focusKey: null,
      focusSeq: 0,
      focusEmpty: false,
    }
  } catch {
    return { s: 'failed' }
  }
}

export interface PushMode {
  unsupported: boolean
  blocked: boolean
  on: boolean
}

/** design.md F1, checked in this order: unsupported, blocked, on, otherwise off. */
export function pushMode(input: {
  supported: boolean
  permission: NotificationPermission | null
  thisId: string | null
}): PushMode {
  const unsupported = !input.supported
  const blocked = !unsupported && input.permission === DENIED
  return { unsupported, blocked, on: !unsupported && !blocked && input.thisId !== null }
}

/** What the browser reports once the prompt was answered "Block". */
export const DENIED: NotificationPermission = 'denied'
export const isDenied = (permission: NotificationPermission): boolean => permission === DENIED

/** The row to focus after removing `removedId` from `before`: the next row, else the previous one. */
export function focusAfterRemoval(before: readonly PushDevice[], removedId: string): string | null {
  const index = before.findIndex((device) => device.id === removedId)
  const after = before.filter((device) => device.id !== removedId)
  return after[index]?.id ?? after[index - 1]?.id ?? null
}

/** Finds the first control of the section: the on/off button, else the first Remove button. */
export const FIRST_CONTROL_SELECTOR =
  '[data-testid="account-push-toggle"], [data-testid^="account-push-device-remove-"]'

export type EnableFailure = { kind: 'blocked' } | { kind: 'warning' } | { kind: 'error'; message: string }

/** design.md F3 and F6: how a failed `enablePush` is told to the person. */
export function describeEnableFailure(error: unknown): EnableFailure {
  const t = strings.push.errors
  switch (error instanceof PushError ? error.code : 'generic') {
    case 'blocked':
      return { kind: 'blocked' }
    case 'not_allowed':
      return { kind: 'warning' }
    case 'device_limit':
      return { kind: 'error', message: t.deviceLimit }
    case 'endpoint_not_allowed':
      return { kind: 'error', message: t.endpointNotAllowed }
    case 'push_disabled':
      return { kind: 'error', message: t.unavailable }
    case 'subscribe_failed':
      return { kind: 'error', message: t.subscribeFailed }
    default:
      return { kind: 'error', message: t.generic }
  }
}

// Wiring vocabulary for the component (kept out of the .tsx so the copy scan stays meaningful).
/** The status-dictionary meaning of "On": accepted and in effect. */
export const ON_MEANING: StatusMeaning = 'active'
/** A persistent notice that is read in place, not announced. */
export const STATIC_NOTICE: BannerProps['live'] = 'off'
export const DEVICE_ROW_TEST_ID_PREFIX = 'account-push-device'
export const COLUMN_BROWSER = 'browser'
export const COLUMN_SINCE = 'since'
export const COLUMN_ACTIONS = 'actions'
