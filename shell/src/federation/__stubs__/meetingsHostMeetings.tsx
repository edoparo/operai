// Test-only resolution stub for the `meetings/HostMeetings` federated module
// (specs/20261104-meetings, T51, ADR 20261104-host-extension-federated-panel-through-the-shell) — the panel `HostExtension` loads on a
// host's behalf. extensions.test.tsx overrides it with vi.mock. Never rendered.
export default function MeetingsHostMeetingsResolutionStub() {
  return null
}
