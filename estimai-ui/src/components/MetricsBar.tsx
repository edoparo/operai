import type { Totals } from '../types'
import { strings } from '../strings'
import { decimal, whole } from '../lib/figures'

interface MetricProps {
  label: string
  val: string
  sub?: string
  colorClass: string
}

function Metric({ label, val, sub, colorClass }: MetricProps) {
  return (
    <div className="bg-ink-soft border border-rule rounded-[10px] py-[13px] px-4 flex-1 min-w-[120px]">
      <div className="text-2xs text-soft font-mono tracking-[0.06em] uppercase mb-[5px]">{label}</div>
      <div className={`font-mono text-xl font-medium leading-none ${colorClass}`}>{val}</div>
      {sub && <div className="text-2xs text-soft mt-1">{sub}</div>}
    </div>
  )
}

interface MetricsBarProps {
  totals: Totals
  activityCount: number
  releaseCount: number
  profileCount: number
}

/** The estimate's KPI strip. Figures are model floats → `formatNumber` via lib/figures (INC-27), never money. */
export default function MetricsBar({ totals, activityCount, releaseCount, profileCount }: MetricsBarProps) {
  const t = strings.metrics
  return (
    <div
      role="group"
      aria-label={t.label}
      className="bg-ink-soft border-b border-rule py-2.5 px-[22px] flex gap-2.5 flex-wrap"
    >
      <Metric label={t.totalManDays} val={whole(totals.tm)} sub={t.totalManDaysSub} colorClass="text-acc-hi" />
      <Metric
        label={t.elapsed}
        val={t.elapsedValue(whole(totals.el))}
        sub={t.elapsedSub(decimal(totals.mo))}
        colorClass="text-grn"
      />
      <Metric
        label={t.confidence}
        val={t.confidenceValue(whole(totals.best), whole(totals.worst))}
        sub={t.confidenceSub}
        colorClass="text-org-text"
      />
      <Metric label={t.aiCost} val={whole(totals.aiCost)} sub={t.aiCostSub} colorClass="text-ai" />
      <Metric
        label={t.aiElapsed}
        val={t.elapsedValue(whole(totals.aiElapsed))}
        sub={t.aiElapsedSub(whole(totals.el), whole(totals.el - totals.aiElapsed))}
        colorClass="text-ai"
      />
      <Metric
        label={t.activities}
        val={whole(activityCount)}
        sub={t.activitiesSub(releaseCount, profileCount)}
        colorClass="text-soft"
      />
    </div>
  )
}
