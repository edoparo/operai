/**
 * PushSettings — the "Push notifications" section of My profile (specs/029-push-notifications, T9;
 * design.md § Flows F1-F7, § Screens & states, § Accessibility; AC-1.1-1.6, 1.8, 3.1, 3.2, 6.1).
 *
 * A composition of `@operai/ui` parts (no switch exists in the library: a status line and one
 * `Button`). It sits BESIDE the address section on `AccountScreen`, never inside
 * `account-address-region` (specs/012 AC-6.2: that region has no interactive element).
 *
 * All browser and notify-api work is `../lib/push` (T8); this file holds state and copy only:
 *   - nothing is drawn until `GET /push/config` answers; `enabled:false` draws nothing (AC-6.1); a
 *     FAILED config request is not "disabled" - it draws the heading and a warning Banner (AC-1.8);
 *   - `reconcilePush` decides on/off/unverified and `listPushDevices` fills the list; either failing
 *     is the load-failed state, which hides the on/off control (it depends on the server list)
 *     except where the mode needs no server state (unsupported, blocked);
 *   - `enablePush` is called straight from the click handler (the permission prompt must be the
 *     first await, Safari);
 *   - the permission is never requested on load (AC-1.1).
 */

import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  PageHeader,
  SkeletonRows,
  StatePanel,
  StatusBadge,
  VisuallyHidden,
  formatDate,
  useFocusOnMount,
} from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import {
  disablePush,
  enablePush,
  isPushSupported,
  readPermission,
  removePushDevice,
  subscribePermission,
} from '../lib/push'
import type { PushDevice } from '../lib/push'
import {
  COLUMN_ACTIONS,
  COLUMN_BROWSER,
  COLUMN_SINCE,
  DENIED,
  DEVICE_ROW_TEST_ID_PREFIX,
  FIRST_CONTROL_SELECTOR,
  LOADING,
  ON_MEANING,
  PENDING,
  STATIC_NOTICE,
  describeEnableFailure,
  focusAfterRemoval,
  isDenied,
  isFailed,
  isHidden,
  isLoaded,
  isLoading,
  isPending,
  loadPush,
  pushMode,
} from '../lib/pushSettingsModel'
import type { LoadedPush, PushLoad } from '../lib/pushSettingsModel'
import { useSession } from '../lib/session'
import { strings } from '../strings'

type Note =
  { kind: 'success'; text: string } | { kind: 'error'; text: string } | { kind: 'warning'; text: string } | null

/** The blocked explanation; after a refusal it is announced and takes focus (the button it replaced is gone). */
function BlockedNotice({ refused }: { refused: boolean }) {
  const ref = useFocusOnMount<HTMLDivElement>(refused)
  return (
    <Banner
      ref={ref}
      tone="warning"
      live={refused ? 'polite' : STATIC_NOTICE}
      tabIndex={refused ? -1 : undefined}
      aria-label={strings.push.status.blocked}
      data-testid="account-push-banner"
    >
      {strings.push.blocked}
    </Banner>
  )
}

export function PushSettings() {
  const userId = useSession().data?.user.id
  const [load, setLoad] = useState<PushLoad>(PENDING)
  const [reloadToken, setReloadToken] = useState(0)
  const [supported] = useState(() => isPushSupported())
  const [permission, setPermission] = useState(() => readPermission())
  const [refused, setRefused] = useState(false)
  const [turningOn, setTurningOn] = useState(false)
  const [turningOff, setTurningOff] = useState(false)
  const [note, setNote] = useState<Note>(null)
  const [removeTarget, setRemoveTarget] = useState<PushDevice | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  const refocusAfterLoad = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(
    () =>
      subscribePermission((next) => {
        setPermission(next)
        if (!isDenied(next)) setRefused(false)
      }),
    [],
  )

  // An explicit promise chain, not an async body that sets state: see AccountScreen's effect.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    loadPush(userId, () => {
      if (!cancelled) setLoad((previous) => (isPending(previous) ? LOADING : previous))
    }).then((next) => {
      if (!cancelled) setLoad(next)
    })
    return () => {
      cancelled = true
    }
  }, [userId, reloadToken])

  // Retry took focus with it when the failure banner vanished: put it on the first control.
  useEffect(() => {
    if (!isLoaded(load) || !refocusAfterLoad.current) return
    refocusAfterLoad.current = false
    sectionRef.current?.querySelector<HTMLElement>(FIRST_CONTROL_SELECTOR)?.focus()
  }, [load])

  if (!userId || isHidden(load)) return null

  const t = strings.push
  const loaded = isLoaded(load) ? load : null
  const mode = pushMode({ supported, permission, thisId: loaded?.thisId ?? null })

  const updateLoaded = (change: (current: LoadedPush) => LoadedPush) =>
    setLoad((current) => (isLoaded(current) ? change(current) : current))

  const retry = () => {
    refocusAfterLoad.current = sectionRef.current?.contains(document.activeElement) === true
    setLoad(LOADING)
    setReloadToken((token) => token + 1)
  }

  const turnOn = () => {
    if (!loaded || busyRef.current) return
    busyRef.current = true
    setTurningOn(true)
    setNote(null)
    // Called synchronously from the click: the permission prompt is its first await.
    enablePush({ userId, vapidPublicKey: loaded.vapidPublicKey }).then(
      (device) => {
        busyRef.current = false
        if (!mountedRef.current) return
        setTurningOn(false)
        setRefused(false)
        updateLoaded((current) => ({
          ...current,
          devices: [device, ...current.devices.filter((existing) => existing.id !== device.id)],
          thisId: device.id,
          focusKey: null,
          focusEmpty: false,
        }))
        setNote({ kind: 'success', text: t.enabled })
      },
      (error: unknown) => {
        busyRef.current = false
        if (!mountedRef.current) return
        setTurningOn(false)
        const failure = describeEnableFailure(error)
        if (failure.kind === 'blocked') {
          setPermission(DENIED)
          setRefused(true)
        } else if (failure.kind === 'warning') {
          setNote({ kind: 'warning', text: t.notAllowed })
        } else {
          setNote({ kind: 'error', text: failure.message })
        }
      },
    )
  }

  const turnOff = () => {
    if (!loaded || busyRef.current) return
    const id = loaded.thisId
    busyRef.current = true
    setTurningOff(true)
    setNote(null)
    disablePush().then(
      () => {
        busyRef.current = false
        if (!mountedRef.current) return
        setTurningOff(false)
        updateLoaded((current) => ({
          ...current,
          devices: current.devices.filter((device) => device.id !== id),
          thisId: null,
        }))
        setNote({ kind: 'success', text: t.disabled })
      },
      () => {
        busyRef.current = false
        if (!mountedRef.current) return
        setTurningOff(false)
        setNote({ kind: 'error', text: t.errors.turnOffFailed })
      },
    )
  }

  const confirmRemove = () => {
    if (!removeTarget || removeBusy) return
    const target = removeTarget
    setRemoveBusy(true)
    setRemoveError(null)
    removePushDevice(target.id).then(
      ({ wasThisBrowser }) => {
        if (!mountedRef.current) return
        setRemoveBusy(false)
        setRemoveTarget(null)
        updateLoaded((current) => ({
          ...current,
          devices: current.devices.filter((device) => device.id !== target.id),
          thisId: wasThisBrowser || current.thisId === target.id ? null : current.thisId,
          focusKey: focusAfterRemoval(current.devices, target.id),
          focusEmpty: current.devices.every((device) => device.id === target.id),
        }))
        setNote({ kind: 'success', text: t.removed(target.label) })
      },
      () => {
        if (!mountedRef.current) return
        setRemoveBusy(false)
        setRemoveError(t.removeDialog.error)
      },
    )
  }

  const statusElement = mode.on ? (
    <StatusBadge status={ON_MEANING} data-testid="account-push-status">
      {t.status.on}
    </StatusBadge>
  ) : (
    <Badge data-testid="account-push-status">
      {mode.blocked ? t.status.blocked : mode.unsupported ? t.status.unavailable : t.status.off}
    </Badge>
  )

  const noteBanner = note && !mode.blocked && (
    <Banner
      tone={note.kind === 'error' ? 'danger' : note.kind}
      live={note.kind === 'warning' ? 'polite' : undefined}
      compact={note.kind === 'success'}
      autoDismiss={note.kind === 'success'}
      dismissible={false}
      onDismiss={() => setNote(null)}
      className="mb-3"
      data-testid="account-push-banner"
    >
      {note.text}
    </Banner>
  )

  const showToggle = loaded !== null && !mode.unsupported && !mode.blocked
  const thisBrowserCard =
    loaded || mode.unsupported || mode.blocked ? (
      <Card title={t.thisBrowser} className="mb-4">
        {noteBanner}
        <div className="flex flex-wrap items-center gap-3">
          {statusElement}
          {showToggle &&
            (mode.on ? (
              <Button variant="secondary" busy={turningOff} onClick={turnOff} data-testid="account-push-toggle">
                {turningOff ? t.turningOff : t.turnOff}
              </Button>
            ) : (
              <Button variant="primary" busy={turningOn} onClick={turnOn} data-testid="account-push-toggle">
                {turningOn ? t.turningOn : t.turnOn}
              </Button>
            ))}
        </div>
        {showToggle && <p className="mt-2 text-sm text-soft">{mode.on ? t.onHint : t.offHint}</p>}
        {mode.unsupported && (
          <p className="mt-3 text-sm text-soft" data-testid="account-push-unsupported">
            {t.unsupported}
          </p>
        )}
        {mode.blocked && (
          <div className="mt-3">
            <BlockedNotice refused={refused} />
          </div>
        )}
      </Card>
    ) : null

  const columns: DataTableColumn<PushDevice>[] = [
    {
      id: COLUMN_BROWSER,
      header: t.devices.columnBrowser,
      rowHeader: true,
      render: (device) => (
        <span className="flex flex-wrap items-center gap-2">
          {device.label}
          {loaded?.thisId === device.id && <Badge>{t.devices.thisBrowser}</Badge>}
        </span>
      ),
    },
    {
      id: COLUMN_SINCE,
      header: t.devices.columnSince,
      render: (device) => <span className="font-mono">{formatDate(device.createdAt)}</span>,
    },
    {
      id: COLUMN_ACTIONS,
      header: <VisuallyHidden>{t.devices.columnActions}</VisuallyHidden>,
      render: (device) => (
        <Button
          size="sm"
          variant="secondary"
          aria-label={t.devices.removeLabel(device.label, formatDate(device.createdAt))}
          aria-haspopup="dialog"
          onClick={() => {
            setRemoveError(null)
            setRemoveTarget(device)
          }}
          data-testid={`account-push-device-remove-${device.id}`}
        >
          {t.devices.remove}
        </Button>
      ),
    },
  ]

  return (
    <section
      ref={sectionRef}
      aria-labelledby="account-push-heading"
      data-testid="account-push-section"
      className="mt-8"
    >
      <PageHeader title={t.heading} titleId="account-push-heading" description={t.description} />

      {isLoading(load) && (
        <div data-testid="account-push-loading">
          <VisuallyHidden live>{t.loading}</VisuallyHidden>
          <SkeletonRows rows={2} actions={0} />
        </div>
      )}

      {thisBrowserCard}

      {isFailed(load) && (
        <Banner tone="warning" onRetry={retry} retryLabel={t.retry} data-testid="account-push-load-error">
          {t.loadError}
        </Banner>
      )}

      {loaded && (
        <Card title={t.devices.title}>
          {loaded.devices.length > 0 ? (
            <DataTable
              caption={t.devices.caption}
              columns={columns}
              rows={loaded.devices}
              getRowKey={(device) => device.id}
              focusRowKey={loaded.focusKey}
              testId="account-push-devices"
              rowTestIdPrefix={DEVICE_ROW_TEST_ID_PREFIX}
            />
          ) : (
            <StatePanel title={t.devices.emptyTitle} headingLevel={4} focusOnMount={loaded.focusEmpty}>
              {t.devices.emptyBody}
            </StatePanel>
          )}
        </Card>
      )}

      {removeTarget && (
        <ConfirmDialog
          title={t.removeDialog.title(removeTarget.label)}
          confirmLabel={t.removeDialog.confirm}
          busyLabel={t.removeDialog.busy}
          cancelLabel={t.removeDialog.cancel}
          closeLabel={t.removeDialog.close}
          busy={removeBusy}
          error={removeError}
          onConfirm={confirmRemove}
          onCancel={() => setRemoveTarget(null)}
          testIdPrefix="account-push-remove"
        >
          {loaded?.thisId === removeTarget.id ? t.removeDialog.bodyThisBrowser : t.removeDialog.body}
        </ConfirmDialog>
      )}
    </section>
  )
}

export default PushSettings
