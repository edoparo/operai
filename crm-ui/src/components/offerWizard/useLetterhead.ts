import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchLetterheadBytes, getLetterheadDownload } from '../../lib/crmApi'
import { renderLetterhead } from '../../lib/letterhead/renderLetterhead'
import { letterheadUnusableOf } from '../../lib/offerErrors'
import type { Entity } from '../../lib/types'

/**
 * The letterhead behind the preview (specs/20261115-crm-offer-wizard DD-54, AC-11.4, 11.7–11.9; design F14, G11, G12).
 *
 * OWNERSHIP (design D-32). The page that opens the wizard (OfferWizardPage, or the editor's Try view) calls this hook
 * ONCE and hands `{ state, src, request }` down to the inline pane and to the Drawer. The attempt, its result and the
 * blob URL therefore live in that page's state and are shared by both previews; there is no module-level cache, so
 * a page mounted again is a new opening and tries again (AC-11.4 "tried again the next time"), and a person's
 * letterhead replaced since is never served from memory (AC-11.8).
 *
 * ONE attempt per opening and entity: link → bytes → render → decode, under one `LETTERHEAD_BUDGET_MS` budget, never
 * retried. The first preview that mounts calls `request()` (idempotent); the attempt only starts once the page also
 * knows the profile has a letterhead (`present === true`). The link and the bytes live in the attempt's closure alone:
 * not in state, storage or a log, and a failure's message is never read (only whether it is the link's 409
 * `letterhead_unusable`, by status and code, which settles the attempt as `unusable` instead of `failed`).
 */
export const LETTERHEAD_BUDGET_MS = 10_000

/**
 * `unusable` (security M-4, plan DD-76): the link answered 409 `letterhead_unusable` — the stored file fails the
 * service's bound, so generation is refused too. Not `failed`: "it is still added in the PDF" is untrue for it.
 */
export type LetterheadState = 'pending' | 'shown' | 'none' | 'failed' | 'unusable'
export type Letterhead = {
  state: LetterheadState
  /** The `blob:` URL of the decoded page image; only while `state` is `shown`. */
  src?: string
  /** A preview first needed the letterhead. Idempotent; starts nothing while `present` is unknown. */
  request: () => void
}
type Settled = { state: 'shown'; src: string } | { state: 'failed' } | { state: 'unusable' }

/**
 * Resolves with the image once the browser has decoded `src`, so `shown` is never an empty frame (G12). Rejects on abort.
 * The caller keeps the image referenced for the opening (DD-71): a page that appears paints the decoded bitmap at once.
 */
function decodeImage(src: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const abort = () => reject(new Error('aborted'))
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    const done = (ok: boolean) => {
      signal.removeEventListener('abort', abort)
      if (ok) resolve(image)
      else reject(new Error('undecodable'))
    }
    const image = new Image()
    if (typeof image.decode === 'function') {
      image.src = src
      image.decode().then(
        () => done(true),
        () => done(false),
      )
    } else {
      image.onload = () => done(true)
      image.onerror = () => done(false)
      image.src = src
    }
  })
}

export function useLetterhead({ entity, present }: { entity: Entity; present: boolean | null }): Letterhead {
  const [asked, setAsked] = useState(false)
  const [settled, setSettled] = useState<Partial<Record<Entity, Settled>>>({})
  const begun = useRef(new Set<Entity>())
  const urls = useRef(new Set<string>())
  // the decoded images, by url, for as long as the opening lasts (DD-71): never read, only kept alive
  const decoded = useRef(new Map<string, HTMLImageElement>())
  const request = useCallback(() => setAsked(true), [])

  const release = useCallback((url: string) => {
    decoded.current.delete(url)
    if (urls.current.delete(url)) URL.revokeObjectURL(url)
  }, [])

  useEffect(() => {
    const attempts = begun.current
    if (present !== true || !asked || attempts.has(entity)) return
    attempts.add(entity)
    const controller = new AbortController()
    const { signal } = controller
    const timer = setTimeout(() => controller.abort(), LETTERHEAD_BUDGET_MS)
    let live = true
    let done = false

    const run = async (): Promise<string> => {
      const { url } = await getLetterheadDownload(entity, { signal })
      const bytes = await fetchLetterheadBytes(url, { signal })
      const png = await renderLetterhead(bytes, signal)
      signal.throwIfAborted()
      const src = URL.createObjectURL(png)
      urls.current.add(src)
      try {
        decoded.current.set(src, await decodeImage(src, signal))
        signal.throwIfAborted()
      } catch (failure) {
        release(src)
        throw failure
      }
      return src
    }
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })

    const finish = (result: Settled) => {
      clearTimeout(timer)
      if (!live) {
        if (result.state === 'shown') release(result.src)
        return
      }
      done = true
      setSettled((all) => ({ ...all, [entity]: result }))
    }
    Promise.race([run(), aborted]).then(
      (src) => finish({ state: 'shown', src }),
      (failure: unknown) => finish({ state: letterheadUnusableOf(failure) ? 'unusable' : 'failed' }),
    )

    return () => {
      live = false
      clearTimeout(timer)
      controller.abort()
      // an attempt cut short by a changed input (not by its own end) is not an attempt made
      if (!done) attempts.delete(entity)
    }
  }, [entity, present, asked, release])

  useEffect(() => {
    const held = urls.current
    const images = decoded.current
    return () => {
      for (const url of held) URL.revokeObjectURL(url)
      held.clear()
      images.clear()
    }
  }, [])

  if (present === false) return { state: 'none', request }
  const result = settled[entity]
  if (result?.state === 'shown') return { state: 'shown', src: result.src, request }
  if (result?.state === 'failed') return { state: 'failed', request }
  if (result?.state === 'unusable') return { state: 'unusable', request }
  return { state: 'pending', request }
}
