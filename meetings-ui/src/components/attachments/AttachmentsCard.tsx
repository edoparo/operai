import { Badge, Banner, Button, Card, ConfirmDialog, Icon, SkeletonRows, VisuallyHidden, formatDate } from '@operai/ui'
import type { BadgeTone } from '@operai/ui'
import { useCallback, useRef, useState } from 'react'
import { useResource } from '../../hooks/useResource'
import { codeOf, errorMessage } from '../../lib/errors'
import {
  confirmAttachment,
  deleteAttachment,
  getAttachmentDownload,
  getAttachments,
  requestAttachmentUpload,
} from '../../lib/meetingsApi'
import type { Attachment, AttachmentAiContext, FileAttachment, PresignedPost } from '../../lib/types'
import { strings } from '../../strings'
import AddLinkDialog from './AddLinkDialog'
import { acceptList, contentTypeOf, formatFileSize, parseWebUrl, refusalOf } from './attachmentRules'

export type AttachmentsCardProps = {
  meetingId: string
  /** Leaves for a download URL; a test replaces it. */
  navigate?: (url: string) => void
}

const AI_TONE: Record<AttachmentAiContext, BadgeTone> = {
  used: 'accent',
  not_supported: 'neutral',
  too_large: 'warning',
  expired: 'warning',
  label_only: 'neutral',
}

/** The bucket refused (or could not be reached): the file never arrived, so it is not confirmed. */
class BucketFailed extends Error {}

/** Fields first, the file last, no credentials: this is the bucket, not meetings-api. */
async function postToBucket(policy: PresignedPost, file: File): Promise<void> {
  const form = new FormData()
  for (const [name, value] of Object.entries(policy.fields)) form.append(name, value)
  form.append('file', file, file.name)
  let response: Response
  try {
    response = await fetch(policy.url, { method: 'POST', body: form, credentials: 'omit' })
  } catch {
    throw new BucketFailed()
  }
  if (!response.ok) throw new BucketFailed()
}

const defaultNavigate = (url: string) => window.location.assign(url)

/**
 * AttachmentsCard — the files and links attached to a meeting, with what the AI does with each. Anyone
 * who can open the meeting sees and downloads them; an editor (the server's `can.edit`) adds files (one
 * by one: type and size checked here first, then the bucket, then a confirm), adds links and removes.
 * Files are kept 29 days; a link is text only, shown as a link just when it is http(s).
 */
export default function AttachmentsCard({ meetingId, navigate = defaultNavigate }: AttachmentsCardProps) {
  const t = strings.attachments
  const fetcher = useCallback((signal: AbortSignal) => getAttachments(meetingId, { signal }), [meetingId])
  const { status, data, retry, replace } = useResource(fetcher)

  const [uploading, setUploading] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [linkOpen, setLinkOpen] = useState(false)
  const [removing, setRemoving] = useState<Attachment | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /** Reads the list again and shows it without a skeleton. */
  const reload = useCallback(async () => {
    try {
      replace(await getAttachments(meetingId))
    } catch (failure) {
      setProblems((current) => [...current, errorMessage(failure)])
    }
  }, [meetingId, replace])

  const upload = async (files: File[]) => {
    if (data === null || files.length === 0) return
    const found: string[] = []
    const accepted: File[] = []
    for (const file of files) {
      const refusal = refusalOf(file, data.limits)
      if (refusal === null) accepted.push(file)
      else if (refusal === 'unsupportedType') found.push(t.refused.unsupportedType(file.name))
      else if (refusal === 'empty') found.push(t.refused.empty(file.name))
      else found.push(t.refused.tooLarge(file.name, formatFileSize(data.limits.maxFileBytes)))
    }
    setProblems([...found])
    for (const [index, file] of accepted.entries()) {
      setUploading(t.upload.uploading(file.name, index + 1, accepted.length))
      try {
        const { attachmentId, upload: policy } = await requestAttachmentUpload(meetingId, {
          name: file.name,
          contentType: contentTypeOf(file) ?? file.type,
          sizeBytes: file.size,
        })
        await postToBucket(policy, file)
        await confirmAttachment(meetingId, attachmentId)
      } catch (failure) {
        found.push(
          failure instanceof BucketFailed
            ? t.refused.bucketFailed(file.name)
            : t.refused.failed(file.name, errorMessage(failure)),
        )
        setProblems([...found])
      }
    }
    setUploading(null)
    await reload()
  }

  const download = async (item: FileAttachment) => {
    setDownloadingId(item.id)
    setProblems([])
    try {
      const { url } = await getAttachmentDownload(meetingId, item.id)
      navigate(url)
    } catch (failure) {
      setProblems([errorMessage(failure)])
      if (codeOf(failure) === 'attachment_expired' || codeOf(failure) === 'attachment_not_found') await reload()
    } finally {
      setDownloadingId(null)
    }
  }

  const confirmRemove = async () => {
    if (removing === null) return
    setRemoveBusy(true)
    setRemoveError(null)
    try {
      await deleteAttachment(meetingId, removing.id)
      setRemoving(null)
      await reload()
    } catch (failure) {
      setRemoveError(errorMessage(failure))
    } finally {
      setRemoveBusy(false)
    }
  }

  const editor = data?.can.edit === true
  const nameOf = (item: Attachment) => (item.kind === 'file' ? item.name : item.label !== '' ? item.label : item.url)

  return (
    <Card
      title={t.title}
      data-testid="meetings-attachments-card"
      action={
        editor ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              busy={uploading !== null}
              onClick={() => inputRef.current?.click()}
              data-testid="meetings-attachments-add-file"
            >
              <Icon name="upload" /> {t.addFile}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              aria-haspopup="dialog"
              disabled={uploading !== null}
              onClick={() => setLinkOpen(true)}
              data-testid="meetings-attachments-add-link"
            >
              <Icon name="external" /> {t.addLink}
            </Button>
          </div>
        ) : undefined
      }
    >
      {data === null ? (
        status === 'error' ? (
          <Banner tone="warning" onRetry={retry} retryLabel={t.reload}>
            {t.loadFailed}
          </Banner>
        ) : (
          <>
            <VisuallyHidden live>{t.loading}</VisuallyHidden>
            <SkeletonRows rows={2} />
          </>
        )
      ) : (
        <>
          <p className="mb-3 text-xs text-soft">{t.retention}</p>
          {data.attachments.length === 0 ? (
            <p className="text-sm text-soft" data-testid="meetings-attachments-empty">
              {editor ? t.emptyEditor : t.emptyReader}
            </p>
          ) : (
            <ul
              aria-label={t.listLabel}
              className="flex flex-col divide-y divide-rule"
              data-testid="meetings-attachments-list"
            >
              {data.attachments.map((item) => (
                <AttachmentRow
                  key={item.id}
                  item={item}
                  name={nameOf(item)}
                  editor={editor}
                  busy={downloadingId === item.id}
                  onDownload={(file) => void download(file)}
                  onRemove={() => {
                    setRemoveError(null)
                    setRemoving(item)
                  }}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {editor && data !== null && (
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          accept={acceptList(data.limits.contentTypes)}
          data-testid="meetings-attachments-input"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            void upload(files)
          }}
        />
      )}

      <VisuallyHidden live role="status">
        {uploading ?? ''}
      </VisuallyHidden>
      {uploading !== null && (
        <p className="mt-2 text-sm text-soft" data-testid="meetings-attachments-uploading">
          {uploading}
        </p>
      )}
      {problems.length > 0 && (
        <ul role="alert" className="form-error mt-2 flex flex-col gap-1" data-testid="meetings-attachments-error">
          {problems.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {linkOpen && (
        <AddLinkDialog
          meetingId={meetingId}
          onClose={() => setLinkOpen(false)}
          onAdded={() => {
            setProblems([])
            void reload()
          }}
        />
      )}
      {removing !== null && (
        <ConfirmDialog
          title={t.removeDialog.title}
          confirmLabel={t.removeDialog.confirm}
          busyLabel={t.removeDialog.removing}
          cancelLabel={strings.common.cancel}
          closeLabel={strings.common.close}
          busy={removeBusy}
          error={removeError}
          onConfirm={() => void confirmRemove()}
          onCancel={() => setRemoving(null)}
          testIdPrefix="meetings-attachments-remove"
        >
          {t.removeDialog.body(nameOf(removing))}
        </ConfirmDialog>
      )}
    </Card>
  )
}

type RowProps = {
  item: Attachment
  name: string
  editor: boolean
  busy: boolean
  onDownload: (file: FileAttachment) => void
  onRemove: () => void
}

function AttachmentRow({ item, name, editor, busy, onDownload, onRemove }: RowProps) {
  const t = strings.attachments
  const aiContext: AttachmentAiContext = item.kind === 'file' && item.expired ? 'expired' : item.aiContext
  const webUrl = item.kind === 'link' ? parseWebUrl(item.url) : null
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-3 py-2"
      data-testid={`meetings-attachment-${item.id}`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm">
          <Icon name={item.kind === 'file' ? 'file' : 'external'} />
          {webUrl !== null ? (
            <a
              href={webUrl.href}
              target="_blank"
              rel="noopener noreferrer"
              className="link break-all"
              aria-label={t.openLinkLabel(name)}
            >
              {name}
            </a>
          ) : (
            <span className="break-all">{name}</span>
          )}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-soft">
          {item.kind === 'file' && <span>{formatFileSize(item.sizeBytes)}</span>}
          <span>{t.addedOn(formatDate(item.addedAt))}</span>
          {item.kind === 'file' && (
            <span>{item.expired ? t.expiredFile : t.availableUntil(formatDate(item.expiresAt))}</span>
          )}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-soft">
          <Badge tone={AI_TONE[aiContext]} data-testid="meetings-attachment-ai">
            {t.ai[aiContext]}
          </Badge>
          {item.kind === 'file' && item.aiContext === 'not_supported' && !item.expired && (
            <span>{t.aiHint.not_supported}</span>
          )}
        </p>
      </div>
      <div className="flex gap-2">
        {item.kind === 'file' && !item.expired && (
          <Button
            variant="secondary"
            size="sm"
            busy={busy}
            aria-label={t.downloadLabel(item.name)}
            onClick={() => onDownload(item)}
            data-testid={`meetings-attachment-download-${item.id}`}
          >
            <Icon name="download" /> {t.download}
          </Button>
        )}
        {editor && (
          <Button
            variant="ghost"
            size="sm"
            aria-haspopup="dialog"
            aria-label={t.removeLabel(name)}
            onClick={onRemove}
            data-testid={`meetings-attachment-remove-${item.id}`}
          >
            <Icon name="trash" /> {t.remove}
          </Button>
        )}
      </div>
    </li>
  )
}
