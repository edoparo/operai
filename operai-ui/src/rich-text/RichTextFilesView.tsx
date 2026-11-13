import type { JSONContent } from '@tiptap/core'
import { AttachmentList } from '../components/AttachmentList'
import type { AttachmentItem, AttachmentListProps } from '../components/AttachmentList'
import { RichTextView } from './RichTextView'
import type { ResolveImageUrl, RichTextImageCopy } from './image'

export type RichTextFilesViewProps = {
  /** The description, or null (then only the attachments, if any, are shown). */
  doc: JSONContent | null
  /** The record's attachments (its images are shown inside the text). */
  attachments: readonly AttachmentItem[]
  resolveImageUrl: ResolveImageUrl
  onDownload: (item: AttachmentItem) => void
  copy: {
    images: RichTextImageCopy
    check: { done: string; todo: string }
    attachments: Pick<AttachmentListProps['copy'], 'download' | 'remove'> & { title: string }
  }
  testIdPrefix: string
}

/**
 * RichTextFilesView — a record's description and attachments, read-only: the text through
 * `RichTextView` (pictures resolved by the app) and, under it, the attachments as download links.
 * Renders nothing when there is neither.
 */
export function RichTextFilesView({ doc, attachments, resolveImageUrl, onDownload, copy, testIdPrefix }: RichTextFilesViewProps) {
  if (!doc && attachments.length === 0) return null
  return (
    <div className="rich-text-files-view" data-testid={`${testIdPrefix}-view`}>
      {doc && (
        <RichTextView doc={doc} resolveImageUrl={resolveImageUrl} imageCopy={copy.images} checkCopy={copy.check} testId={`${testIdPrefix}-text`} />
      )}
      {attachments.length > 0 && (
        <div className="rich-text-files" role="group" aria-label={copy.attachments.title}>
          <AttachmentList
            items={attachments}
            onDownload={onDownload}
            copy={{ add: '', adding: '', download: copy.attachments.download, remove: copy.attachments.remove }}
            testIdPrefix={`${testIdPrefix}-files`}
          />
        </div>
      )}
    </div>
  )
}
