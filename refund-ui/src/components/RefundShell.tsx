import { Link, Outlet } from '@tanstack/react-router'
import { TabNav, ToolLayout, tabLinkClassName } from '@operai/ui'
import { usePermissions } from 'shell/session'
import { strings } from '../strings'

/**
 * RefundShell — refund-ui's own root layout (T14,
 * specs/007-refund-service/tasks.md: "RefundShell root layout: heading + a
 * two-item nav … + <Outlet/>, mirroring AdminShell"), wired as the inner
 * router's root route component (see ../router.tsx's
 * `createRootRoute({ component: RefundShell })`).
 *
 * Mirrors `admin-ui/src/components/AdminShell.tsx` exactly: a heading
 * identifying the tool, a small nav (here: "My requests" | "Review queue" |
 * "Monthly processing" — design.md's `RefundShell` spec), and the
 * `<Outlet/>` the routes (../pages/*.tsx) render into. No suite chrome
 * duplicated here (Header/UserMenu/bell/ThemeToggle, sign-out, …) — per
 * ADR-0006 and design.md's own `RefundShell` note ("No suite chrome
 * duplicated … that already wraps refund-ui from the shell"), that chrome
 * already exists once in the shell. No auth guard either — the shell's own
 * `_authed` guard already runs before refund-ui is ever mounted (same
 * rationale as AdminShell/estimai-ui's router).
 *
 * The "Review queue" and "Monthly processing" links are rendered only when
 * the signed-in user actually holds a `request:review` grant. The doc
 * comment this replaces claimed refund-ui had "no cheap way to know the
 * caller's permissions client-side" (design.md's Gap #7) — that premise is
 * now OUTDATED: the shell already resolves the caller's full effective
 * permission set (ADR-0007's `GET /authz/me`) and exposes it to every remote
 * via `shell/session`'s `usePermissions()` (the exact same seam the shell's
 * own `Sidebar` uses to filter its tool list). `canReview` below is true for
 * ANY `request:review` grant, conditioned or not — entity-scoping (ADR-0015)
 * is enforced server-side per-request, so mere presence of the capability is
 * enough to decide whether the tab is worth showing at all. Before the
 * initial `/authz/me` fetch settles, `usePermissions()` synchronously returns
 * `EMPTY_PERMISSIONS` (`permissions: []`), so both tabs are briefly hidden
 * and then appear once resolved — the same "narrows down, never flashes
 * unfiltered" behavior as the shell's `Sidebar`. "My requests" is always
 * visible — every user with refund app access can create/list their own
 * requests regardless of `request:review`.
 *
 * This client-side hide is UX-only defense-in-depth, NOT the real gate: the
 * server-side 403 (refund-api's `authzMiddleware`, ADR-0014) and the
 * `PermissionDenied` screens on A1 (Review queue) / B1 (Monthly processing)
 * remain the actual enforcement — a deep link typed/followed by a
 * non-accounting user still lands on `PermissionDenied`, exactly as before.
 * Do not remove that handling on the strength of this nav change.
  *
 * Layout from @operai/ui (ADR-0050): `ToolLayout` (tool title + tabs + the
 * page column — a <div>, not a second <main>: the shell's layout owns the
 * page's one main landmark) and `TabNav`. TanStack Router's <Link> sets
 * `aria-current="page"` on the active tab; the library's `.tab-link` styles
 * it, so no activeProps are needed.
 */

export default function RefundShell() {
  const { permissions } = usePermissions()
  const canReview = permissions.some(
    (permission) => permission.resource === 'request' && permission.action === 'review',
  )

  return (
    <ToolLayout
      title={strings.appTitle}
      nav={
        <TabNav label={strings.nav.landmarkLabel}>
          <Link to="/requests" className={tabLinkClassName}>
            {strings.nav.myRequests}
          </Link>
          {canReview && (
            <Link to="/review" className={tabLinkClassName}>
              {strings.nav.reviewQueue}
            </Link>
          )}
          {canReview && (
            <Link to="/batches" className={tabLinkClassName}>
              {strings.nav.monthlyProcessing}
            </Link>
          )}
        </TabNav>
      }
    >
      <Outlet />
    </ToolLayout>
  )
}
