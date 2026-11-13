import { Link } from '@tanstack/react-router'
import { TabNav, tabLinkClassName } from '@operai/ui'
import { strings } from '../strings'

// The left-anchored admin sections (Roles, Departments, Users). Audit is rendered separately,
// anchored to the FAR RIGHT (2026-07-21 UX change).
// `to` paths are relative to admin-ui's own inner router (see ../router.tsx)
// — TanStack Router prefixes them with the router's `basepath` (`/admin` when
// mounted as the federated remote, none in the standalone dev/test bootstrap)
// automatically, so this list never hardcodes `/admin`.
const SECTIONS = [
  { to: '/roles', label: strings.nav.roles },
  { to: '/departments', label: strings.nav.departments },
  { to: '/users', label: strings.nav.users },
] as const

// Audit — anchored to the far right of the nav (rendered via `ml-auto`), kept
// visually separate from the day-to-day management sections.
const AUDIT_SECTION = { to: '/audit', label: strings.nav.audit } as const

/**
 * SectionNav — admin-ui's section switcher (T14, specs/004-auth-roles-permissions,
 * design.md component inventory: "admin-ui secondary nav
 * (Roles/Departments/Users/Audit tabs) — NEW"). Mounted once by AdminShell
 * (../components/AdminShell.tsx), the inner router's root route component,
 * so it persists across every section while `<Outlet/>` swaps in
 * `../pages/*Page.tsx`.
 *
 * Accessibility (this task's explicit bar — "real `<a>`/`<nav>`, `aria-current`
 * on the active section — mirror the shell Sidebar's conventions"):
 *   - A real `<nav aria-label={strings.nav.sectionsLabel}>` landmark, distinct from the
 *     shell's own `<nav aria-label="Tool navigation">` (ShellLayout) that
 *     wraps the Sidebar tool-switcher one level up when admin-ui is mounted
 *     inside the shell — two differently-labelled nav landmarks for two
 *     different jobs (suite tool switcher vs. this tool's own section
 *     switcher) is correct, not a duplicate landmark.
 *   - Real `<a>`s via TanStack Router's `<Link>`, never a `<div>`/`<button>`
 *     pretending to be tab strip — same posture design.md calls out
 *     generally ("every new interactive element is a native
 *     `<button>`/`<select>`/`<input>`/`<a>`").
 *   - `aria-current="page"` on the active section comes from `<Link>` itself
 *     (its `STATIC_ACTIVE_PROPS`, applied whenever the link's `to` matches
 *     the current location) — the exact mechanism
 *     `shell/src/components/Sidebar.tsx`'s doc comment describes and this
 *     task asks to mirror; no manual `aria-current` bookkeeping here.
 *
 * Deliberately simpler than Sidebar: no icon-collapse mode and no
 * roving-tabindex. Sidebar's roving-tabindex machinery exists to support its
 * collapsible icon-only rail; this is a flat, always-expanded list of four
 * text labels, so plain native tab order is the correct, proportionate a11y
 * posture — adding Sidebar's extra keyboard handling here would solve a
 * problem this nav doesn't have.
 */
export default function SectionNav() {
  // Audit is pinned to the far right of the strip (TabNav's `end` slot).
  return (
    <TabNav
      label={strings.nav.sectionsLabel}
      end={
        <Link key={AUDIT_SECTION.to} to={AUDIT_SECTION.to} className={tabLinkClassName}>
          {AUDIT_SECTION.label}
        </Link>
      }
    >
      {SECTIONS.map((section) => (
        <Link key={section.to} to={section.to} className={tabLinkClassName}>
          {section.label}
        </Link>
      ))}
    </TabNav>
  )
}
