/**
 * Fixture data for the Storybook pages and component stories: a fictional,
 * generic "Catalogue" tool whose records are "items". Nothing here belongs to
 * an app of the suite. Amounts are integer minor units (cents) and dates ISO
 * 8601, as an API returns them; stories format them for display.
 */

export type ItemStatus = 'draft' | 'available' | 'on-order' | 'needs-review' | 'archived'

export type Item = {
  id: string
  /** Human-readable code, shown in DM Mono. */
  code: string
  name: string
  category: string
  owner: string
  status: ItemStatus
  /** Integer cents. */
  priceCents: number
  currency: 'EUR' | 'CHF'
  /** ISO date of the last change. */
  updated: string
  /** ISO date from which the item can be ordered. */
  availableFrom: string
  description: string
}

export type HistoryEntry = {
  id: string
  /** ISO date-time. */
  at: string
  who: string
  what: string
}

export const CATEGORIES = ['Furniture', 'Lighting', 'Stationery', 'Textiles', 'Kitchen'] as const

export const OWNERS = ['Giulia Bianchi', 'Marco Rossi', 'Anna Keller', 'Luca Ferrari', 'Sara Meier'] as const

const NAMES = [
  'Oak desk lamp',
  'Linen cushion cover',
  'Walnut side table',
  'Ceramic pour-over set',
  'Dotted notebook A5',
  'Brass pendant light',
  'Wool throw blanket',
  'Folding beech chair',
  'Enamel bread bin',
  'Fountain pen, matte black',
  'Rattan floor lamp',
  'Cotton table runner',
  'Steel bookshelf',
  'Cast-iron skillet',
  'Recycled paper sketchbook',
  'Opal glass wall light',
  'Herringbone rug',
  'Stackable stool',
  'Bamboo cutting board',
  'Leather desk pad',
  'Paper lantern',
  'Waffle hand towel',
  'Pine shoe rack',
]

const STATUS_CYCLE: ItemStatus[] = [
  'available',
  'available',
  'on-order',
  'draft',
  'available',
  'needs-review',
  'archived',
]

const pad = (n: number, size = 2) => String(n).padStart(size, '0')

export const ITEMS: Item[] = NAMES.map((name, index) => {
  const day = 28 - index
  return {
    id: `item-${index + 1}`,
    code: `CAT-${pad(index + 101, 4)}`,
    name,
    category: CATEGORIES[index % CATEGORIES.length],
    owner: OWNERS[(index * 2) % OWNERS.length],
    status: STATUS_CYCLE[index % STATUS_CYCLE.length],
    priceCents: 1290 + ((index * 3779) % 48000),
    currency: index % 4 === 3 ? 'CHF' : 'EUR',
    updated: `2026-10-${pad(Math.max(day, 1))}`,
    availableFrom: `2026-${pad((index % 9) + 1)}-${pad((index % 27) + 1)}`,
    description: `${name}: part of the ${CATEGORIES[index % CATEGORIES.length].toLowerCase()} range, made in small batches.`,
  }
})

export const HISTORY: HistoryEntry[] = [
  { id: 'h1', at: '2026-10-28T09:14:00', who: 'Giulia Bianchi', what: 'Changed the price' },
  { id: 'h2', at: '2026-10-21T16:02:00', who: 'Marco Rossi', what: 'Moved to Lighting' },
  { id: 'h3', at: '2026-10-03T11:47:00', who: 'Anna Keller', what: 'Marked as available' },
  { id: 'h4', at: '2026-09-30T08:05:00', who: 'Anna Keller', what: 'Created the item' },
]

export const NOTES = [
  'Supplier confirmed a new batch for mid-November.',
  'Photos for the product page are still the prototype ones.',
]
