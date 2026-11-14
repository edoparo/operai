// Ambient module declarations for the shell modules meetings-ui consumes as a
// remote (specs/20261104-meetings). Module Federation resolves `shell/session` and
// `shell/tokens.css` at runtime through a virtual module tsc cannot see; the
// `dts` option is off in vite.config.ts so this remote builds without a live
// shell. Keep in sync by hand with shell/src/lib/session.ts.

declare module 'shell/session' {
  export interface ShellSessionUser {
    id?: string
    name?: string | null
    email?: string | null
    image?: string | null
  }

  export interface ShellSessionState {
    data: { user?: ShellSessionUser } | null
    isPending?: boolean
    error?: unknown
  }

  export const useSession: () => ShellSessionState
  export const apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

  // meetings-api for every call to this tool's backend; `auth` for the user
  // directory behind the participant picker (ADR 20261006-user-directory-endpoint-capability-gated, ADR 20261104-user-directory-gate-meetings-access).
  export const getMeetingsApiBaseUrl: () => string
  export const getAuthBaseUrl: () => string

  // Cross-remote navigation through the shell's one router (ADR 20260709-suite-frontend-module-federation).
  export const navigateSuite: (to: string) => void

  // Navigation blocker (AC-2.10, plan § Browser capture): while `shouldBlock()` is true an
  // in-app navigation asks for confirmation with `message`. Returns the unregister function.
  // A shell that predates this export does not provide it, so callers feature-detect.
  export const registerNavigationBlocker: (shouldBlock: () => boolean, message: string) => () => void

  // The floating slot (spec A13, ADR 20261110-shell-floating-slot-for-remote-widgets): the shell shows a named widget of a remote above every page until it
  // is closed. Props are plain strings. A shell that predates it does not provide them, so callers feature-detect.
  export const openFloating: (name: 'meetings.recorderDock', props: { meetingId: string; title: string }) => void
  export const closeFloating: (name: 'meetings.recorderDock') => void

  // Permission resolution (ADR 20260713-authz-hand-rolled-rbac-abac-epoch-claims), used for UX hints only (plan G5).
  export interface Permission {
    resource: string
    action: string
    conditions?: unknown
  }

  export interface PermissionsResult {
    epoch: number
    apps: string[]
    roles: string[]
    departments: string[]
    permissions: Permission[]
  }

  export const usePermissions: () => PermissionsResult
}

declare module 'shell/tokens.css' {
  // Side-effect-only CSS module (the shared Operai tokens) — no exports.
}
