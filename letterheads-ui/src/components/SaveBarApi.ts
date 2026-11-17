/**
 * What the save asks of letterhead-api (task T24; plan § Person routes, amendment G2, `routes/write.rs` `save`):
 * `POST /v1/letterheads/{entity}/versions` with `{ baseVersion, config }`, and the reading of every way it can
 * answer other than 201.
 *
 * - 201 `{ version }`;
 * - 409 `version_conflict` + `currentVersion`: somebody saved since the form's version (AC-4.8);
 * - 422 `invalid_letterhead` + `problems[]`: the values the service refuses (AC-8.3);
 * - 403 `forbidden` / `out_of_scope`: the person's grant changed (F7.5);
 * - 422 `invalid_request`, 422 `unknown_layout`, 422 `unknown_entity`, 400 `bad_request`, 413
 *   `request_too_large`: the request is not one the form makes; a sentence of its own or the generic one;
 * - 429 `busy`, 408, 5xx, 503 and the network: the save did not happen, and trying again may work.
 */
import { ApiError, sendJson } from '../lib/api'
import { readProblems } from '../lib/fieldPath'
import type { FormConfig, Problem } from '../lib/formStateTypes'
import type { Entity } from '../lib/types'
import { strings } from '../strings'

/**
 * Saves `config` as the version after `baseVersion` (0 for an entity with none). Resolves the version number the
 * service gave it. A 201 whose body cannot be read still is a save: the version it made is `baseVersion + 1`
 * (the service only saves when the base is the newest), and the list the page refreshes says the rest.
 */
export async function saveVersion(
  entity: Entity,
  baseVersion: number,
  config: FormConfig,
  signal?: AbortSignal,
): Promise<number> {
  const answer = await sendJson<unknown>(
    `/v1/letterheads/${entity}/versions`,
    'POST',
    { baseVersion, config },
    { signal },
  )
  const version = typeof answer === 'object' && answer !== null ? (answer as { version?: unknown }).version : undefined
  return typeof version === 'number' && Number.isInteger(version) && version > 0 ? version : baseVersion + 1
}

/** A save that did not happen, as the page acts on it. */
export type SaveFailure =
  /** A newer version exists; `currentVersion` is the newest, or `null` when the answer did not say. */
  | { kind: 'conflict'; currentVersion: number | null }
  /** The service refused these values; nothing was saved. */
  | { kind: 'refused'; problems: Problem[] }
  /** The person may no longer change this letterhead. */
  | { kind: 'lost' }
  /** Anything else: the sentence to show, and whether trying again can help. */
  | { kind: 'failed'; message: string; retryable: boolean }

const generic = (): SaveFailure => ({ kind: 'failed', message: strings.save.failedBody, retryable: true })

/** Reads a thrown value of `saveVersion` into what the page does about it. */
export function classifySaveFailure(error: unknown): SaveFailure {
  if (!(error instanceof ApiError)) return generic()
  const { status, code } = error
  if (status === 409 && code === 'version_conflict') {
    const current = error.extras.currentVersion
    return {
      kind: 'conflict',
      currentVersion: typeof current === 'number' && Number.isInteger(current) ? current : null,
    }
  }
  if (status === 403) return { kind: 'lost' }
  if (status === 422 && code === 'invalid_letterhead') {
    const problems = readProblems(error.extras.problems)
    // Refused, but with nothing to point at: the request-shape sentence, never an empty list.
    if (problems.length > 0) return { kind: 'refused', problems }
    return { kind: 'failed', message: strings.save.rejected, retryable: false }
  }
  if (status === 429) return { kind: 'failed', message: strings.save.busy, retryable: true }
  if (status === 413) return { kind: 'failed', message: strings.save.tooLarge, retryable: false }
  if (status === 422 && code === 'unknown_layout') {
    return { kind: 'failed', message: strings.save.unknownLayout, retryable: false }
  }
  // invalid_request, unknown_entity, bad_request and any other 4xx but a timeout: the form does not make this request.
  if (status >= 400 && status < 500 && status !== 408) {
    return { kind: 'failed', message: strings.save.rejected, retryable: false }
  }
  return generic()
}
