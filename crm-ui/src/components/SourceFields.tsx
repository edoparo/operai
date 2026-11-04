import { Field } from '@operai/ui'
import { LEAD_SOURCES, hasSourceDetail } from '../lib/types'
import type { LeadSource } from '../lib/types'
import { strings } from '../strings'

/**
 * SourceFields — where a company or a lead came from (specs/017 US-7): the
 * source, and for an event, a referral or "other" a detail naming which event,
 * who referred it, or what else. Shared by the company and deal forms.
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
        <Field
          label={t.detail[source]}
          hint={t.detailHint[source]}
          error={detailError}
          testId={`${testIdPrefix}-source-detail`}
        >
          {(control) => <input {...control} value={detail} onChange={(event) => onDetail(event.target.value)} />}
        </Field>
      )}
    </>
  )
}
