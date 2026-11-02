import { strings } from '../strings'
import type { PersonRef } from './types'

/** How a person reference reads (ADR-0039): the live name, or what is known about the account. */
export function personName(person: PersonRef | null, currentUserId: string | null = null): string {
  if (person === null) return strings.common.none
  if (person.status === 'system') return strings.people.system
  if (person.status === 'deleted') return strings.people.deleted
  if (person.status === 'unknown') return strings.people.unknown
  const name = person.name ?? strings.people.picker.noName
  return person.id === currentUserId ? `${name} (${strings.people.you})` : name
}

export const contactName = (contact: { firstName: string; lastName: string }): string =>
  `${contact.firstName} ${contact.lastName}`.trim()
