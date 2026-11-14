import { Button, VisuallyHidden, listRowClassName, listRowMetaClassName } from '@operai/ui'
import { formatDate } from '../lib/dates'
import type { MyDevice } from '../lib/types'
import { strings } from '../strings'

/**
 * DeviceCard — one device on the employee's "My devices" view (T31,
 * specs/20261006-hardware-inventory; design.md § D1, § Accessibility "D1 my devices";
 * AC-2.3, AC-2.4, AC-4.1, AC-4.2).
 *
 * Presentational, and deliberately narrow: it takes a `MyDevice` and renders
 * only description, category, serial number and a date — never a price, a
 * currency, an entity or a book value, whatever else the object carries
 * (AC-4.2). A `pending` card offers the two answers to an assignment: Confirm
 * (one click, design Q3) and Decline (the page opens its confirm dialog). A
 * `held` card has no actions.
 *
 * Both actions are named with the device ("I have received this device – MacBook
 * Pro 14") by a visually hidden suffix, so the visible label stays inside the
 * accessible name (WCAG 2.5.3). While a request is in flight the buttons are
 * `aria-disabled`, not `disabled`, so focus stays where the user left it, and a
 * click is ignored. The heading is a programmatic focus target (`tabIndex={-1}`,
 * `data-device-heading`) for the page's focus management after an action; an
 * error is an inline `role="alert"` on the card, so a failed action keeps focus
 * on the card it concerns.
 */

export type DeviceCardProps = {
  device: MyDevice
  kind: 'pending' | 'held'
  /** A request for this card is in flight. */
  busy?: boolean
  /** Why the last action on this card failed. */
  errorMessage?: string | null
  onConfirm?: () => void
  onDecline?: () => void
}

// Layout only: the 44px touch target and the full-width-on-mobile stacking.
const BUTTON_LAYOUT = 'min-h-[44px] w-full sm:w-auto'

export default function DeviceCard({
  device,
  kind,
  busy = false,
  errorMessage = null,
  onConfirm,
  onDecline,
}: DeviceCardProps) {
  const t = strings.myDevices.card
  const date = formatDate(device.assignedAt)
  const meta = [
    strings.categories[device.category] ?? device.category,
    device.serialNumber,
    kind === 'pending' ? t.offered(date) : t.assigned(date),
  ].filter((part): part is string => part !== null && part !== '')

  return (
    <div data-testid="device-card" data-kind={kind} className={`${listRowClassName} flex-wrap`}>
      <div className="min-w-0 flex-1">
        <h3
          tabIndex={-1}
          data-device-heading={device.assetId}
          className="text-sm font-semibold focus:outline-none focus-visible:ring-2 text-text"
        >
          {device.description}
        </h3>
        <p className={`mt-0.5 ${listRowMetaClassName}`}>{meta.join(' · ')}</p>
      </div>

      {kind === 'pending' && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="primary"
            className={BUTTON_LAYOUT}
            onClick={() => {
              if (!busy) onConfirm?.()
            }}
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
          >
            {busy ? t.confirming : t.confirm} <VisuallyHidden>{t.forDevice(device.description)}</VisuallyHidden>
          </Button>
          <Button
            variant="secondary"
            className={BUTTON_LAYOUT}
            onClick={() => {
              if (!busy) onDecline?.()
            }}
            aria-disabled={busy || undefined}
          >
            {t.decline} <VisuallyHidden>{t.forDevice(device.description)}</VisuallyHidden>
          </Button>
        </div>
      )}

      {errorMessage !== null && (
        <p role="alert" className="form-error basis-full">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
