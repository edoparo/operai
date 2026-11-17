// Test-only resolution stub for the `letterheads/App` federated module (specs/20261116-letterhead-service).
// Same rationale as projectsApp.tsx: vitest runs without the @module-federation/vite
// plugin, so the bare specifier is aliased here (vitest.config.ts) purely so Vite's
// import analysis can resolve it before a test's `vi.mock('letterheads/App', factory)`
// takes over. Never rendered.
export default function LetterheadsAppResolutionStub() {
  return null
}
