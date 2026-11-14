/**
 * AccountScreen — shell route `/account` ("My profile" in UserMenu), the
 * employee self-view (specs/20260803-employee-address, T14, US-6,
 * AC-6.1/AC-6.2/AC-6.3/AC-6.4; design.md "F6 — Employee views their own
 * address, read-only" / "`AccountScreen` — shell route `/account`"; ADR 20260804-shell-identity-scoped-non-tool-screens-account-route).
 *
 * Mirrors `NoAccessScreen.tsx` structurally (a small, shell-local, zero-
 * dependency screen component) and is built entirely from reused parts:
 *   - the page frame and states from `@operai/ui` (ADR 20261031-shared-ui-library-consumed-as-source): `ToolLayout`
 *     (narrow) + `PageHeader`, `SkeletonRows` with a polite `VisuallyHidden`
 *     line while loading, a `warning` `Banner` (role="alert") with its
 *     `type="button"` Retry on failure;
 *   - the read-only VALUE-DISPLAY register of `admin-ui/src/pages/
 *     UserDetail.tsx`'s Identity block (a plain-text value, no input) —
 *     ported as a styling convention across the federation boundary (that
 *     file lives in a different remote and uses a different, inline-style
 *     CSS-variable convention; this component expresses the same register
 *     using shell's own Tailwind token classes, see `styles/tokens.css`).
 *
 * **AC-6.2 — read-only guarantee, a literal DOM constraint, not a
 * suggestion.** The address is read-only; the screen as a whole is not any more: since
 * specs/20261111-push-notifications it also holds the "Push notifications" section (`PushSettings`, with buttons),
 * which is a sibling of the address section and sits OUTSIDE the region below. Everything the
 * ADDRESS section can render lives inside the single
 * `data-testid="account-address-region"` container below, in EVERY state
 * (loading / error / empty / populated) — the plan's own AC-6.2 test queries
 * exactly that region for `input, textarea, select, [contenteditable],
 * button[type="submit"]` and any `role="listbox"`/`role="combobox"` element,
 * and must find none. There is no such element anywhere in this file: the
 * Banner's Retry button is the library `Button`, `type="button"` (never the default
 * `"submit"`), and nothing here is a `<input>`/`<select>`/`<textarea>` — a
 * *disabled* input would still trip that query, so this component doesn't
 * render one at all, not even disabled.
 *
 * **Fetch failure vs. "no address on file" — two distinct states, never
 * conflated.** `getMyAddress()` (./lib/profileApi) resolves to `null` for a
 * genuine, informative "no address on file" and THROWS for anything else (a
 * non-2xx response, a network failure). This component renders a distinct
 * `role="alert"` error+retry state for the latter — collapsing the two would
 * tell an employee something false about their own personal data (design.md
 * F6 step 4).
 *
 * i18n (INC-24/25): copy comes from the shell strings module (`strings.account`);
 * the language is resolved once for the suite by the library, so this screen
 * no longer runs its own `navigator.language` check.
 *
 * States (INC-22/33): loading is the library `SkeletonRows` with a polite
 * `VisuallyHidden` line; the address is a `Card`; "no address on file" is a
 * `StatePanel` (title + body) — still not an error, which stays a `Banner`.
 */

import { useEffect, useState } from 'react'
import { Banner, Card, PageHeader, SkeletonRows, StatePanel, ToolLayout, VisuallyHidden } from '@operai/ui'
import { getMyAddress, type AddressView } from '../lib/profileApi'
import { PushSettings } from './PushSettings'
import { strings } from '../strings'

type AccountState = { status: 'loading' } | { status: 'error' } | { status: 'loaded'; address: AddressView | null }

export function AccountScreen() {
  const [state, setState] = useState<AccountState>({ status: 'loading' })
  // Bumped by Retry to re-run the effect below. Kept separate from `state`
  // deliberately: see the effect's doc comment for why Retry doesn't call an
  // async fetch function directly.
  const [reloadToken, setReloadToken] = useState(0)

  // Fetches the caller's address on mount and whenever `reloadToken` changes
  // (Retry). Built as an explicit Promise chain rather than an async/await
  // helper invoked from the effect — mirrors admin-ui's AuditPage.tsx (same
  // gotcha, same fix): an async function that calls a state setter anywhere
  // in its body (even after an `await`) reads, to
  // `react-hooks/set-state-in-effect`'s static analysis, as "this effect
  // calls setState directly" — the very pattern the rule polices — because
  // await-continuations stay within the same function body. Routing each
  // setState call through its own `.then()`/`.catch()` closure keeps the
  // state transition genuinely decoupled from the effect's own body, while
  // the runtime behavior (set loading, fetch, then set loaded/error,
  // ignoring a stale response after unmount/retry) is unchanged from the
  // equivalent async/await version.
  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => {
        if (!cancelled) setState({ status: 'loading' })
      })
      .then(() => getMyAddress())
      .then((address) => {
        if (!cancelled) setState({ status: 'loaded', address })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const retry = () => setReloadToken((current) => current + 1)

  // The page frame (INC-12): ToolLayout `narrow` (a single profile) owns the
  // h1 ("My profile", the UserMenu entry that leads here); the address section
  // is the PageHeader's h2.
  return (
    <ToolLayout title={strings.account.title} width="narrow" testId="account-screen">
      <section aria-labelledby="account-address-heading">
        <PageHeader title={strings.account.address} titleId="account-address-heading" />

        {/* AC-6.2 — every state this screen can render lives inside this one
            region; none of them contain an interactive element (see module doc). */}
        <div data-testid="account-address-region">
          {state.status === 'loading' && (
            <div data-testid="account-loading">
              <VisuallyHidden live>{strings.account.loading}</VisuallyHidden>
              <SkeletonRows rows={1} actions={0} />
            </div>
          )}

          {state.status === 'error' && (
            <Banner tone="warning" data-testid="account-error" onRetry={retry} retryLabel={strings.account.retry}>
              {strings.account.error}
            </Banner>
          )}

          {state.status === 'loaded' &&
            (state.address ? (
              <Card>
                <p className="text-sm text-text" data-testid="account-address-formatted">
                  {state.address.formatted}
                </p>
                <p className="mt-3 text-xs text-muted">{strings.account.contactAdmin}</p>
              </Card>
            ) : (
              <StatePanel title={strings.account.none} testId="account-address-empty">
                {strings.account.contactAdmin}
              </StatePanel>
            ))}
        </div>
      </section>

      {/* specs/20261111-push-notifications: a SIBLING section, deliberately outside the address region - it holds buttons,
          and that region may not (AC-6.2 above). */}
      <PushSettings />
    </ToolLayout>
  )
}

export default AccountScreen
