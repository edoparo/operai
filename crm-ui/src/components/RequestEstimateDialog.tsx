import { useState } from 'react'
import { FormDialog } from '@operai/ui'
import { requestEstimate } from '../lib/crmApi'
import { codeOf, errorMessage } from '../lib/errors'
import type { Deal } from '../lib/types'
import { strings } from '../strings'
import PersonPicker from './PersonPicker'
import type { PersonChoice } from './PersonPicker'

/** The readable line for a request refused by crm-api or by EstimAI behind it. */
function requestFailure(error: unknown): { field?: string; dialog?: string } {
  const t = strings.estimate.errors
  switch (codeOf(error)) {
    case 'technician_not_estimai_user':
      return { field: t.technicianNotEstimai }
    case 'owner_not_crm_user':
      return { field: t.technicianNotCrm }
    case 'estimai_access_required':
      return { dialog: t.estimaiAccessRequired }
    case 'estimai_unavailable':
      return { dialog: t.estimaiUnavailable }
    case 'estimai_unconfigured':
      return { dialog: t.estimaiUnconfigured }
    case 'estimate_exists':
      return { dialog: t.estimateExists }
    case 'deal_not_open_for_estimate':
      return { dialog: t.notOpen }
    default:
      return { dialog: errorMessage(error) }
  }
}

/**
 * RequestEstimateDialog — pick the technical contact (a person who can use
 * EstimAI: the directory is filtered with `appId=estimai`) and request the
 * estimate. 422 codes about the person land on the picker; everything else
 * (no EstimAI access for the caller, EstimAI down) is the dialog's own error.
 */
export default function RequestEstimateDialog({
  dealId,
  onRequested,
  onCancel,
}: {
  dealId: string
  onRequested: (deal: Deal) => void
  onCancel: () => void
}) {
  const t = strings.estimate.requestDialog
  const [technician, setTechnician] = useState<PersonChoice | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = () => {
    if (technician === null) {
      setFieldError(t.pickRequired)
      return
    }
    setFieldError(null)
    setError(null)
    setBusy(true)
    requestEstimate(dealId, technician.id).then(onRequested, (failure: unknown) => {
      setBusy(false)
      const mapped = requestFailure(failure)
      setFieldError(mapped.field ?? null)
      setError(mapped.dialog ?? null)
    })
  }

  return (
    <FormDialog
      title={t.title}
      description={t.description}
      submitLabel={t.submit}
      busyLabel={t.busy}
      cancelLabel={strings.common.cancel}
      closeLabel={strings.common.close}
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
      testIdPrefix="crm-estimate-request"
    >
      <PersonPicker
        appId="estimai"
        label={t.technician}
        value={technician}
        onChange={(next) => {
          setTechnician(next)
          setFieldError(null)
        }}
        error={fieldError}
        required
        testId="crm-estimate-request-technician"
      />
    </FormDialog>
  )
}
