/**
 * Bell — shell header notification-bell button (T11, specs/20260713-notification-center,
 * plan.md "Shell changes" item 1, design.md "Bell (shell header chrome)").
 *
 * Placed in Header.tsx beside ThemeToggle (design.md's chrome layout:
 * "[ThemeToggle] [Bell] [UserMenu]" — grouping the two small icon-buttons together,
 * the avatar/identity control last).
 *
 * Rendered as a real `<Link to="/notify">` (navigation), not a `<button onClick={…}>`
 * imperative navigate — design.md's Accessibility section is explicit that this is NOT a
 * disclosure widget (no `aria-expanded`/`aria-haspopup`; see design.md's "panel-vs-page
 * decision": there is no bell-anchored popover in this feature, only a route). This
 * mirrors Sidebar.tsx's "always a real anchor for navigation" convention.
 *
 * The `/notify` route itself is registered later (T13, `shell/src/router.tsx`) — out of
 * this task's touch-list. `NOTIFY_PATH` is deliberately typed as a plain `string` (not
 * inlined as the JSX literal `"/notify"`) so TanStack Router's registered-route-literal
 * check — which only kicks in when the `to` value's STATIC type is itself a literal —
 * doesn't reject a path this router doesn't know about yet. `lib/tools.ts`'s
 * `SuiteTool.to: string` (consumed by Sidebar.tsx's `<Link to={tool.to}>`) already
 * relies on the exact same widening; this isn't a new escape hatch, and nothing here
 * needs to change once T13 registers the route.
 *
 * Unread count: `useUnreadCount()` (shell/src/lib/notifications.ts, T10) — SSE-driven,
 * REST-seeded, shared across the whole tab. Two independent surfaces reflect it
 * (design.md Accessibility → "Bell"):
 *   - the visual badge: exact digit for 1–9, "9+" at 10 or more (AC-1.6), no badge
 *     element at all at 0 (AC-1.3 — not a badge showing "0", literally absent from the
 *     DOM). Its digit content is `aria-hidden` — decorative for sighted users only.
 *   - a `sr-only aria-live="polite"` region, kept mounted at all times and placed NEXT
 *     TO (a sibling of, not inside) the link, so unread-count CHANGES are announced
 *     without ever touching the link's own accessible name. The name stays a static
 *     "Notifications" on every render — deliberately not "Notifications (3)" — so it
 *     doesn't churn on every SSE push (design.md: "confuse repeated-visit navigation").
 */
import { Link } from '@tanstack/react-router'
import { Icon, buttonClassName } from '@operai/ui'
import { useUnreadCount } from '../lib/notifications'
import { strings } from '../strings'

// See file doc above: widened to `string` on purpose, not the literal "/notify".
const NOTIFY_PATH: string = '/notify'

const MAX_DISPLAYED_COUNT = 9

/** "1".."9" exact, "9+" at 10 or more (AC-1.6); `null` at 0 → no badge at all (AC-1.3). */
function formatBadgeCount(count: number): string | null {
  if (count <= 0) {
    return null
  }
  return count > MAX_DISPLAYED_COUNT ? `${MAX_DISPLAYED_COUNT}+` : String(count)
}

/** The aria-live announcement text; empty at 0 (design.md: "removed entirely at 0"). */
function formatUnreadAnnouncement(count: number): string {
  if (count <= 0) {
    return ''
  }
  return strings.bell.unread(count)
}

export default function Bell() {
  const unreadCount = useUnreadCount()
  const badgeCount = formatBadgeCount(unreadCount)

  return (
    <>
      <Link
        to={NOTIFY_PATH}
        aria-label={strings.bell.label}
        // Same shape as the ThemeToggle beside it (a secondary icon-only
        // `.btn`): a navigation link that sits in the header's control row.
        className={buttonClassName({ variant: 'secondary', iconOnly: true, className: 'relative shrink-0' })}
      >
        {/* The library bell (INC-31); decorative — the link's aria-label names it. */}
        <Icon name="bell" size={16} />
        {badgeCount !== null && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-acc-solid px-1 text-2xs font-mono font-bold leading-none text-white transition-all duration-150 motion-reduce:transition-none"
          >
            {badgeCount}
          </span>
        )}
      </Link>
      {/* Separate from the link's own name (see file doc) — always mounted so the
          live region reliably picks up subsequent text changes across browsers. */}
      <span className="sr-only" aria-live="polite">
        {formatUnreadAnnouncement(unreadCount)}
      </span>
    </>
  )
}
