// Test-only resolution stub for the `inventory/MyDevices` federated module
// (T41, specs/20261006-hardware-inventory, ADR 20261006-ungated-second-federated-entry-of-a-gated-remote) — the ungated second entry of
// the inventory remote, mounted at the shell's `/devices` route. See
// inventoryApp.tsx for why a resolvable stub exists; router tests override it
// with vi.mock. Never rendered.
export default function InventoryMyDevicesResolutionStub() {
  return null
}
