import { Field, FormDialog } from '@operai/ui'
import { useState } from 'react'
import { errorMessage } from '../../lib/errors'
import { addAttachmentLink } from '../../lib/meetingsApi'
import { strings } from '../../strings'
import { parseWebUrl } from './attachmentRules'

const MAX_LABEL = 200

export type AddLinkDialogProps = {
  meetingId: string
  onClose: () => void
  onAdded: () => void
}

/** AddLinkDialog — an address (http or https, checked here and by the server) and an optional label. */
export default function AddLinkDialog({ meetingId, onClose, onAdded }: AddLinkDialogProps) {
  const t = strings.attachments.linkDialog
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [labelError, setLabelError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const trimmedUrl = url.trim()
    const trimmedLabel = label.trim()
    const nextUrlError = trimmedUrl === '' ? t.urlRequired : parseWebUrl(trimmedUrl) === null ? t.urlInvalid : null
    const nextLabelError = trimmedLabel.length > MAX_LABEL ? t.labelTooLong : null
    setUrlError(nextUrlError)
    setLabelError(nextLabelError)
    if (nextUrlError !== null || nextLabelError !== null) return
    setBusy(true)
    setError(null)
    try {
      await addAttachmentLink(meetingId, { url: trimmedUrl, ...(trimmedLabel !== '' ? { label: trimmedLabel } : {}) })
      onAdded()
      onClose()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title={t.title}
      description={t.description}
      submitLabel={t.submit}
      busyLabel={t.submitting}
      cancelLabel={strings.common.cancel}
      closeLabel={strings.common.close}
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      testIdPrefix="meetings-attachments-link-dialog"
    >
      <div className="flex flex-col gap-3">
        <Field label={t.urlLabel} hint={t.urlHint} error={urlError} required>
          {(control) => (
            <input
              {...control}
              type="url"
              inputMode="url"
              autoComplete="off"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              data-testid="meetings-attachments-link-url"
            />
          )}
        </Field>
        <Field label={t.labelLabel} hint={t.labelHint} error={labelError}>
          {(control) => (
            <input
              {...control}
              type="text"
              autoComplete="off"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              data-testid="meetings-attachments-link-label"
            />
          )}
        </Field>
      </div>
    </FormDialog>
  )
}
