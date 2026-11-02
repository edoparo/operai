import { ApiError } from './api'
import { codeOf, errorMessage } from './errors'
import { strings } from '../strings'

/** The readable line for a refused or failed generation (also used for download and delete). */
export function offerFailure(error: unknown): string {
  const t = strings.offers.errors
  switch (codeOf(error)) {
    case 'estimate_not_ready':
      return t.estimateNotReady
    case 'entity_profile_missing':
      return t.profileMissing
    case 'storage_unconfigured':
      return t.storageUnconfigured
    case 'estimai_unavailable':
    case 'estimai_unconfigured':
    case 'estimate_unavailable':
      return t.estimaiUnavailable
    case 'contact_not_in_company':
      return t.contactNotInCompany
    case 'template_archived':
      return t.templateArchived
    case 'version_conflict':
      return t.versionConflict
    case 'attachment_invalid':
      return t.attachmentInvalid
    case 'attachment_not_pdf':
      return t.attachmentNotPdf(fileNameOf(error))
    case 'attachment_unreadable':
      return t.attachmentUnreadable(fileNameOf(error))
    case 'attachments_too_large':
      return t.attachmentsTooLarge
    case 'discounts_exceed_one_off':
      return t.discountsExceed
    case 'cost_total_too_large':
      return t.costTotalTooLarge
    default:
      return errorMessage(error)
  }
}

/** The `fileName` extension member of an attachment problem (422). */
function fileNameOf(error: unknown): string {
  const name = error instanceof ApiError ? error.extras['fileName'] : undefined
  return typeof name === 'string' ? name : ''
}
