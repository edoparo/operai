// Test-only resolution stub for the `crm/App` federated module (specs/20261101-crm).
// Same rationale as inventoryApp.tsx: vitest runs without the
// @module-federation/vite plugin, so the bare specifier is aliased here
// (vitest.config.ts) purely so Vite's import analysis can resolve it before a
// test's `vi.mock('crm/App', factory)` takes over. Never rendered.
export default function CrmAppResolutionStub() {
  return null
}
