import { useCallback, useRef, useState } from 'react'
import { Banner, Button, Card, ConfirmDialog, DataTable, Icon, StatePanel, formatDate } from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import {
  confirmAttachment,
  deleteAttachment,
  getAttachmentDownload,
  listAttachments,
  postToBucket,
  startAttachmentUpload,
} from '../lib/crmApi'
import { ATTACHMENT_ACCEPT, attachmentProblem, formatFileSize } from '../lib/attachments'
import { codeOf, errorMessage } from '../lib/errors'
import { personName } from '../lib/people'
import type { Attachment } from '../lib/types'
import { useCrmCapabilities } from '../hooks/scopeContext'
import { useCurrentUserId } from '../hooks/useCurrentUserId'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'
import { LoadFailure, Loading } from './LoadState'

function attachmentFailure(error: unknown): string {
  const t = strings.attachments.errors
  switch (codeOf(error)) {
    case 'attachment_type_not_allowed':
      return t.typeNotAllowed
    case 'attachment_too_large':
      return t.tooLarge
    case 'storage_unconfigured':
      return t.storageUnconfigured
    default:
      return errorMessage(error)
  }
}

/**
 * AttachmentsCard — files on the deal, for every `crm:access` holder (specs/20261101-crm-sales-flow
 * AC-4.3/4.4). Upload is three calls: crm-api issues a presigned POST, the
 * browser posts the file to the bucket with plain `fetch` (the bucket is not an
 * API origin and must never see the Bearer token), then crm-api confirms it.
 * Download is offered only when the server says `canDownload`.
 */
export default function AttachmentsCard({ dealId }: { dealId: string }) {
  const t = strings.attachments
  const currentUserId = useCurrentUserId()
  const { managesAll } = useCrmCapabilities()
  const load = useCallback((signal: AbortSignal) => listAttachments(dealId, { signal }), [dealId])
  const files = useResource(load)
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [storageMissing, setStorageMissing] = useState(false)
  const [deleting, setDeleting] = useState<Attachment | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const upload = async (file: File) => {
    setError(null)
    setNotice(null)
    const problem = attachmentProblem(file)
    if (problem) {
      setError(problem)
      return
    }
    setUploading(true)
    try {
      const started = await startAttachmentUpload(dealId, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      })
      try {
        await postToBucket(started.upload, file)
      } catch {
        setError(t.errors.uploadFailed)
        return
      }
      await confirmAttachment(dealId, started.attachmentId)
      setNotice(t.uploaded(file.name))
      files.retry()
    } catch (failure) {
      if (codeOf(failure) === 'storage_unconfigured') setStorageMissing(true)
      else setError(attachmentFailure(failure))
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ''
    }
  }

  const download = (attachment: Attachment) => {
    setError(null)
    getAttachmentDownload(dealId, attachment.id).then(
      ({ url }) => window.open(url, '_blank', 'noopener'),
      (failure: unknown) => setError(attachmentFailure(failure)),
    )
  }

  const remove = (attachment: Attachment) => {
    setBusy(true)
    setDeleteError(null)
    deleteAttachment(dealId, attachment.id).then(
      () => {
        setBusy(false)
        setDeleting(null)
        setNotice(t.deletedDone)
        files.retry()
      },
      (failure: unknown) => {
        setBusy(false)
        setDeleteError(attachmentFailure(failure))
      },
    )
  }

  const columns: DataTableColumn<Attachment>[] = [
    { id: 'file', header: t.columns.file, rowHeader: true, render: (file) => file.fileName },
    { id: 'size', header: t.columns.size, numeric: true, render: (file) => formatFileSize(file.sizeBytes) },
    { id: 'by', header: t.columns.uploadedBy, render: (file) => personName(file.uploadedBy, currentUserId) },
    { id: 'date', header: t.columns.date, render: (file) => formatDate(file.createdAt) },
    {
      id: 'actions',
      header: t.columns.actions,
      render: (file) => (
        <span className="flex gap-1">
          {file.canDownload ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t.downloadOf(file.fileName)}
              onClick={() => download(file)}
              data-testid={`crm-attachment-download-${file.id}`}
            >
              {t.download}
            </Button>
          ) : (
            <span className="text-xs text-soft">{t.noDownload}</span>
          )}
          {(file.uploadedBy.id === currentUserId || managesAll) && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t.deleteOf(file.fileName)}
              aria-haspopup="dialog"
              onClick={() => setDeleting(file)}
              data-testid={`crm-attachment-delete-${file.id}`}
            >
              {strings.common.delete}
            </Button>
          )}
        </span>
      ),
    },
  ]

  return (
    <Card
      title={t.title}
      data-testid="crm-attachments-card"
      action={
        !storageMissing && (
          <>
            <input
              ref={input}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              className="sr-only"
              aria-label={t.upload}
              tabIndex={-1}
              data-testid="crm-attachment-input"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void upload(file)
              }}
            />
            <Button
              size="sm"
              busy={uploading}
              onClick={() => input.current?.click()}
              data-testid="crm-attachment-upload"
            >
              <Icon name="upload" /> {uploading ? t.uploading : t.upload}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-soft">{t.hint}</p>
        {storageMissing && (
          <StatePanel title={t.storageMissingTitle} testId="crm-attachments-storage-missing">
            {t.storageMissingBody}
          </StatePanel>
        )}
        {error && (
          <Banner tone="danger" onDismiss={() => setError(null)} dismissLabel={strings.common.dismiss} data-testid="crm-attachments-error">
            {error}
          </Banner>
        )}
        {notice && (
          <Banner tone="success" compact autoDismiss onDismiss={() => setNotice(null)} dismissLabel={strings.common.dismiss}>
            {notice}
          </Banner>
        )}
        {files.status === 'loading' && <Loading label={t.loading} rows={2} />}
        {files.status === 'error' && <LoadFailure error={files.error} onRetry={files.retry} />}
        {files.status === 'ready' &&
          (files.data!.items.length === 0 ? (
            <p className="text-sm text-soft" data-testid="crm-attachments-empty">
              {t.empty}
            </p>
          ) : (
            <DataTable
              caption={t.caption}
              columns={columns}
              rows={files.data!.items}
              getRowKey={(file) => file.id}
              testId="crm-attachments-table"
            />
          ))}
      </div>
      {deleting && (
        <ConfirmDialog
          title={t.deleteDialog.title}
          confirmLabel={t.deleteDialog.confirm}
          busyLabel={t.deleteDialog.busy}
          cancelLabel={strings.common.cancel}
          closeLabel={strings.common.close}
          busy={busy}
          error={deleteError}
          onConfirm={() => remove(deleting)}
          onCancel={() => {
            setDeleting(null)
            setDeleteError(null)
          }}
          testIdPrefix="crm-attachment-delete-dialog"
        >
          {t.deleteDialog.body(deleting.fileName)}
        </ConfirmDialog>
      )}
    </Card>
  )
}
