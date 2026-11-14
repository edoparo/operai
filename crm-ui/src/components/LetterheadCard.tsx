import { useRef, useState } from 'react'
import { Banner, Button, Card, formatDate } from '@operai/ui'
import { confirmLetterhead, getLetterheadDownload, postToBucket, startLetterheadUpload } from '../lib/crmApi'
import { ApiError } from '../lib/api'
import { codeOf, errorMessage } from '../lib/errors'
import { personName } from '../lib/people'
import type { Entity, EntityProfile } from '../lib/types'
import { useCurrentUserId } from '../hooks/useCurrentUserId'
import { strings } from '../strings'

export const MAX_LETTERHEAD_BYTES = 5 * 1024 * 1024

function letterheadFailure(error: unknown): string {
  const t = strings.templates.letterhead.errors
  switch (codeOf(error)) {
    case 'letterhead_invalid': {
      const reason = error instanceof ApiError ? error.extras['reason'] : undefined
      return (typeof reason === 'string' ? t.invalid[reason] : undefined) ?? t.invalidFallback
    }
    case 'letterhead_key_invalid':
      return t.keyInvalid
    case 'upload_missing':
      return t.uploadMissing
    case 'storage_unconfigured':
      return t.storageUnconfigured
    case 'entity_profile_missing':
      return t.profileMissing
    default:
      return errorMessage(error)
  }
}

/**
 * LetterheadCard — the entity's letterhead PDF (specs/20261102-crm-offer-document AC-2.5): upload,
 * replace and download, with who uploaded it and when. Upload is three calls
 * like a deal attachment: crm-api issues a presigned POST, the browser posts the
 * file to the bucket with plain `fetch` (the bucket must never see the Bearer
 * token), then crm-api validates it (one readable A4 page) and swaps it in. A
 * refused file is deleted server-side and the old letterhead stays.
 */
export default function LetterheadCard({
  entity,
  profile,
  onChanged,
}: {
  entity: Entity
  profile: EntityProfile | null
  onChanged: (profile: EntityProfile) => void
}) {
  const t = strings.templates.letterhead
  const currentUserId = useCurrentUserId()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const letterhead = profile?.letterhead ?? null

  const upload = async (file: File) => {
    setError(null)
    setNotice(null)
    if (file.type !== 'application/pdf') return setError(t.errors.notPdf)
    if (file.size > MAX_LETTERHEAD_BYTES) return setError(t.errors.tooLarge)
    setBusy(true)
    try {
      const started = await startLetterheadUpload(entity)
      try {
        await postToBucket(started.upload, file)
      } catch {
        setError(t.errors.uploadFailed)
        return
      }
      onChanged(await confirmLetterhead(entity, started.key))
      setNotice(t.uploaded)
    } catch (failure) {
      setError(letterheadFailure(failure))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const download = () => {
    setError(null)
    getLetterheadDownload(entity).then(
      ({ url }) => window.open(url, '_blank', 'noopener'),
      (failure: unknown) => setError(letterheadFailure(failure)),
    )
  }

  return (
    <Card
      title={t.title(strings.badges.entity[entity])}
      data-testid={`crm-letterhead-${entity}`}
      action={
        <Button
          size="sm"
          variant="secondary"
          busy={busy}
          disabled={profile === null}
          onClick={() => input.current?.click()}
          data-testid={`crm-letterhead-${entity}-upload`}
        >
          {busy ? t.uploading : letterhead ? t.replace : t.upload}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-soft">{t.description}</p>
        {profile === null && <p className="text-xs text-soft">{t.needsProfile}</p>}
        {error && (
          <Banner
            tone="danger"
            onDismiss={() => setError(null)}
            dismissLabel={strings.common.dismiss}
            data-testid={`crm-letterhead-${entity}-error`}
          >
            {error}
          </Banner>
        )}
        {notice && (
          <Banner
            tone="success"
            compact
            autoDismiss
            onDismiss={() => setNotice(null)}
            dismissLabel={strings.common.dismiss}
          >
            {notice}
          </Banner>
        )}
        {letterhead ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-text" data-testid={`crm-letterhead-${entity}-by`}>
              {t.uploadedBy(personName(letterhead.uploadedBy, currentUserId), formatDate(letterhead.uploadedAt))}
            </span>
            <Button size="sm" variant="ghost" onClick={download} data-testid={`crm-letterhead-${entity}-download`}>
              {t.download}
            </Button>
          </div>
        ) : (
          profile !== null && <p className="text-sm text-soft">{t.none}</p>
        )}
        <input
          ref={input}
          type="file"
          accept="application/pdf"
          className="sr-only"
          aria-label={t.fileLabel}
          tabIndex={-1}
          data-testid={`crm-letterhead-${entity}-file`}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void upload(file)
          }}
        />
      </div>
    </Card>
  )
}
