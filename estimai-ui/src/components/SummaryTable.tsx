import { useState } from 'react'
import type { ChangeEvent } from 'react'
import type { Parameters, Release, ReleaseSummary, Totals } from '../types'
import { type WarningCode } from '../lib/healthWarnings'
import FormulaPopover from './FormulaPopover'
import WarningBadge from './WarningBadge'
import { Button, Card, FactList, Icon } from '@operai/ui'
import { strings } from '../strings'
import { decimal, oneDecimal, percent, whole } from '../lib/figures'

interface SummaryTableProps {
  summary: ReleaseSummary[]
  releases: Release[]
  totals: Totals
  byProfile: [string, number][]
  params: Parameters
  releaseWarnings: Map<string, WarningCode[]>
  onUpdateRelease: (id: string, field: keyof Release, value: string | number) => void
  onAddRelease: () => void
  onDeleteRelease: (id: string) => void
  /**
   * T17 (specs/20260807-estimate-sharing/tasks.md; design.md S5): fed from
   * context's single `canEdit` gate (`!canEdit`). Defaults to `false` so
   * every pre-existing call site keeps its exact prior full-edit behaviour.
   * Release name/FTE inputs become `readOnly` (not `disabled`); the
   * "Add release" pill and each release's delete button are absent.
   */
  readOnly?: boolean
}

interface ThProps {
  children: React.ReactNode
  right?: boolean
  ai?: boolean
  tip?: string
}

function Th({ children, right, ai, tip }: ThProps) {
  return (
    <th
      className={`py-2 px-2.5 text-2xs font-mono uppercase tracking-[0.06em] border-b border-rule bg-ink-mid align-bottom ${right ? 'text-right' : 'text-left'} ${ai ? 'text-ai/70' : 'text-soft'}`}
    >
      <span className="inline-flex items-center gap-0.5">
        {children}
        {tip && <FormulaPopover text={tip} />}
      </span>
    </th>
  )
}

interface TdProps {
  children: React.ReactNode
  right?: boolean
  bold?: boolean
  colorClass?: string
  className?: string
}

function Td({ children, right, bold, colorClass, className }: TdProps) {
  return (
    <td
      className={`py-2.5 px-2.5 font-mono text-xs ${right ? 'text-right' : 'text-left'} ${bold ? 'font-semibold' : 'font-normal'} ${colorClass ?? 'text-text'} ${className ?? ''}`}
    >
      {children}
    </td>
  )
}

export default function SummaryTable({
  summary,
  releases,
  totals,
  params,
  byProfile,
  releaseWarnings,
  onUpdateRelease,
  onAddRelease,
  onDeleteRelease,
  readOnly = false,
}: SummaryTableProps) {
  const [showAI, setShowAI] = useState(false)
  const t = strings.summary
  const c = t.columns

  return (
    <>
      <div className="flex gap-2.5 mb-[18px] flex-wrap items-center">
        <h2 className="font-disp text-sm font-bold mr-2">{t.heading}</h2>
        {releases.map((rel) => {
          const ws = releaseWarnings.get(rel.id)
          return (
            <div
              key={rel.id}
              className={`bg-ink-soft border rounded-[10px] py-[9px] px-[13px] flex items-center gap-[9px] ${ws?.length ? 'border-org/40' : 'border-rule'}`}
            >
              <input
                value={rel.name}
                readOnly={readOnly}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onUpdateRelease(rel.id, 'name', e.target.value)}
                aria-label={t.releaseName}
                className="w-[106px] text-xs font-medium"
              />
              <span className="text-2xs text-soft" aria-hidden="true">
                {t.fte}
              </span>
              <input
                type="number"
                value={rel.fte}
                readOnly={readOnly}
                min={1}
                step={1}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onUpdateRelease(rel.id, 'fte', e.target.value)}
                aria-label={t.fte}
                className="w-11 text-right"
              />
              {ws?.map((code) => (
                <WarningBadge key={code} code={code} className="text-2xs" />
              ))}
              {!readOnly && releases.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  onClick={() => onDeleteRelease(rel.id)}
                  aria-label={t.deleteReleaseNamed(rel.name)}
                  title={t.deleteRelease}
                >
                  <Icon name="trash" />
                </Button>
              )}
            </div>
          )
        })}
        {!readOnly && (
          <Button size="sm" onClick={onAddRelease}>
            {t.addRelease}
          </Button>
        )}

        <div className="flex-1" />

        <Button size="sm" onClick={() => setShowAI((v) => !v)} aria-pressed={showAI}>
          {showAI ? t.hideAi : t.showAi}
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="text-xs w-full" style={{ tableLayout: 'fixed' }}>
          <caption className="visually-hidden">{t.caption}</caption>
          <colgroup>
            {((): React.ReactNode => {
              const frBase = [2, 0.5, 1, 1, 1, 1, 1, 0.8, 0.8, 0.8, 1]
              const frAI = [1, 1, 1]
              const cols = showAI ? [...frBase, ...frAI] : frBase
              const total = cols.reduce((a, b) => a + b, 0)
              return cols.map((fr, i) => <col key={i} style={{ width: `${((fr / total) * 100).toFixed(2)}%` }} />)
            })()}
          </colgroup>
          <thead>
            <tr>
              <Th>{c.release}</Th>
              <Th right tip={t.tips.fte}>
                {c.fte}
              </Th>
              <Th right tip={t.tips.ind}>
                {c.ind}
              </Th>
              <Th right tip={t.tips.planning}>
                {c.planning}
              </Th>
              <Th right tip={t.tips.baseline}>
                {c.baseline}
              </Th>
              <Th right tip={t.tips.elapsed}>
                {c.elapsed}
              </Th>
              <Th right tip={t.tips.totalMd}>
                {c.totalMd}
              </Th>
              <Th right tip={t.tips.months}>
                {c.months}
              </Th>
              <Th right tip={t.tips.best}>
                {c.best}
              </Th>
              <Th right tip={t.tips.worst}>
                {c.worst}
              </Th>
              <Th right tip={t.tips.range}>
                {c.range}
              </Th>
              {showAI && (
                <>
                  <Th right ai tip={t.tips.aiCost}>
                    {c.aiCost}
                  </Th>
                  <Th right ai tip={t.tips.aiElapsed}>
                    {c.aiElapsed}
                  </Th>
                  <Th right ai tip={t.tips.aiTotalMd}>
                    {c.aiTotalMd}
                  </Th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {summary.map((s, idx) => {
              const ws = releaseWarnings.get(s.id)
              return (
                <tr key={s.id} className={`border-b border-rule ${idx % 2 === 0 ? 'bg-ink-soft' : 'bg-ink'}`}>
                  <Td>
                    <span className="flex items-center gap-1.5">
                      {s.name}
                      {ws?.map((code) => (
                        <WarningBadge key={code} code={code} className="text-2xs" />
                      ))}
                    </span>
                  </Td>
                  <Td right colorClass="text-soft">
                    {decimal(s.fte)}
                  </Td>
                  {s.res ? (
                    <>
                      <Td right>{decimal(s.res.ind, 1)}</Td>
                      <Td right colorClass="text-soft">
                        {oneDecimal(s.res.plan)}
                      </Td>
                      <Td right colorClass="text-soft">
                        {decimal(s.res.base, 1)}
                      </Td>
                      <Td right bold colorClass="text-acc-hi">
                        {whole(s.res.el)}
                        <FormulaPopover
                          text={[
                            t.formula.baseline(decimal(s.res.ind, 1), oneDecimal(s.res.plan), decimal(s.res.base, 1)),
                            t.formula.elapsed(
                              decimal(s.res.base, 1),
                              decimal(params.parallelism),
                              decimal(s.fte - 1),
                              decimal(s.fte),
                              whole(s.res.el),
                            ),
                          ].join('\n')}
                        />
                      </Td>
                      <Td right bold>
                        {whole(s.res.tm)}
                      </Td>
                      <Td right colorClass="text-grn">
                        {decimal(s.res.mo)}
                      </Td>
                      <Td right colorClass="text-grn">
                        {whole(s.res.best)}
                      </Td>
                      <Td right colorClass="text-red-text">
                        {whole(s.res.worst)}
                      </Td>
                      <td className="py-2.5 px-2.5 text-right">
                        <span className="font-mono text-2xs bg-org/12 text-org-text py-[3px] px-[7px] rounded">
                          {t.range(whole(s.res.best), whole(s.res.worst))}
                        </span>
                      </td>
                      {showAI && (
                        <>
                          <Td right bold colorClass="text-ai">
                            {whole(s.res.aiCost)}
                          </Td>
                          <Td right bold colorClass="text-ai">
                            {whole(s.res.aiElapsed)}
                            <FormulaPopover
                              text={[
                                t.formula.aiExpected(
                                  decimal(s.res.sumExp),
                                  percent(params.aiGain),
                                  decimal(s.res.sumAiExp),
                                ),
                                t.formula.aiElapsed(
                                  whole(s.res.aiElapsed),
                                  whole(s.res.el - s.res.aiElapsed),
                                  whole(s.res.el),
                                ),
                              ].join('\n')}
                            />
                          </Td>
                          <Td right bold colorClass="text-ai">
                            {whole(s.res.aiTotalMD)}
                          </Td>
                        </>
                      )}
                    </>
                  ) : (
                    <td colSpan={showAI ? 12 : 9} className="py-2.5 px-2.5 text-center text-soft text-2xs italic">
                      {t.noActivities}
                    </td>
                  )}
                </tr>
              )
            })}
            <tr className="bg-ink-mid border-t-2 border-acc">
              <th scope="row" className="py-2.5 px-2.5 font-disp font-bold text-2xs text-left uppercase">
                {t.total}
              </th>
              <td />
              <Td right bold>
                {oneDecimal(totals.ind)}
              </Td>
              <td />
              <Td right bold>
                {oneDecimal(totals.base)}
              </Td>
              <Td right bold colorClass="text-acc-hi" className="text-sm">
                {whole(totals.el)}
              </Td>
              <Td right bold className="text-sm">
                {whole(totals.tm)}
              </Td>
              <Td right bold colorClass="text-grn">
                {decimal(totals.mo)}
              </Td>
              <Td right bold colorClass="text-grn">
                {whole(totals.best)}
              </Td>
              <Td right bold colorClass="text-red-text">
                {whole(totals.worst)}
              </Td>
              <td className="py-2.5 px-2.5 text-right">
                <span className="font-mono text-xs bg-org/15 text-org-text py-1 px-[9px] rounded font-semibold">
                  {t.range(whole(totals.best), whole(totals.worst))}
                </span>
              </td>
              {showAI && (
                <>
                  <Td right bold colorClass="text-ai" className="text-sm">
                    {whole(totals.aiCost)}
                  </Td>
                  <Td right bold colorClass="text-ai" className="text-sm">
                    {whole(totals.aiElapsed)}
                  </Td>
                  <Td right bold colorClass="text-ai" className="text-sm">
                    {whole(totals.aiTotalMD)}
                  </Td>
                </>
              )}
            </tr>
          </tbody>
        </table>
      </div>

      {/* INC-33: label/value pairs in a FactList inside a Card (title h2: a
          section of the Summary view, under the editor's h1). */}
      <Card title={t.byProfile} headingLevel={2} className="mt-6" data-testid="summary-by-profile">
        <FactList
          items={byProfile.map(([prof, days]) => ({
            id: prof,
            term: prof,
            value: <span className="font-mono text-acc-hi">{t.days(oneDecimal(days))}</span>,
          }))}
        />
      </Card>
    </>
  )
}
