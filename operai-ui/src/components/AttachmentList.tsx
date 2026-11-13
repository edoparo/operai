import { useRef } from 'react'
import { formatNumber } from '../lib/format'
import { Button } from './Button'
import { Icon } from './Icon'

export type AttachmentItem = {
  id: string
  name: string
  sizeBytes: number
  /** Chosen but not uploaded yet (shown, not downloadable). */
  pending?: boolean
}

export type AttachmentListProps = {
  items: readonly AttachmentItem[]
  /** Opens or downloads one; without it names are plain text. */
  onDownload?: (item: AttachmentItem) => void
  /** Removes one; without it there is no remove button (a reader). */
  onRemove?: (item: AttachmentItem) => void
  /** Adds files (the app checks and uploads them); without it there is no add button. */
  onAdd?: (files: File[]) => void
  /** The `accept` list of the file dialog: a hint to the browser, the app still checks each file. */
  accept?: string
  /** True while the app uploads: the add button shows it and waits. */
  adding?: boolean
  disabled?: boolean
  copy: {
    /** The add button ("Attach files"). */
    add: string
    /** The add button while `adding` ("Uploading…"). */
    adding: string
    /** Accessible name of a name button ("Download offer.pdf"). */
    download: (name: string) => string
    /** Accessible name of a remove button ("Remove offer.pdf"). */
    remove: (name: string) => string
    /** Shown after a pending file's size ("waiting to upload"). */
    pending?: string
  }
  /** Overrides the "2.4 MB" size text. */
  formatSize?: (bytes: number) => string
  /** Prefix of every `data-testid`: `<p>-list`, `<p>-item-<id>`, `<p>-download-<id>`, `<p>-remove-<id>`, `<p>-add`, `<p>-input`. */
  testIdPrefix: string
}

const KB = 1024

const defaultFormatSize = (bytes: number): string => {
  const [value, unit] =
    bytes < KB ? [bytes, 'byte'] : bytes < KB ** 2 ? [bytes / KB, 'kilobyte'] : [bytes / KB ** 2, 'megabyte']
  return formatNumber(value, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: unit === 'byte' ? 0 : 1,
  })
}

/**
 * AttachmentList — the files of a record as a compact list: each name (a button that downloads it,
 * when the app can), its size, and a remove button for whoever may; an add button that opens the
 * file dialog (several files at once). The list is the app's state: this component never uploads,
 * downloads or deletes, it asks. Nothing is shown for an empty list without `onAdd`.
 */
export function AttachmentList({
  items,
  onDownload,
  onRemove,
  onAdd,
  accept,
  adding = false,
  disabled = false,
  copy,
  formatSize = defaultFormatSize,
  testIdPrefix,
}: AttachmentListProps) {
  const input = useRef<HTMLInputElement>(null)
  if (items.length === 0 && !onAdd) return null
  return (
    <div className="attachment-list" data-testid={`${testIdPrefix}-list`}>
      {items.length > 0 && (
        <ul className="attachment-list-items">
          {items.map((item) => (
            <li key={item.id} className="attachment-list-item" data-testid={`${testIdPrefix}-item-${item.id}`}>
              <Icon name="paperclip" />
              {onDownload && !item.pending ? (
                <button
                  type="button"
                  className="attachment-list-name attachment-list-link"
                  aria-label={copy.download(item.name)}
                  onClick={() => onDownload(item)}
                  data-testid={`${testIdPrefix}-download-${item.id}`}
                >
                  {item.name}
                </button>
              ) : (
                <span className="attachment-list-name">{item.name}</span>
              )}
              <span className="attachment-list-meta">
                {formatSize(item.sizeBytes)}
                {item.pending && copy.pending ? ` · ${copy.pending}` : ''}
              </span>
              {onRemove && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={copy.remove(item.name)}
                  disabled={disabled}
                  onClick={() => onRemove(item)}
                  data-testid={`${testIdPrefix}-remove-${item.id}`}
                >
                  <Icon name="close" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {onAdd && (
        <div>
          <input
            ref={input}
            type="file"
            multiple
            accept={accept}
            className="sr-only"
            tabIndex={-1}
            aria-label={copy.add}
            data-testid={`${testIdPrefix}-input`}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              if (files.length > 0) onAdd(files)
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            busy={adding}
            disabled={disabled}
            onClick={() => input.current?.click()}
            data-testid={`${testIdPrefix}-add`}
          >
            <Icon name="paperclip" /> {adding ? copy.adding : copy.add}
          </Button>
        </div>
      )}
    </div>
  )
}
