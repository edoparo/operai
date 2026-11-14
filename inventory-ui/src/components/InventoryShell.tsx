import { Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { StatePanel, TabNav, ToolLayout, VisuallyHidden, tabLinkClassName } from '@operai/ui'
import { useInventoryCapabilities } from '../hooks/useInventoryCapabilities'
import { useScope } from '../hooks/useScope'
import { ApiError } from '../lib/api'
import { strings } from '../strings'
import ErrorBanner from './ErrorBanner'
import PermissionDenied from './PermissionDenied'
import SkeletonListRows from './SkeletonListRows'

/**
 * InventoryShell — inventory-ui's root layout (T28, specs/015-hardware-
 * inventory; design.md § T0 InventoryShell), passed to `createAppRouter` by
 * App.tsx as the router's root route component. Re-authored from refund-ui's
 * RefundShell: an h1, a labelled tab nav and the routed `<Outlet/>` — no suite
 * chrome (the shell owns it, ADR 20260709-suite-frontend-module-federation) and no auth guard.
 *
 * Capability gating (AC-9.1, 9.3, 9.4, 9.6; UX only — the server's 403 is the
 * gate, AC-9.7). A tab the caller lacks the capability for is ABSENT from the
 * DOM, never disabled:
 *   - Assets: `asset:manage` or `ledger:manage` (the accountant reads assets);
 *   - Depreciation rules, Fiscal years: `ledger:manage`.
 * A deep link to a route the caller has no capability for renders
 * `PermissionDenied` in place of the page, so the tool's content never shows.
 *
 * Scope (plan.md `GET /scope`, design Resolutions G1/G11): once a route is
 * allowed, `useScope` loads the entities each capability covers and the layout
 * renders, in place of the page,
 *   - a skeleton with a polite "Loading inventory…" line while it loads;
 *   - `ErrorBanner` with Retry on failure — the 503 "authorization service
 *     unavailable" variant for a fail-closed `auth` outage (ADR 20260716-refund-api-authorization-enforcing-resource-server);
 *   - "No entity in your scope" when both lists are empty (a user with tool
 *     access whose grants are entity-conditioned with no entity). Plain page
 *     text, distinct from an empty list: nothing is wrong with the list.
 * The heading and tabs stay on screen in every state.
 *
 * Layout from @operai/ui (ADR 20261031-shared-ui-library-consumed-as-source, INC-12): `ToolLayout` (tool title h1 +
 * tabs + the page column — a <div>, not a second <main>: the shell owns the
 * page's one main landmark) and `TabNav`. TanStack Router's <Link> sets
 * `aria-current="page"` on the active tab; the library's `.tab-link` styles it.
 */

const messageForScopeError = (error: unknown): string => {
  if (error instanceof ApiError) return error.detail ?? strings.errors.unknown
  return strings.errors.network
}

export default function InventoryShell() {
  const { canManageAssets, canManageLedger } = useInventoryCapabilities()
  const matchRoute = useMatchRoute()

  const canReadAssets = canManageAssets || canManageLedger
  const onLedgerRoute = Boolean(matchRoute({ to: '/rules' })) || Boolean(matchRoute({ to: '/years', fuzzy: true }))
  const allowed = onLedgerRoute ? canManageLedger : canReadAssets

  const scope = useScope(allowed)

  const scopeStatus = scope.error instanceof ApiError ? scope.error.status : null

  let content: ReactNode
  if (!allowed || scopeStatus === 403) {
    content = <PermissionDenied />
  } else if (scope.status === 'error') {
    content =
      scopeStatus === 503 ? (
        <ErrorBanner variant="authUnavailable" onRetry={scope.retry} />
      ) : (
        <ErrorBanner message={messageForScopeError(scope.error)} onRetry={scope.retry} />
      )
  } else if (scope.status !== 'ready') {
    content = (
      <div>
        <VisuallyHidden live role="status">
          {strings.nav.loading}
        </VisuallyHidden>
        <SkeletonListRows />
      </div>
    )
  } else if (scope.isEmpty) {
    content = (
      <section aria-labelledby="inventory-scope-empty-heading" data-testid="inventory-scope-empty">
        <StatePanel headingLevel={2} titleId="inventory-scope-empty-heading" title={strings.nav.scopeEmpty.heading}>
          {strings.nav.scopeEmpty.body}
        </StatePanel>
      </section>
    )
  } else {
    content = <Outlet />
  }

  return (
    <ToolLayout
      title={strings.nav.heading}
      nav={
        <TabNav label={strings.nav.landmarkLabel}>
          {canReadAssets && (
            <Link to="/assets" className={tabLinkClassName}>
              {strings.nav.assets}
            </Link>
          )}
          {canManageLedger && (
            <Link to="/rules" className={tabLinkClassName}>
              {strings.nav.rules}
            </Link>
          )}
          {canManageLedger && (
            <Link to="/years" className={tabLinkClassName}>
              {strings.nav.years}
            </Link>
          )}
        </TabNav>
      }
    >
      {content}
    </ToolLayout>
  )
}
