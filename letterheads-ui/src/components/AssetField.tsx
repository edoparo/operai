import { useEffect, useRef, useState } from 'react'
import { Button, FilePicker, Icon, VisuallyHidden } from '@operai/ui'
import { ApiError } from '../lib/api'
import { useFieldError, useForm } from '../lib/formStateContext'
import type { Entity } from '../lib/types'
import { strings } from '../strings'
import { describeUploadError, fetchAssetImage, formatOfType, MAX_UPLOAD_BYTES, uploadAsset } from './AssetFieldApi'
import type { AssetKind, UploadedAsset } from './AssetFieldApi'

export interface AssetFieldProps {
  entity: Entity
  /** Which slot the file is for: the service keeps the kind with the asset and refuses one in the other slot. */
  kind: AssetKind
  /** The id of the asset the form holds in this slot, or `null` when the slot is empty. */
  assetId: string | null
  /** The JSON Pointer of the asset id (`…/logo/asset`, `…/background`): where a refused save is shown, and the control's `data-pointer`. */
  pointer: string
  label: string
  hint?: string
  /** "Remove logo" / "Remove background". */
  removeLabel: string
  /** What the thumbnail shows, for its text alternative ("Logo", "Background image"). */
  what: string
  /** The file was uploaded: the form now holds this asset in the slot (the version only gets it on save). */
  onUploaded: (asset: UploadedAsset) => void
  /** Remove: the form empties the slot. No request is made. */
  onRemove: () => void
}

/**
 * AssetField — a logo's or a background's file (design F5, S1; AC-7.1 to 7.4, 7.7). It wraps `FilePicker`,
 * which only picks:
 * - a file is posted at once (`POST /v1/letterheads/{entity}/assets`, kind logo or background); until the
 *   answer the picker shows the file and "Uploading…", and the rest of the form stays usable. Choosing
 *   another file, or clearing the picker, cancels the upload in flight;
 * - on success the form holds the asset (`onUploaded`), and a thumbnail replaces the empty state, fetched
 *   with the person's token and shown from an object URL (`<img src>` cannot carry the token);
 * - a refusal is a sentence of its own in the field's error line, announced (`role="alert"`), and the
 *   picker is idle again with the old file untouched. A file over 2 MiB is refused here without a request:
 *   a pre-check, the service is the authority. The file's name and type are never used to decide anything;
 * - Remove empties the slot (no request) and moves focus to Choose file.
 */
export function AssetField({
  entity,
  kind,
  assetId,
  pointer,
  label,
  hint,
  removeLabel,
  what,
  onUploaded,
  onRemove,
}: AssetFieldProps) {
  const { announce, accessLost } = useForm()
  // A refusal of a save for this slot (`asset_unknown`: the file is no longer there), in words.
  const saveError = useFieldError(pointer)
  const [pending, setPending] = useState<File | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState<UploadedAsset | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const attempt = useRef<AbortController | null>(null)
  const testId = `asset${pointer.replace(/\//g, '-')}`
  const chooseId = `${testId}-choose`
  // The answer of an upload belongs to the form as it is when the answer comes, not as it was when the file was chosen.
  const latest = useRef({ onUploaded, announce, accessLost })
  useEffect(() => {
    latest.current = { onUploaded, announce, accessLost }
  })

  // The picker's button is the control of this value: mark it, so a refused value finds it (design S4).
  useEffect(() => {
    root.current?.querySelector(`[data-testid="${chooseId}"]`)?.setAttribute('data-pointer', pointer)
  }, [chooseId, pointer])

  // Leaving (another entity, a variant switched off) abandons an upload in flight; the service sweeps what it stored.
  useEffect(() => () => attempt.current?.abort(), [])

  const cancel = () => {
    attempt.current?.abort()
    attempt.current = null
  }

  const pick = (file: File | null) => {
    cancel()
    setRefusal(null)
    if (file === null) {
      setPending(null)
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setPending(null)
      setRefusal(strings.upload.reason.too_many_bytes)
      return
    }
    const controller = new AbortController()
    attempt.current = controller
    setPending(file)
    uploadAsset(entity, kind, file, controller.signal).then(
      (asset) => {
        if (controller.signal.aborted) return
        attempt.current = null
        setPending(null)
        setUploaded(asset)
        latest.current.onUploaded(asset)
        latest.current.announce(strings.asset.uploaded)
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        attempt.current = null
        setPending(null)
        setRefusal(describeUploadError(error))
        // The grant is gone, not only this file refused: the whole page is read-only now (design F7.5, F10).
        if (error instanceof ApiError && error.status === 403) latest.current.accessLost?.()
      },
    )
  }

  const remove = () => {
    cancel()
    setPending(null)
    setRefusal(null)
    onRemove()
    root.current?.querySelector<HTMLElement>(`[data-testid="${chooseId}"]`)?.focus()
  }

  // The sentence of an upload that failed is announced; the one of a refused save is the summary's to announce (T24).
  const error = refusal !== null ? <span role="alert">{refusal}</span> : saveError

  return (
    <div ref={root} className="flex flex-col gap-3" aria-busy={pending !== null} data-asset-field={kind}>
      <FilePicker
        label={label}
        chooseLabel={strings.asset.choose}
        clearLabel={strings.asset.clear}
        emptyText={strings.asset.none}
        file={pending}
        onChange={pick}
        accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg"
        hint={hint}
        error={error}
        chooseTestId={chooseId}
        inputTestId={`${testId}-input`}
      />
      <VisuallyHidden live role="status">
        {pending !== null ? strings.asset.uploading : ''}
      </VisuallyHidden>
      {pending !== null && (
        <p className="text-sm text-soft" aria-hidden="true">
          {strings.asset.uploading}
        </p>
      )}
      {assetId !== null && (
        <CurrentFile
          key={assetId}
          assetId={assetId}
          uploaded={uploaded?.id === assetId ? uploaded : null}
          what={what}
          removeLabel={removeLabel}
          onRemove={remove}
        />
      )}
    </div>
  )
}

type Thumbnail = { id: string } & ({ status: 'ready'; url: string; type: string } | { status: 'failed' })

/**
 * The stored bytes of an asset as an object URL for an `<img>`. Aborted, and the URL released, when the id
 * changes or the field goes; an answer for another id is never shown. `null` while it loads.
 */
function useThumbnail(id: string): Thumbnail | null {
  const [outcome, setOutcome] = useState<Thumbnail | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let url: string | null = null
    fetchAssetImage(id, controller.signal).then(
      (blob) => {
        if (controller.signal.aborted) return
        url = URL.createObjectURL(blob)
        setOutcome({ id, status: 'ready', url, type: blob.type })
      },
      () => {
        if (!controller.signal.aborted) setOutcome({ id, status: 'failed' })
      },
    )
    return () => {
      controller.abort()
      if (url !== null) URL.revokeObjectURL(url)
    }
  }, [id])
  return outcome?.id === id ? outcome : null
}

/** "Current file: PNG, 400 × 150 px": what the service said on upload, else what the thumbnail shows. */
function currentLine(uploaded: UploadedAsset | null, type: string | null, measured: { w: number; h: number } | null) {
  const format = uploaded?.format ?? (type === null ? null : formatOfType(type))
  if (format === null) return null
  if (format === 'svg') return strings.asset.currentSvg
  const width = uploaded?.width ?? measured?.w ?? null
  const height = uploaded?.height ?? measured?.h ?? null
  const name = format.toUpperCase()
  return width !== null && height !== null
    ? strings.asset.current(name, width, height)
    : strings.asset.currentFormat(name)
}

function CurrentFile({
  assetId,
  uploaded,
  what,
  removeLabel,
  onRemove,
}: {
  assetId: string
  uploaded: UploadedAsset | null
  what: string
  removeLabel: string
  onRemove: () => void
}) {
  const thumbnail = useThumbnail(assetId)
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null)
  const [broken, setBroken] = useState(false)
  const line = currentLine(uploaded, thumbnail?.status === 'ready' ? thumbnail.type : null, measured)
  const failed = broken || thumbnail?.status === 'failed'
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="asset-current">
      {thumbnail?.status === 'ready' && !broken ? (
        <img
          src={thumbnail.url}
          alt={strings.asset.thumbAlt(what)}
          className="max-h-20 max-w-40 rounded border border-muted bg-paper object-contain"
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget
            if (naturalWidth > 0 && naturalHeight > 0) setMeasured({ w: naturalWidth, h: naturalHeight })
          }}
          onError={() => setBroken(true)}
        />
      ) : failed ? (
        <p className="text-sm text-soft" data-testid="asset-thumbnail-failed">
          {strings.asset.thumbFailed}
        </p>
      ) : (
        <span aria-hidden="true" className="h-16 w-24 rounded border border-muted bg-ink-mid" />
      )}
      <div className="flex flex-col items-start gap-2">
        {line !== null && <p className="text-sm text-soft">{line}</p>}
        <Button size="sm" variant="ghost" onClick={onRemove}>
          <Icon name="trash" /> {removeLabel}
        </Button>
      </div>
    </div>
  )
}
