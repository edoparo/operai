/** Where a company or a lead came from (specs/20261101-crm US-7): what a form sends and how it reads. */
import { strings } from '../strings'
import { hasSourceDetail } from './types'
import type { LeadSource } from './types'

/** Longest detail the server keeps. */
export const MAX_SOURCE_DETAIL = 200

/** What a draft sends: no detail without a source that takes one. */
export function sourceInput(source: LeadSource | '', detail: string) {
  const trimmed = detail.trim()
  return {
    source: source === '' ? null : source,
    sourceDetail: hasSourceDetail(source) && trimmed !== '' ? trimmed : null,
  }
}

/** "Event · Swiss Digital Day 2026", or null when the source is not known. */
export function sourceSummary(source: LeadSource | null | undefined, detail: string | null | undefined): string | null {
  return source ? strings.source.summary(strings.source.value[source], detail ?? null) : null
}

/**
 * The key two spellings of the same detail share — no case, no accents, single
 * spaces. Mirrors crm-api's `foldDetail`, which groups the suggestions.
 */
export const foldDetail = (value: string): string =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Most suggestions the detail field shows at once. */
export const MAX_DETAIL_SUGGESTIONS = 8

/**
 * The suggestions for what is typed: those containing it (folded), most used
 * first. Nothing when the text already IS one of them, so a finished value
 * leaves no popup behind; a different spelling of one still offers it.
 */
export function matchDetails(items: readonly { value: string }[], typed: string): string[] {
  const key = foldDetail(typed)
  if (items.some((item) => item.value === typed.trim().replace(/\s+/g, ' '))) return []
  return items
    .filter((item) => foldDetail(item.value).includes(key))
    .slice(0, MAX_DETAIL_SUGGESTIONS)
    .map((item) => item.value)
}
