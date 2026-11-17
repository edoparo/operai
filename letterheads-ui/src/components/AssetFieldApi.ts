/**
 * What the file fields ask of letterhead-api (task T23; plan § Person routes, amendment G3, `routes/write.rs`
 * `upload` and `routes/read.rs` `asset`): the upload of a logo or a background, the stored bytes of an asset
 * for a thumbnail, and the words for a refusal.
 */
import { apiFetch, getLetterheadsApiBaseUrl } from 'shell/session'
import { ApiError, requestJson } from '../lib/api'
import type { Entity } from '../lib/types'
import { strings } from '../strings'

export type AssetKind = 'logo' | 'background'
export type AssetFormat = 'png' | 'jpeg' | 'svg'

/** The most a file may be: 2 MiB, the service's `assets::MAX_BYTES` (AC-7.3). The service is the authority; this spares an upload. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

/** `201` of `POST /v1/letterheads/{entity}/assets`: `width` and `height` are `null` for an SVG. */
export interface UploadedAsset {
  id: string
  kind: AssetKind
  format: AssetFormat
  width: number | null
  height: number | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const dimension = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null

/** The answer of an upload, or `null` when it is not the shape the contract fixes (a proxy page, an older build). */
function readUploaded(body: unknown): UploadedAsset | null {
  if (!isRecord(body) || typeof body.id !== 'string' || body.id === '') return null
  if (body.kind !== 'logo' && body.kind !== 'background') return null
  if (body.format !== 'png' && body.format !== 'jpeg' && body.format !== 'svg') return null
  return {
    id: body.id,
    kind: body.kind,
    format: body.format,
    width: dimension(body.width),
    height: dimension(body.height),
  }
}

/** Posts `file` as a logo or a background of `entity`. Throws `ApiError` for a refusal, and for an answer it cannot read. */
export async function uploadAsset(
  entity: Entity,
  kind: AssetKind,
  file: File,
  signal?: AbortSignal,
): Promise<UploadedAsset> {
  // No Content-Type here: the browser adds the multipart one, with its boundary. The file's name and type are
  // not read by the service (AC-7.1: the bytes decide).
  const form = new FormData()
  form.append('kind', kind)
  form.append('file', file)
  const body = await requestJson<unknown>(getLetterheadsApiBaseUrl(), `/v1/letterheads/${entity}/assets`, {
    method: 'POST',
    body: form,
    signal,
  })
  const uploaded = readUploaded(body)
  if (uploaded === null) throw new ApiError({ status: 201, title: 'Unreadable upload answer' })
  return uploaded
}

/** What a thumbnail may be: the three formats the service stores, as the type it serves them with. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml']

/**
 * `GET /v1/assets/{id}` with the person's token (an `<img src>` cannot carry it), as a `Blob` of one of the
 * three image types. Anything else is refused here, so no other content is ever shown as an image.
 */
export async function fetchAssetImage(id: string, signal?: AbortSignal): Promise<Blob> {
  const response = await apiFetch(`${getLetterheadsApiBaseUrl()}/v1/assets/${encodeURIComponent(id)}`, { signal })
  if (!response.ok)
    throw new ApiError({ status: response.status, title: response.statusText || String(response.status) })
  const blob = await response.blob()
  if (!IMAGE_TYPES.includes(blob.type)) throw new ApiError({ status: response.status, title: 'Not an image' })
  return blob
}

/** `PNG` / `JPEG` / `SVG` for the type a thumbnail was served with, or `null` for any other. */
export function formatOfType(type: string): AssetFormat | null {
  if (type === 'image/png') return 'png'
  if (type === 'image/jpeg') return 'jpeg'
  if (type === 'image/svg+xml') return 'svg'
  return null
}

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError'

/** Whether an upload ended because the person or the page cancelled it (not a failure to tell them about). */
export const wasCancelled = isAbort

/**
 * The sentence for a failed upload (design F5.4). A 422 `invalid_asset` says why in `reason`, one of the ten
 * of the closed list, each with its own sentence; a reason this build does not know is "not accepted". A 403
 * (`forbidden`, `out_of_scope`) means the grant changed. Everything else (the network, a 5xx, a 400
 * `bad_request`, a 422 `invalid_request` or `unknown_layout`, a 409) is "could not be uploaded, try again".
 */
export function describeUploadError(error: unknown): string {
  if (!(error instanceof ApiError)) return strings.upload.failed
  if (error.status === 422 && error.code === 'invalid_asset') {
    const reason = error.extras.reason
    const known = strings.upload.reason as Record<string, string>
    return typeof reason === 'string' && Object.prototype.hasOwnProperty.call(known, reason)
      ? known[reason]
      : strings.upload.refused
  }
  if (error.status === 403) return strings.upload.forbidden
  return strings.upload.failed
}
