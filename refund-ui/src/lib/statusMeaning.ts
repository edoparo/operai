/**
 * The app's ONE domain → status-meaning map (INC-23). Each refund status maps
 * to a meaning of the suite's status dictionary (`STATUS` in @operai/ui),
 * which fixes its tone and icon, so an icon means the same thing in every
 * tool. `RequestStatusBadge` and `BatchStatusBadge` render through it.
 *
 * `paid` is "settled" for both a request and a batch: the same real-world
 * event seen from two sides, hence the same icon — and distinct from an
 * approved request ("active") by icon, though both are the success tone.
 */

import type { StatusMeaning } from '@operai/ui'
import type { RequestStatus } from '../components/RequestStatusBadge'
import type { BatchStatus } from './batchesApi'

export const REQUEST_STATUS_MEANING: Record<RequestStatus, StatusMeaning> = {
  draft: 'draft',
  submitted: 'pending',
  approved: 'active',
  rejected: 'failed',
  paid: 'settled',
}

export const BATCH_STATUS_MEANING: Record<BatchStatus, StatusMeaning> = {
  compiled: 'pending',
  paid: 'settled',
  discarded: 'voided',
}
