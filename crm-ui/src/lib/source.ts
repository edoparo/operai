/** Where a company or a lead came from (specs/017 US-7): what a form sends and how it reads. */
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
