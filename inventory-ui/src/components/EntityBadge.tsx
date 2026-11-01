/**
 * EntityBadge — the wellD legal-entity chip (T25, specs/015-hardware-inventory;
 * INC-23). A neutral `Badge` from @operai/ui with the entity's name: an entity
 * is metadata, not a status, so it never borrows a semantic tone. No flag
 * emoji: flags do not render on Windows, and the name already says it.
 */

import { Badge } from '@operai/ui'
import { strings } from '../strings'
import type { Entity } from '../lib/types'

export type EntityBadgeProps = {
  entity: Entity
}

export default function EntityBadge({ entity }: EntityBadgeProps) {
  return <Badge data-testid="entity-badge">{strings.common.entity[entity]}</Badge>
}
