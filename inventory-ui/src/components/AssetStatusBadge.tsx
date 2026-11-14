import { Badge, StatusBadge } from '@operai/ui'
import { ASSET_STATUS_MEANING } from '../lib/statusMeanings'
import { strings } from '../strings'
import type { AssetStatus } from '../lib/types'

/**
 * AssetStatusBadge — the asset lifecycle chip (T26, specs/20261006-hardware-
 * inventory; INC-23). A `StatusBadge` from @operai/ui: the status maps to one
 * meaning of the suite's dictionary (`ASSET_STATUS_MEANING`, lib/statusMeanings),
 * which fixes the tone and the icon, and the label comes from
 * `strings.badges.assetStatus`. Status is never carried by colour alone: icon
 * (aria-hidden) + label, and the label is the accessible name. Contrast of the
 * library's badge tones is measured in a11y.test.tsx from the real tokens.
 *
 * A status a newer server adds (outside the six) renders as its raw value in a
 * neutral badge with no icon rather than throwing, so a deploy skew never
 * blanks a list.
 */

export type AssetStatusBadgeProps = {
  status: AssetStatus
}

export default function AssetStatusBadge({ status }: AssetStatusBadgeProps) {
  const meaning = (ASSET_STATUS_MEANING as Partial<Record<string, (typeof ASSET_STATUS_MEANING)[AssetStatus]>>)[status]
  const label = (strings.badges.assetStatus as Partial<Record<string, string>>)[status] ?? status

  if (meaning === undefined) {
    return (
      <Badge data-testid="asset-status-badge" data-status={status}>
        {label}
      </Badge>
    )
  }
  return (
    <StatusBadge status={meaning} data-testid="asset-status-badge" data-status={status}>
      {label}
    </StatusBadge>
  )
}
