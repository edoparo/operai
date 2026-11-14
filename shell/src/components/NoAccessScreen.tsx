/**
 * NoAccessScreen — Screen S1, the shell's `/no-access` empty state
 * (specs/20260713-auth-roles-permissions, T25, design.md "Screen S1 — Shell
 * `/no-access`", AC-7.4).
 *
 * Rendered by the `/no-access` route (src/router.tsx) inside the shell's
 * existing `<main>` — it is ordinary content, not a new landmark (design.md:
 * "no new landmark"). Reached in two ways:
 *   - the root `/` redirect resolves here directly when the signed-in user's
 *     `apps` is empty (nothing to redirect to, AC-7.4);
 *   - a tool route's access guard (src/router.tsx's per-tool `beforeLoad`)
 *     redirects here when the user has zero granted apps at all (AC-7.3).
 *
 * The surrounding chrome (Header/Sidebar/Footer, rendered by the parent
 * `_shell` layout route) stays fully mounted and interactive — sign-out,
 * the About dialog, and the theme toggle all keep working from here
 * (design.md Flow F8 step 2).
 *
 * A11y (design.md "Accessibility → Permission-denied / no-access states"):
 * the heading receives programmatic focus on mount — same technique
 * ShellLayout already uses for its skip-link target (`tabIndex={-1}` +
 * `ref.current?.focus()`) — so assistive tech announces the state
 * immediately instead of requiring the user to explore the page to discover
 * why nothing loaded. There is nothing to visually load here (no fetch, no
 * loading state) — the empty state is the direct, synchronous result of the
 * route's `beforeLoad`/render, so no separate loading treatment is needed.
 */
import { StatePanel } from '@operai/ui'
import { strings } from '../strings'

export function NoAccessScreen() {
  return (
    // h1: a standalone screen with no ToolLayout around it (e2e selects the heading at level 1).
    <StatePanel title={strings.noAccess.title} headingLevel={1} focusOnMount testId="no-access-screen">
      {strings.noAccess.body}
    </StatePanel>
  )
}

export default NoAccessScreen
