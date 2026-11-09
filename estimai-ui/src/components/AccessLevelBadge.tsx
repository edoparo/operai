/**
 * AccessLevelBadge — a collaborator's access level on a shared estimate (T14,
 * specs/013-estimate-sharing/tasks.md), reused by the collaborators dialog
 * (owner and member modes) and the estimates list's shared rows.
 *
 * An access level is a role, not a status (INC-23), so it is the library
 * `Badge`, not a `StatusBadge`: Editor is `accent` with the edit icon (pen on a page — `pencil` is the draft status),
 * Viewer `neutral` with the eye. The icon is decorative (aria-hidden); the
 * visible label carries the accessible name, so colour is never the only
 * signal.
 */

import { Badge, Icon } from '@operai/ui'
import type { BadgeTone, IconName } from '@operai/ui'
import { strings } from '../strings'

/** A collaborator's grant level — the only two a collaborator row can hold. */
export type AccessLevel = 'viewer' | 'editor'

/**
 * What the badge can show: a grant level, or `oversight` (specs/024) — a right
 * that comes from `estimate:read-all`, not from a share. It is a wire value only,
 * never a grant, so it is NOT part of `AccessLevel`.
 */
export type AccessBadgeLevel = AccessLevel | 'oversight'

const CONFIG: Record<AccessBadgeLevel, { icon: IconName; tone: BadgeTone; label: string }> = {
  editor: { icon: 'edit', tone: 'accent', label: strings.sharing.dialog.levelEditor },
  viewer: { icon: 'eye', tone: 'neutral', label: strings.sharing.dialog.levelViewer },
  // Same glyph as Viewer on purpose; the label text tells them apart.
  oversight: { icon: 'eye', tone: 'neutral', label: strings.sharing.dialog.levelOversight },
}

export type AccessLevelBadgeProps = {
  level: AccessBadgeLevel
}

export default function AccessLevelBadge({ level }: AccessLevelBadgeProps) {
  const { icon, tone, label } = CONFIG[level]
  return (
    <Badge tone={tone} glyph={<Icon name={icon} />} data-testid="access-level-badge">
      {label}
    </Badge>
  )
}
