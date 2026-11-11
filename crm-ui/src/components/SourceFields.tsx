import { useEffect, useState } from 'react'
import { Combobox, Field } from '@operai/ui'
import { listSourceDetails } from '../lib/crmApi'
import type { SourceDetailSuggestion } from '../lib/crmApi'
import { matchDetails } from '../lib/source'
import { LEAD_SOURCES, hasSourceDetail } from '../lib/types'
import type { LeadSource } from '../lib/types'
import { strings } from '../strings'

/**
 * SourceFields — where a company or a lead came from (specs/017 US-7): the
 * source, and for an event, a referral or "other" a detail naming which event,
 * who referred it, or what else. Shared by the company and deal forms.
 *
 * The detail suggests what was already written for that source, across
 * companies and deals (`GET /source-details`), so one event is not recorded
 * three ways. The list loads once per source on first focus and is matched in
 * the browser; when it cannot load, the field stays a plain text input.
 */
export default function SourceFields({
  source,
  detail,
  onSource,
  onDetail,
  detailError,
  testIdPrefix,
}: {
  source: LeadSource | ''
  detail: string
  onSource: (source: LeadSource | '') => void
  onDetail: (detail: string) => void
  detailError?: string | undefined
  testIdPrefix: string
}) {
  const t = strings.source
  return (
    <>
      <Field label={t.label} hint={t.hint} testId={`${testIdPrefix}-source`}>
        {(control) => (
          <select {...control} value={source} onChange={(event) => onSource(event.target.value as LeadSource | '')}>
            <option value="">{t.none}</option>
            {LEAD_SOURCES.map((option) => (
              <option key={option} value={option}>
                {t.value[option]}
              </option>
            ))}
          </select>
        )}
      </Field>
      {hasSourceDetail(source) && (
        <DetailField
          key={source}
          source={source}
          detail={detail}
          onDetail={onDetail}
          error={detailError}
          testId={`${testIdPrefix}-source-detail`}
        />
      )}
    </>
  )
}

function DetailField({
  source,
  detail,
  onDetail,
  error,
  testId,
}: {
  source: 'event' | 'referral' | 'other'
  detail: string
  onDetail: (detail: string) => void
  error?: string | undefined
  testId: string
}) {
  const t = strings.source
  const [open, setOpen] = useState(false)
  const [wanted, setWanted] = useState(false)
  const [items, setItems] = useState<SourceDetailSuggestion[]>([])

  useEffect(() => {
    if (!wanted) return
    const controller = new AbortController()
    listSourceDetails(source, { signal: controller.signal }).then(
      (result) => {
        if (!controller.signal.aborted) setItems(result.items)
      },
      // Suggestions are a convenience: without them the field is a plain input.
      () => undefined,
    )
    return () => controller.abort()
  }, [wanted, source])

  const matches = matchDetails(items, detail)
  const options = matches.map((value, index) => ({ id: String(index), label: value }))

  return (
    <Field label={t.detail[source]} hint={t.detailHint[source]} error={error} testId={testId}>
      {(control) => (
        <Combobox
          id={control.id}
          ariaInvalid={control['aria-invalid']}
          ariaDescribedBy={control['aria-describedby']}
          value={detail}
          onValueChange={(next) => {
            onDetail(next)
            setOpen(true)
          }}
          options={options}
          onSelect={(option) => {
            onDetail(option.label)
            setOpen(false)
          }}
          isOpen={open && options.length > 0}
          onOpenChange={setOpen}
          onFocus={() => {
            setWanted(true)
            setOpen(true)
          }}
          onBlur={() => setOpen(false)}
          liveRegionText={open && options.length > 0 ? t.suggestions(options.length) : ''}
          testId={`${testId}-input`}
        />
      )}
    </Field>
  )
}
