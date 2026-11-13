import { useCallback, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { AttachmentList } from '../components/AttachmentList'
import type { AttachmentItem, AttachmentListProps } from '../components/AttachmentList'
import { RichTextEditor } from './RichTextEditor'
import type { RichTextDoc, RichTextEditorProps, RichTextImages } from './RichTextEditor'
import { isLocalFileId } from './deferredFiles'
import type { DeferredFile, DeferredFiles } from './deferredFiles'

export type RichTextFilesFieldProps = {
  /** The field's label ("Description"): names the text box. */
  label: string
  hint?: ReactNode
  error?: ReactNode
  initialValue: RichTextDoc | null
  onChange: (doc: RichTextDoc, textLength: number) => void
  placeholder?: string
  maxLength?: number
  /** The form's files (`useDeferredFiles`): pictures and attachments wait for the save. */
  files: DeferredFiles
  /** A URL for a STORED image (a local one is shown from its `blob:` URL). */
  resolveStoredUrl: (fileId: string) => Promise<string>
  /** Opens a stored attachment. */
  onDownload: (file: DeferredFile) => void
  imageAccept: string
  attachmentAccept: string
  /** Checks a chosen file before it is kept: null, or why it is refused (shown under the field). */
  check: (file: File, kind: DeferredFile['kind']) => string | null
  copy: {
    editor: RichTextEditorProps['copy']
    images: RichTextImages['copy']
    attachments: AttachmentListProps['copy'] & {
      /** The list's heading ("Attachments"). */
      title: string
    }
  }
  testIdPrefix: string
}

/**
 * RichTextFilesField — a record's rich text with its pictures and attachments, in a form that saves on
 * submit: the editor (pictures chosen, pasted or dropped are kept locally and placed by local id) and,
 * under it, the attachment list. Every chosen file is checked first (`check`) and waits in
 * `useDeferredFiles` until the app saves the record and uploads them; nothing is uploaded from here.
 */
export function RichTextFilesField({
  label,
  hint,
  error,
  initialValue,
  onChange,
  placeholder,
  maxLength,
  files,
  resolveStoredUrl,
  onDownload,
  imageAccept,
  attachmentAccept,
  check,
  copy,
  testIdPrefix,
}: RichTextFilesFieldProps) {
  const id = useId()
  const [refused, setRefused] = useState<string | null>(null)
  const { addImage, localUrl } = files

  const resolveUrl = useCallback(
    (fileId: string) => {
      if (!isLocalFileId(fileId)) return resolveStoredUrl(fileId)
      const url = localUrl(fileId)
      return url ? Promise.resolve(url) : Promise.reject(new Error('gone'))
    },
    [resolveStoredUrl, localUrl],
  )

  const images: RichTextImages = {
    accept: imageAccept,
    copy: copy.images,
    resolveUrl,
    upload: async (file) => {
      const problem = check(file, 'image')
      if (problem) throw new Error(problem)
      setRefused(null)
      return addImage(file)
    },
    onError: (failure) => setRefused(failure instanceof Error ? failure.message : String(failure)),
  }

  const attachments = files.files.filter((file) => file.kind === 'attachment')
  const items: AttachmentItem[] = attachments.map((file) => ({
    id: file.id,
    name: file.name,
    sizeBytes: file.sizeBytes,
    pending: !!file.local,
  }))
  const byId = new Map(attachments.map((file) => [file.id, file]))

  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const shownError = error ?? refused
  const describedBy = [hint ? hintId : null, shownError ? errorId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className="field" data-testid={`${testIdPrefix}-field`}>
      <span className="field-label" id={`${id}-label`}>
        {label}
      </span>
      <RichTextEditor
        initialValue={initialValue}
        onChange={onChange}
        label={label}
        {...(describedBy ? { describedBy } : {})}
        {...(placeholder ? { placeholder } : {})}
        {...(maxLength ? { maxLength } : {})}
        copy={copy.editor}
        images={images}
        testIdPrefix={testIdPrefix}
      />
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {shownError && (
        <p id={errorId} className="field-error" role="alert" data-testid={`${testIdPrefix}-error`}>
          {shownError}
        </p>
      )}
      <div className="rich-text-files" role="group" aria-label={copy.attachments.title}>
        <span className="field-label">{copy.attachments.title}</span>
        <AttachmentList
          items={items}
          accept={attachmentAccept}
          onAdd={(chosen) => {
            const problems = chosen
              .map((file) => check(file, 'attachment'))
              .filter((problem): problem is string => problem !== null)
            setRefused(problems[0] ?? null)
            files.addAttachments(chosen.filter((file) => check(file, 'attachment') === null))
          }}
          onRemove={(item) => {
            const file = byId.get(item.id)
            if (file) files.remove(file)
          }}
          onDownload={(item) => {
            const file = byId.get(item.id)
            if (file && !file.local) onDownload(file)
          }}
          copy={copy.attachments}
          testIdPrefix={`${testIdPrefix}-files`}
        />
      </div>
    </div>
  )
}
