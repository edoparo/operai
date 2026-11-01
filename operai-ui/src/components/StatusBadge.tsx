import type { HTMLAttributes, ReactNode } from 'react'
import { Badge } from './Badge'
import type { BadgeTone } from './Badge'
import { Icon } from './Icon'
import type { IconName } from './Icon'

/**
 * The suite's status dictionary (INC-23). Every domain status (a request, an
 * asset, an invitation, a batch…) maps to ONE of these meanings, in one place
 * per app, and gets this tone and this icon. An icon therefore means the same
 * thing in every tool: before, `◆` was "paid" in Rimborsi and "in stock" in
 * Inventory, `✕` both "rejected" and "discarded".
 */
export const STATUS = {
  /** Not submitted or not started yet: a draft request. */
  draft: { tone: 'neutral', icon: 'pencil' },
  /** Waiting for someone else: submitted, pending invitation, ordered, compiled batch. */
  pending: { tone: 'accent', icon: 'clock' },
  /** Accepted and in effect: approved, accepted, assigned, rate in effect. */
  active: { tone: 'success', icon: 'check' },
  /** Finished for good: paid, receipt confirmed, year closed. */
  settled: { tone: 'success', icon: 'check-circle' },
  /** Kept, not in use: in stock. */
  stored: { tone: 'neutral', icon: 'box' },
  /** Needs someone's attention but nothing failed: in repair. */
  attention: { tone: 'warning', icon: 'wrench' },
  /** Ended badly: rejected, declined, failed. */
  failed: { tone: 'danger', icon: 'x-circle' },
  /** Missing: lost or stolen. */
  missing: { tone: 'danger', icon: 'help' },
  /** No longer counts: discarded, cancelled, revoked, expired, disposed. */
  voided: { tone: 'muted', icon: 'ban' },
  /** A neutral fact worth a badge: a role is a system role. */
  info: { tone: 'accent', icon: 'info' },
} as const satisfies Record<string, { tone: BadgeTone; icon: IconName }>

export type StatusMeaning = keyof typeof STATUS

export type StatusBadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  status: StatusMeaning
  /** The domain label ("Awaiting decision", "In repair"). The icon is decorative. */
  children: ReactNode
}

/**
 * StatusBadge — a `Badge` whose tone and icon come from the status dictionary.
 * An app maps its domain value to a meaning once (`approved → 'active'`) and
 * passes its own label.
 */
export function StatusBadge({ status, children, ...rest }: StatusBadgeProps) {
  const { tone, icon } = STATUS[status]
  return (
    <Badge tone={tone} glyph={<Icon name={icon} />} {...rest}>
      {children}
    </Badge>
  )
}
