import { DataTable, FactList, formatDate, formatNumber } from '@operai/ui'
import type { DataTableColumn, Fact } from '@operai/ui'
import type { HourPackage, Position, Sla, Terms } from '../lib/types'
import { strings } from '../strings'

const manDays = (value: number) => strings.terms.details.manDays(formatNumber(value, { maximumFractionDigits: 1 }))

function slaText(sla: Sla): string {
  return strings.terms.details.slaValue(sla.highDays, sla.normalDays)
}

function hourPackageText(pkg: HourPackage): string {
  const t = strings.terms.details
  const parts = [t.hours(pkg.hours), t.kinds[pkg.kind], `${t.packageStart} ${formatDate(pkg.startDate)}`]
  if (pkg.expiryDate) parts.push(`${t.packageExpiry} ${formatDate(pkg.expiryDate)}`)
  return parts.join(' · ')
}

/** The type-specific facts of terms: which members count is the terms' `type`, the rest read as absent. */
function typeFacts(terms: Terms): Fact[] {
  const t = strings.terms.details
  switch (terms.type) {
    case 'fixed_price':
      return [
        {
          id: 'deadline',
          term: t.deadline,
          value: terms.deadline ? formatDate(terms.deadline) : strings.common.none,
        },
        {
          id: 'estimated',
          term: t.estimatedManDays,
          value: terms.estimatedManDays == null ? strings.common.none : manDays(terms.estimatedManDays),
        },
        {
          id: 'max',
          term: t.maxEffortManDays,
          value: terms.maxEffortManDays == null ? strings.common.none : manDays(terms.maxEffortManDays),
        },
      ]
    case 'maintenance':
    case 'saas':
      return [
        { id: 'sla', term: t.sla, value: terms.sla ? slaText(terms.sla) : t.noTerms },
        {
          id: 'hours',
          term: t.hourPackage,
          value: terms.hourPackage ? hourPackageText(terms.hourPackage) : t.noTerms,
        },
      ]
    case 't_and_m':
    case 'internal':
      return []
  }
}

/**
 * TermsDetails — the terms of a project, read-only: the dates, then the terms of its type
 * (specs/021 AC-2.3 – AC-2.8). No amount, price or rate exists (AC-2.9). Shared by the purchase
 * order card and the Terms card, so a project with a PO and a hand-made one read alike.
 */
export default function TermsDetails({ terms }: { terms: Terms }) {
  const t = strings.terms.details
  const items: Fact[] = [
    { id: 'start', term: t.start, value: formatDate(terms.startDate) },
    { id: 'end', term: t.end, value: terms.endDate ? formatDate(terms.endDate) : t.openEnded },
    ...typeFacts(terms),
  ]
  const positions = terms.type === 't_and_m' ? (terms.positions ?? []) : null
  const columns: DataTableColumn<Position>[] = [
    { id: 'profile', header: t.profile, rowHeader: true, render: (position) => position.profile },
    {
      id: 'days',
      header: t.plannedManDays,
      numeric: true,
      render: (position) => formatNumber(position.plannedManDays, { maximumFractionDigits: 1 }),
    },
  ]
  return (
    <div className="flex flex-col gap-3" data-testid="terms-details">
      <FactList items={items} />
      {positions !== null && (
        <DataTable
          caption={t.termsCaption}
          columns={columns}
          rows={positions}
          getRowKey={(position) => position.profile}
        />
      )}
    </div>
  )
}
