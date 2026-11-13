import type { JSONContent } from '@tiptap/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { mapImageFileIds } from './doc'

/** A file of a record as a form shows it: stored on the server, or chosen here and not uploaded yet. */
export type DeferredFile = {
  id: string
  kind: 'image' | 'attachment'
  name: string
  sizeBytes: number
  /** Chosen in this form; `file` is what will be uploaded on save. */
  local?: { file: File }
}

const LOCAL_PREFIX = 'local:'

/** True for the id of a file chosen in this form and not uploaded yet. */
export const isLocalFileId = (id: string): boolean => id.startsWith(LOCAL_PREFIX)

export type DeferredFiles = {
  /** Every file the record will have after a save: stored ones not removed, then the chosen ones. */
  files: readonly DeferredFile[]
  /** Chosen here, to upload on save (in the order chosen). */
  pending: readonly DeferredFile[]
  /** Stored ones the person removed, to delete on save. */
  removed: readonly DeferredFile[]
  /** Keeps a picture for the text; returns the local id its image node carries until the save. */
  addImage: (file: File) => string
  addAttachments: (files: readonly File[]) => void
  remove: (file: DeferredFile) => void
  /** A `blob:` URL for a local image (revoked when the form goes away). */
  localUrl: (id: string) => string | undefined
}

/**
 * useDeferredFiles — the files of a form that saves them only on submit: pictures placed in the text and
 * attachments chosen in the list stay in the browser (shown from `blob:` URLs) until the app uploads them
 * after the record is saved, and removing a stored attachment only marks it. Nothing reaches the server
 * if the person cancels. The app does the uploads (it knows the record and its API); this hook only
 * keeps the list. See `mapImageFileIds` to swap the local ids in the document for the stored ones.
 */
export function useDeferredFiles(stored: readonly DeferredFile[]): DeferredFiles {
  const [pending, setPending] = useState<DeferredFile[]>([])
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set())
  const urls = useRef(new Map<string, string>())
  const counter = useRef(0)

  useEffect(() => {
    const map = urls.current
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url)
      map.clear()
    }
  }, [])

  const make = (file: File, kind: DeferredFile['kind']): DeferredFile => {
    counter.current += 1
    const id = `${LOCAL_PREFIX}${counter.current}-${file.name}`
    if (kind === 'image') urls.current.set(id, URL.createObjectURL(file))
    return { id, kind, name: file.name, sizeBytes: file.size, local: { file } }
  }

  return useMemo(() => {
    const kept = stored.filter((file) => !removedIds.has(file.id))
    return {
      files: [...kept, ...pending],
      pending,
      removed: stored.filter((file) => removedIds.has(file.id)),
      addImage: (file) => {
        const entry = make(file, 'image')
        setPending((current) => [...current, entry])
        return entry.id
      },
      addAttachments: (files) =>
        setPending((current) => [...current, ...files.map((file) => make(file, 'attachment'))]),
      remove: (file) => {
        if (file.local) {
          setPending((current) => current.filter((entry) => entry.id !== file.id))
          const url = urls.current.get(file.id)
          if (url) URL.revokeObjectURL(url)
          urls.current.delete(file.id)
        } else setRemovedIds((current) => new Set([...current, file.id]))
      },
      localUrl: (id) => urls.current.get(id),
    }
    // `make` only touches refs; the list changes with these three.
  }, [stored, pending, removedIds])
}

export type CommittedFiles = {
  /** The document with every local picture replaced by its stored id (or dropped, if its upload failed). */
  doc: JSONContent | null
  /** Names of chosen files that could not be uploaded. */
  notUploaded: string[]
  /** Names of removed files that could not be deleted. */
  notRemoved: string[]
}

/**
 * After the record exists: deletes what the person removed, uploads what they chose (in order), and
 * returns the document with each local picture swapped for its stored id. A failure is collected, never
 * thrown: the record is saved, and the person can be told which files did not make it.
 */
export async function commitDeferredFiles(
  doc: JSONContent | null,
  files: Pick<DeferredFiles, 'pending' | 'removed'>,
  api: { upload: (file: File, kind: DeferredFile['kind']) => Promise<string>; remove: (fileId: string) => Promise<void> },
): Promise<CommittedFiles> {
  const notRemoved: string[] = []
  for (const file of files.removed) {
    try {
      await api.remove(file.id)
    } catch {
      notRemoved.push(file.name)
    }
  }
  const stored = new Map<string, string>()
  const notUploaded: string[] = []
  for (const file of files.pending) {
    try {
      stored.set(file.id, await api.upload(file.local!.file, file.kind))
    } catch {
      notUploaded.push(file.name)
    }
  }
  const mapped = doc ? mapImageFileIds(doc, (id) => (isLocalFileId(id) ? (stored.get(id) ?? null) : id)) : null
  return { doc: mapped, notUploaded, notRemoved }
}

/** The document with every picture not uploaded yet taken out: what a record can be saved with before its files. */
export const withoutLocalImages = (doc: JSONContent | null): JSONContent | null =>
  doc ? mapImageFileIds(doc, (id) => (isLocalFileId(id) ? null : id)) : null
