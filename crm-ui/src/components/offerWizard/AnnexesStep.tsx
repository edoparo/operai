import { useId, useState } from 'react'
import { Card, CheckboxGroupField, formatNumber } from '@operai/ui'
import type { WizardAnswers } from '../../lib/offerEngine/answers'
import { formatFileSize } from '../../lib/attachments'
import { strings } from '../../strings'
import StepForm from './StepForm'
import type { StepPanelProps } from './StepPanel'

const t = strings.offerWizard

const MAX_PDFS = 5
const MAX_PDF_BYTES = 20 * 1024 * 1024
const MAX_QUANTITY = 100_000

const roundHalfUp = (value: number): number => Math.round(value + Number.EPSILON)
const quantityOf = (manDays: number): number => Math.min(Math.max(roundHalfUp(manDays), 1), MAX_QUANTITY)

/**
 * The Annexes step (design S6; AC-1.2, AC-2.5, AC-9.6): the template's own annex items, the effort-detail annex and
 * its AI-assisted figures (both need the estimate), and the deal's PDFs — the only annex picker there is.
 */
export default function AnnexesStep(props: StepPanelProps) {
  const { ast, answers, onAnswersChange, context, outline } = props
  const [pdfError, setPdfError] = useState<string | null>(null)
  const hintId = useId()
  const estimate = context.estimate
  const estimateReady = estimate !== null && (estimate.state === undefined || estimate.state === 'ready')
  const items = outline.steps.find((step) => step.key === 'annexes')?.items ?? []

  /** AI-assisted on or off: the man-days the person has not touched follow the estimate's figure (their edits stay). */
  const setAiAssisted = (on: boolean) => {
    const next: WizardAnswers = {
      ...answers,
      aiAssisted: on,
      fields: { ...answers.fields },
      prefilled: { ...answers.prefilled },
    }
    if (estimate !== null) {
      const from = on ? estimate.manDays : estimate.manDaysAi
      const to = on ? estimate.manDaysAi : estimate.manDays
      for (const field of ast.fields) {
        if (field.source !== 'manDays') continue
        const current = answers.fields[field.name]
        if (current === undefined || String(current) !== String(answers.prefilled[field.name])) continue
        next.fields[field.name] = String(roundHalfUp(to))
        next.prefilled[field.name] = String(roundHalfUp(to))
      }
      const lines = { ...answers.costs.lines }
      for (const entry of ast.sections.find((section) => section.costs !== null)?.costs?.items ?? []) {
        if (entry.type !== 'line' || entry.qty?.type !== 'manDays') continue
        const line = lines[entry.key]
        if (line && line.quantity === quantityOf(from)) lines[entry.key] = { ...line, quantity: quantityOf(to) }
      }
      next.costs = { ...answers.costs, lines }
    }
    onAnswersChange(next)
  }

  const chosen = context.attachments.filter((file) => answers.attachmentIds.includes(file.id))
  const chosenBytes = chosen.reduce((sum, file) => sum + file.sizeBytes, 0)
  const togglePdf = (id: string, checked: boolean) => {
    if (!checked) {
      setPdfError(null)
      return onAnswersChange({ ...answers, attachmentIds: answers.attachmentIds.filter((other) => other !== id) })
    }
    const file = context.attachments.find((candidate) => candidate.id === id)
    if (answers.attachmentIds.length >= MAX_PDFS) return setPdfError(t.annexes.pdfsLimit)
    if (file && chosenBytes + file.sizeBytes > MAX_PDF_BYTES) return setPdfError(t.annexes.pdfsTooBig)
    setPdfError(null)
    onAnswersChange({ ...answers, attachmentIds: [...answers.attachmentIds, id] })
  }

  return (
    <div className="flex flex-col gap-4">
      {items.length > 0 ? <StepForm {...props} items={items} /> : null}
      <Card>
        <div className="flex flex-col gap-3">
          <div>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                data-wizard-field="annex:effort"
                aria-describedby={`${hintId}-effort`}
                checked={answers.effortAnnex}
                disabled={!estimateReady}
                onChange={(event) => onAnswersChange({ ...answers, effortAnnex: event.target.checked })}
              />
              <span className="text-sm text-text">{t.annexes.effort}</span>
            </label>
            <p id={`${hintId}-effort`} className="ml-7 text-xs text-soft">
              {estimateReady ? t.annexes.effortHint : t.annexes.noEstimate}
            </p>
          </div>
          <div className="ml-6">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                data-wizard-field="annex:ai"
                aria-describedby={`${hintId}-ai`}
                checked={answers.aiAssisted}
                disabled={!estimateReady}
                onChange={(event) => setAiAssisted(event.target.checked)}
              />
              <span className="text-sm text-text">{t.annexes.ai}</span>
            </label>
            <p id={`${hintId}-ai`} className="ml-7 text-xs text-soft">
              {estimateReady ? t.annexes.aiHint : t.annexes.noEstimate}
            </p>
          </div>
        </div>
      </Card>
      <Card>
        <CheckboxGroupField
          label={t.annexes.pdfs}
          hint={t.annexes.pdfsSize(
            chosen.length,
            formatNumber(chosenBytes / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
          )}
          error={pdfError}
          options={context.attachments.map((file) => ({
            id: file.id,
            label: `${file.fileName} (${formatFileSize(file.sizeBytes)})`,
          }))}
          selected={answers.attachmentIds}
          onToggle={togglePdf}
          emptyState={t.annexes.pdfsEmpty}
          scroll
          testId="crm-wizard-pdfs"
        />
      </Card>
    </div>
  )
}
