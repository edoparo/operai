/**
 * The estimates list's Owner filter (specs/20261108-estimate-list-oversight US-4).
 *
 * The API never puts an owner's id on the wire (specs/20260807-estimate-sharing "Display identity"),
 * and the list is unpaginated, so the filter is applied to the loaded rows and matches on what a
 * row shows as its owner: `OWNER_ME` for the caller's own estimates, otherwise the owner's display
 * name through `formatIdentity` (so every former member shares the "Former wellD member" entry and
 * every unresolved one the "Unknown wellD member" entry). Two people with the same name share one
 * entry — the same thing the rows already show.
 */
import type { EstimateIdentity, EstimateListItem } from './estimatesApi'
import { formatIdentity } from './identity'

export const OWNER_ME = 'me'

/** A shared row whose `owner` came back `null` despite the contract renders as unknown (AC-10.5). */
const UNKNOWN_OWNER: EstimateIdentity = { status: 'unknown', name: null }

/** The owner identity of a row that is not the caller's own, never `null`. */
export const ownerIdentityOf = (item: EstimateListItem): EstimateIdentity => item.owner ?? UNKNOWN_OWNER

/** What the Owner filter matches a row on. */
export const ownerKeyOf = (item: EstimateListItem): string =>
  item.access === 'owner' ? OWNER_ME : formatIdentity(ownerIdentityOf(item))

export type OwnerOption = { value: string; isMe: boolean }

/**
 * The owners of the loaded rows: the caller first, then the others by name. A chosen owner that no
 * loaded row has (another status, a deleted estimate) stays an option, so the select shows it.
 */
export const ownerOptions = (items: EstimateListItem[], selected: string | null): OwnerOption[] => {
  const keys = new Set(items.map(ownerKeyOf))
  if (selected !== null) keys.add(selected)
  const others = [...keys].filter((key) => key !== OWNER_ME).sort((a, b) => a.localeCompare(b))
  return [
    ...(keys.has(OWNER_ME) ? [{ value: OWNER_ME, isMe: true }] : []),
    ...others.map((value) => ({ value, isMe: false })),
  ]
}

export const byOwner = (items: EstimateListItem[], owner: string | null): EstimateListItem[] =>
  owner === null ? items : items.filter((item) => ownerKeyOf(item) === owner)
