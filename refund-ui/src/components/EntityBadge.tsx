/**
 * EntityBadge — the legal entity an expense line belongs to (specs/007).
 * Shows the entity only; `CurrencyBadge` renders the currency, which is an
 * independent field on each line. Neutral for both entities: an entity is
 * metadata, and green on a row is left to mean "approved" alone.
 */

import { Badge } from '@operai/ui'
import { strings } from '../strings'

export type Entity = 'welld_it' | 'welld_ch'

export type EntityBadgeProps = {
  entity: Entity
}

/**
 * Neutral metadata: the entity name alone (INC-23). The flag emoji it used to
 * carry did not render on Windows (two letters instead of a flag), and the
 * name was always what told the entities apart.
 */
export default function EntityBadge({ entity }: EntityBadgeProps) {
  return <Badge data-testid="entity-badge">{strings.badges.entity[entity]}</Badge>
}
