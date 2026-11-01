import type { IconName } from '@operai/ui'
import type { Activity, Release, ReleaseSummary } from '../types'
import { strings } from '../strings'

export type WarningCode = 'no-profile' | 'high-risk' | 'no-activities' | 'wide-range'

const COPY_KEY = {
  'no-profile': 'noProfile',
  'high-risk': 'highRisk',
  'no-activities': 'noActivities',
  'wide-range': 'wideRange',
} as const satisfies Record<WarningCode, keyof typeof strings.health.codes>

/**
 * How each warning looks (INC-31: a library `Icon`, never a Unicode glyph)
 * and what it says (strings.health.codes). `alert` + orange for the two that
 * signal uncertainty, `info` + soft for the two that point at missing data.
 */
const LOOK: Record<WarningCode, { icon: IconName; colorClass: string }> = {
  'no-profile': { icon: 'info', colorClass: 'text-soft' },
  'high-risk': { icon: 'alert', colorClass: 'text-org-text' },
  'no-activities': { icon: 'info', colorClass: 'text-soft' },
  'wide-range': { icon: 'alert', colorClass: 'text-org-text' },
}

export const WARNING_META: Record<
  WarningCode,
  { icon: IconName; colorClass: string; title: string; description: string }
> = Object.fromEntries(
  (Object.keys(LOOK) as WarningCode[]).map((code) => [code, { ...LOOK[code], ...strings.health.codes[COPY_KEY[code]] }]),
) as Record<WarningCode, { icon: IconName; colorClass: string; title: string; description: string }>

function pertCalc(o: number, ml: number, p: number): number {
  return ((Number(o) || 0) + 4 * (Number(ml) || 0) + (Number(p) || 0)) / 6
}

export interface HealthWarnings {
  /** warnings keyed by activity id */
  activityWarnings: Map<string, WarningCode[]>
  /** warnings keyed by release id */
  releaseWarnings: Map<string, WarningCode[]>
  activityCount: number
  releaseCount: number
  totalCount: number
}

export function computeHealthWarnings(
  activities: Activity[],
  releases: Release[],
  summary: ReleaseSummary[],
): HealthWarnings {
  const activityWarnings = new Map<string, WarningCode[]>()

  for (const a of activities) {
    const ws: WarningCode[] = []
    if (!a.prof) ws.push('no-profile')
    if (Number(a.risk) > pertCalc(a.o, a.ml, a.p)) ws.push('high-risk')
    if (ws.length) activityWarnings.set(a.id, ws)
  }

  const releaseWarnings = new Map<string, WarningCode[]>()

  for (const rel of releases) {
    const ws: WarningCode[] = []
    if (!activities.some((a) => a.release === rel.name)) ws.push('no-activities')
    const s = summary.find((r) => r.name === rel.name)
    if (s?.res && s.res.worst > 2 * s.res.best) ws.push('wide-range')
    if (ws.length) releaseWarnings.set(rel.id, ws)
  }

  const activityCount = [...activityWarnings.values()].reduce((n, ws) => n + ws.length, 0)
  const releaseCount = [...releaseWarnings.values()].reduce((n, ws) => n + ws.length, 0)

  return { activityWarnings, releaseWarnings, activityCount, releaseCount, totalCount: activityCount + releaseCount }
}
