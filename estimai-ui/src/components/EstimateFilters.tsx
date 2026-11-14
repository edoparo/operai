/**
 * EstimateFilters — the estimates list's "Whose" and "Status" controls
 * (specs/20261108-estimate-list-oversight US-1/US-2). Whose is rendered only for a user holding
 * `(estimate, read-all)` — absent, never disabled; it is a UX convenience, the
 * server is the gate. Selects apply on change.
 */

import { Field } from '@operai/ui'
import type { StatusFilter, Whose } from '../lib/listFilters'
import { strings } from '../strings'

const t = strings.estimatesList.filters

export type EstimateFiltersProps = {
  whose: Whose
  status: StatusFilter
  canChooseWhose: boolean
  onWhoseChange: (whose: Whose) => void
  onStatusChange: (status: StatusFilter) => void
}

export default function EstimateFilters({
  whose,
  status,
  canChooseWhose,
  onWhoseChange,
  onStatusChange,
}: EstimateFiltersProps) {
  return (
    <div
      role="group"
      aria-label={strings.estimatesList.filtersLabel}
      className="mb-4 grid max-w-md grid-cols-1 items-start gap-3 sm:grid-cols-2"
      data-testid="estimate-filters"
    >
      {canChooseWhose && (
        <Field label={t.whose} testId="estimate-filter-whose">
          {(control) => (
            <select {...control} value={whose} onChange={(event) => onWhoseChange(event.target.value as Whose)}>
              <option value="mine">{t.mine}</option>
              <option value="all">{t.all}</option>
            </select>
          )}
        </Field>
      )}
      <Field label={t.status} testId="estimate-filter-status">
        {(control) => (
          <select {...control} value={status} onChange={(event) => onStatusChange(event.target.value as StatusFilter)}>
            <option value="open">{t.open}</option>
            <option value="closed">{t.closed}</option>
          </select>
        )}
      </Field>
    </div>
  )
}
