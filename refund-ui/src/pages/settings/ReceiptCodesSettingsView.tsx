/**
 * ReceiptCodesSettingsView — the "Receipt codes" view of Settings
 * (specs/20261124-receipt-numbers-from-the-register, design RC-1, S1; AC-4.9): the receipt codes card and nothing else.
 * Mounted only while its tab is open (or as the whole page, for a holder of only `receipt-code:manage`) and only for a
 * user with `receipt-code:manage` (the page decides): there is no read-only mode, so the view has no capability
 * check of its own and a 403 that arrives anyway is the card's `PermissionDenied`. UX only: refund-api gates every
 * method of the route.
 *
 * The card sits in no `<form>`, so every dialog it opens is mounted beside it (ADR 20261118 dialog-beside-form).
 */

import ReceiptCodesCard from '../../components/settings/ReceiptCodesCard'

export default function ReceiptCodesSettingsView() {
  return (
    <div className="flex flex-col gap-4" data-testid="refund-settings-receipt-codes">
      <ReceiptCodesCard />
    </div>
  )
}
