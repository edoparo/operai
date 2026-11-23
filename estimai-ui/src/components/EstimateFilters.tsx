/**
 * EstimateFilters — the estimates list's "Whose" and "Status" controls
 * (specs/20261108-estimate-list-oversight US-1/US-2). Whose is rendered only for a user holding
 * `(estimate, read-all)` — absent, never disabled; it is a UX convenience, the
 * server is the gate. Owner (US-4) lists the owners of the loaded estimates and is shown once
 * there is more than one to choose from, or one is chosen. Selects apply on change.
 */

import { Field } from '@operai/ui'
import type { StatusFilter, Whose } from '../lib/listFilters'
import type { OwnerOption } from '../lib/ownerFilter'
import { strings } from '../strings'

const t = strings.estimatesList.filters

export type EstimateFiltersProps = {
  whose: Whose
  status: StatusFilter
  canChooseWhose: boolean
  onWhoseChange: (whose: Whose) => void
  onStatusChange: (status: StatusFilter) => void
  /** `null` = everyone. */
  owner: string | null
  ownerOptions: OwnerOption[]
  onOwnerChange: (owner: string | null) => void
}

/** The select's value for "everyone": never an owner key (`me` or a non-empty name). */
const EVERYONE = ''


export default function EstimateFilters({
  whose,
  status,
  canChooseWhose,
  onWhoseChange,
  onStatusChange,
  owner,
  ownerOptions,
  onOwnerChange,
}: EstimateFiltersProps) {
  const showOwner = owner !== null || ownerOptions.length > 1
  return (
    <div
      role="group"
      aria-label={strings.estimatesList.filtersLabel}
      className="mb-4 grid max-w-2xl grid-cols-1 items-start gap-3 sm:grid-cols-3"
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
      {showOwner && (
        <Field label={t.owner} testId="estimate-filter-owner">
          {(control) => (
            <select
              {...control}
              value={owner ?? EVERYONE}
              onChange={(event) => onOwnerChange(event.target.value === EVERYONE ? null : event.target.value)}
            >
              <option value={EVERYONE}>{t.everyone}</option>
              {ownerOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.isMe ? t.ownerMe : option.value}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
    </div>
  )
}
