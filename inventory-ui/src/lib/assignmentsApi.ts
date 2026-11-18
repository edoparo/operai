import { sendJson } from './api'
import type { AssetView } from './types'

/** Manager side of assignments (the employee side is `meApi`). */

export const createAssignment = (assetId: string, assigneeUserId: string): Promise<AssetView> =>
  sendJson<AssetView>(`/assets/${encodeURIComponent(assetId)}/assignments`, 'POST', { assigneeUserId })

/** 409 `assignment_not_pending` when someone else already confirmed, declined or cancelled it. */
export const cancelAssignment = (assignmentId: string): Promise<AssetView> =>
  sendJson<AssetView>(`/assignments/${encodeURIComponent(assignmentId)}/cancel`, 'POST')

/**
 * A reminder to confirm, now, in-app and by email (US-15). 409 `reminder_too_soon` (`retryAfterSeconds`) within an hour
 * of the last one, 409 `assignment_not_pending`, 502 `reminder_not_sent` (nothing changed).
 */
export const remindAssignment = (assignmentId: string): Promise<AssetView> =>
  sendJson<AssetView>(`/assignments/${encodeURIComponent(assignmentId)}/remind`, 'POST')

/** Immediate, no confirmation step. 422 `office_not_found` for an unknown or archived office. */
export const assignToOffice = (assetId: string, officeId: string): Promise<AssetView> =>
  sendJson<AssetView>(`/assets/${encodeURIComponent(assetId)}/office-assignment`, 'POST', { officeId })
