/**
 * The upload policy crm-api enforces (specs/20261101-crm-sales-flow AC-4.3), mirrored so a bad file
 * is refused before any request is made. The server stays the authority: its
 * `attachment_type_not_allowed` / `attachment_too_large` answer the same way.
 */
import { formatNumber } from '@operai/ui'
import { strings } from '../strings'

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export const ATTACHMENT_CONTENT_TYPES: readonly string[] = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
]

/** The file input's `accept`: the same five types. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_CONTENT_TYPES.join(',')

/** The message for a file that may not be attached, or null when it may. */
export function attachmentProblem(file: { type: string; size: number }): string | null {
  const t = strings.attachments.errors
  if (!ATTACHMENT_CONTENT_TYPES.includes(file.type)) return t.typeNotAllowed
  if (file.size > MAX_ATTACHMENT_BYTES) return t.tooLarge
  return null
}

/** A size for people: KB below one MB, otherwise MB with one decimal. */
export function formatFileSize(bytes: number): string {
  const t = strings.attachments.size
  return bytes < 1024 * 1024
    ? t.kilobytes(formatNumber(Math.max(1, Math.round(bytes / 1024))))
    : t.megabytes(formatNumber(bytes / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
}
