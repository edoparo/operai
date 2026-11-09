/**
 * DealBadge — marks an estimate that belongs to a CRM deal (specs/024 US-3).
 *
 * EstimAI knows only that a deal exists and its id (AC-3.3), so the badge never
 * shows a title, company or amount. With `(crm, access)` it is a real link to
 * the deal (middle-click and copy-link keep working; a plain left click goes
 * through the shell's client-side `navigateSuite`); without it, a plain badge.
 */

import type { MouseEvent } from 'react'
import { Badge, VisuallyHidden } from '@operai/ui'
import { navigateSuite } from 'shell/session'
import { strings } from '../strings'

const t = strings.estimatesList.deal

export type DealBadgeProps = {
  dealId: string
  /** The estimate's display name — makes the link's accessible name unique per row. */
  estimateName: string
  /** The viewer holds `(crm, access)`. */
  canOpen: boolean
}

export default function DealBadge({ dealId, estimateName, canOpen }: DealBadgeProps) {
  if (!canOpen) {
    return (
      <Badge tone="accent" data-testid="deal-badge">
        {t.label}
        <VisuallyHidden>{t.plainHidden}</VisuallyHidden>
      </Badge>
    )
  }

  const href = `/crm/deals/${encodeURIComponent(dealId)}`
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Let the browser handle new-tab / new-window gestures.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    navigateSuite(href)
  }

  return (
    <a
      href={href}
      onClick={onClick}
      aria-label={t.linkName(estimateName)}
      className="no-underline hover:underline"
      data-testid="deal-badge-link"
    >
      <Badge tone="accent" data-testid="deal-badge">
        {t.label}
      </Badge>
    </a>
  )
}
