import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Skeleton } from '../Skeleton'
import { Spinner } from '../Spinner'

/** One page of the preview: the picture and the text the service drew on it. */
export type PreviewPage = {
  /** The page image as the service returned it: a base64 string (no `data:` prefix). */
  image: string
  /** The page's text in reading order, line breaks kept: the page's text alternative (AC-8.6, AC-10.5). */
  text: string
}

export type PagePreviewState = 'loading' | 'ready' | 'updating' | 'failed' | 'blocked'

export type PagePreviewLabels = {
  /** The region's accessible name ("Preview of the sample document"). */
  region: string
  /** Status row while there is nothing to show yet ("Preparing the preview…"). */
  loading: string
  /** Status row while the previous pages stay on screen ("Updating the preview…"). */
  updating: string
  /** Status row when the last request failed ("Could not update"). */
  failed: string
  /** Status row when there are pages ("4 pages"). */
  pageCount: (count: number) => string
  /** The text alternative of a page image ("Page 2 of 4"). */
  pageAlt: (page: number, total: number) => string
}

export type PagePreviewProps = {
  /** The pages to show. Kept as given while `updating`, `failed` or `blocked`: pass the previous pages, never `[]`, to keep them. */
  pages: readonly PreviewPage[]
  state: PagePreviewState
  labels: PagePreviewLabels
  /** The notice slot, above the pages: the consumer's `Banner` for a failed or refused preview. */
  children?: ReactNode
  /** Language of the page text (`it`, `en`), for the screen reader's voice. */
  lang?: string
  /** The image type of `PreviewPage.image`. Default `image/png`. */
  mediaType?: string
  /** Layout only: e.g. `max-h-[80vh]` inside a Drawer. */
  className?: string
  testId?: string
}

/** FNV-1a over the whole string: a cheap key, so an unchanged page keeps its DOM node. Collisions only cost a repaint. */
function hashOf(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${(hash >>> 0).toString(36)}-${text.length}`
}

/** Keys that follow the picture, not the position: a page inserted before another does not remount it. */
function pageKeys(pages: readonly PreviewPage[]): string[] {
  const seen = new Map<string, number>()
  return pages.map((page) => {
    const base = hashOf(page.image)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return `${base}.${n}`
  })
}

const PAGE = 'w-full max-w-[794px] mx-auto aspect-[210/297] bg-paper border border-muted'

/** The A4 placeholder: where the pages will be. A picture of paper, hidden from assistive technology. */
function Placeholder() {
  return (
    <div aria-hidden="true" data-testid="page-preview-placeholder" className={cx(PAGE, 'flex flex-col gap-3 p-[8%]')}>
      <Skeleton width="40%" height={14} />
      <Skeleton width="25%" height={10} />
      <div className="mt-6 flex flex-col gap-2">
        {[92, 88, 95, 70, 90, 84].map((w, i) => (
          <Skeleton key={i} width={`${w}%`} height={10} />
        ))}
      </div>
    </div>
  )
}

/**
 * PagePreview — a stack of page pictures (PNG, A4) for a preview that is made
 * elsewhere: the letterhead configurator and the CRM offer wizard.
 *
 * - The region is the single tab stop (it scrolls), named, with `aria-busy`
 *   while loading or updating. It has no live region; the status row is plain
 *   text. Notices go in `children` and carry their own politeness.
 * - Each page is a `figure`: `img alt="Page N of M"` plus a visually hidden
 *   `figcaption` with the page's text, so a screen-reader user reads the page
 *   number, then the page (AC-8.6, AC-10.5). Selecting and copying is not offered.
 * - Previous pages stay while `updating`, `failed` and `blocked`; a page whose
 *   image is unchanged keeps its DOM node. No state renders an empty region:
 *   without pages there is an A4 placeholder.
 * - The pages are pictures of paper: light in both themes, no filter or opacity.
 *
 * All copy comes in through `labels`.
 */
export function PagePreview({
  pages,
  state,
  labels,
  children,
  lang,
  mediaType = 'image/png',
  className,
  testId,
}: PagePreviewProps) {
  const keys = useMemo(() => pageKeys(pages), [pages])
  const busy = state === 'loading' || state === 'updating'
  const total = pages.length

  const status =
    state === 'loading' ? (
      <>
        <Spinner />
        <span>{labels.loading}</span>
      </>
    ) : state === 'updating' ? (
      <>
        <Spinner />
        <span>{labels.updating}</span>
      </>
    ) : state === 'failed' ? (
      <span>{labels.failed}</span>
    ) : null

  return (
    <div
      role="region"
      aria-label={labels.region}
      aria-busy={busy}
      tabIndex={0}
      data-state={state}
      data-testid={testId}
      className={cx('overflow-y-auto overscroll-contain [scrollbar-gutter:stable]', className)}
    >
      <div className="flex items-center justify-between gap-3 px-1 pb-2 text-xs text-soft">
        <span className="flex items-center gap-2" data-testid="page-preview-status">
          {status}
        </span>
        {total > 0 && <span>{labels.pageCount(total)}</span>}
      </div>
      {children}
      <div className="flex flex-col gap-4 bg-ink-mid p-4">
        {total === 0 ? (
          <Placeholder />
        ) : (
          pages.map((page, index) => (
            <figure key={keys[index]} className={cx(PAGE, 'relative m-0 overflow-hidden')}>
              <img
                src={`data:${mediaType};base64,${page.image}`}
                alt={labels.pageAlt(index + 1, total)}
                draggable={false}
                decoding="async"
                className="block h-full w-full select-none"
              />
              <figcaption className="visually-hidden" lang={lang} style={{ whiteSpace: 'pre-line' }}>
                {page.text}
              </figcaption>
            </figure>
          ))
        )}
      </div>
    </div>
  )
}
