/**
 * A task's description files (ADR 20261113-task-description-files-in-activities-api-bucket), the browser's side: the policy activities-api enforces
 * (mirrored so a bad file is refused before any request; the server stays the authority), the
 * upload in three calls, short-lived URLs remembered for less than they live, and the save of a
 * form's deferred files after the task itself is saved (`commitDeferredFiles`, @operai/ui).
 */
import { commitDeferredFiles } from '@operai/ui/rich-text'
import type { CommittedFiles, DeferredFile, DeferredFiles, RichTextDoc } from '@operai/ui/rich-text'
import { confirmTaskFile, deleteTaskFile, getTaskFileUrl, postToBucket, startTaskFile } from './activitiesApi'
import type { TaskFile } from './activitiesApi'
import { strings } from '../strings'

export const IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const ATTACHMENT_TYPES: readonly string[] = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  ...IMAGE_TYPES,
]
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const MAX_FILES_PER_TASK = 20

export const IMAGE_ACCEPT = IMAGE_TYPES.join(',')
export const ATTACHMENT_ACCEPT = ATTACHMENT_TYPES.join(',')

/** Why a chosen file cannot be kept, or null. */
export function taskFileProblem(file: File, kind: DeferredFile['kind']): string | null {
  const t = strings.tasks.files.errors
  if (kind === 'image') {
    if (!IMAGE_TYPES.includes(file.type)) return t.imageType(file.name)
    if (file.size > MAX_IMAGE_BYTES) return t.imageTooLarge(file.name)
    return null
  }
  if (!ATTACHMENT_TYPES.includes(file.type)) return t.attachmentType(file.name)
  if (file.size > MAX_ATTACHMENT_BYTES) return t.attachmentTooLarge(file.name)
  return null
}

/** The task's stored files as a form keeps them. */
export const deferredOf = (files: readonly TaskFile[] | undefined): DeferredFile[] =>
  (files ?? []).map((file) => ({ id: file.id, kind: file.kind, name: file.fileName, sizeBytes: file.sizeBytes }))

/** Start, send the bytes to the bucket, confirm: the stored file. */
export async function uploadTaskFile(activityId: string, file: File, kind: DeferredFile['kind']): Promise<TaskFile> {
  const started = await startTaskFile(activityId, {
    kind,
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
  })
  await postToBucket(started.upload, file)
  return confirmTaskFile(activityId, started.fileId)
}

// A presigned GET lives 60 s: remembered for 45, so a re-render does not ask again.
const URL_TTL_MS = 45_000
const urls = new Map<string, { url: string; until: number }>()
const resolvers = new Map<string, (fileId: string) => Promise<string>>()

/** One stable resolver per task (the editor and the view keep it across renders). */
export function taskFileUrlResolver(activityId: string): (fileId: string) => Promise<string> {
  const existing = resolvers.get(activityId)
  if (existing) return existing
  const resolver = async (fileId: string) => {
    const key = `${activityId}/${fileId}`
    const cached = urls.get(key)
    if (cached && cached.until > Date.now()) return cached.url
    const { url } = await getTaskFileUrl(activityId, fileId)
    urls.set(key, { url, until: Date.now() + URL_TTL_MS })
    return url
  }
  resolvers.set(activityId, resolver)
  return resolver
}

/** A new tab on the file (it downloads: the URL says so). False when it could not be opened. */
export async function openTaskFile(activityId: string, fileId: string): Promise<boolean> {
  try {
    const url = await taskFileUrlResolver(activityId)(fileId)
    window.open(url, '_blank', 'noopener')
    return true
  } catch {
    return false
  }
}

/** After the task exists: its removed and chosen files, through activities-api. */
export const saveDeferredFiles = (
  activityId: string,
  doc: RichTextDoc | null,
  files: DeferredFiles,
): Promise<CommittedFiles> =>
  commitDeferredFiles(doc, files, {
    upload: async (file, kind) => (await uploadTaskFile(activityId, file, kind)).id,
    remove: (fileId) => deleteTaskFile(activityId, fileId),
  })

/** The line a save with failed files ends on, or undefined when every file made it. */
export function filesWarning(saved: Pick<CommittedFiles, 'notUploaded' | 'notRemoved'>): string | undefined {
  const t = strings.tasks.files.errors
  if (saved.notUploaded.length > 0) return t.notUploaded(saved.notUploaded.join(', '))
  if (saved.notRemoved.length > 0) return t.notRemoved(saved.notRemoved.join(', '))
  return undefined
}
