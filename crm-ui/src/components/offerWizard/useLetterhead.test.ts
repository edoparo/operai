/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entity } from '../../lib/types'

// DD-54 (specs/20261115-crm-offer-wizard): one letterhead attempt per opening and entity, owned by the page.
// The network, the renderer and the browser's image decoder are doubles; their contracts have their own tests.
const getLetterheadDownload = vi.fn()
const fetchLetterheadBytes = vi.fn()
const renderLetterhead = vi.fn()
vi.mock('../../lib/crmApi', () => ({
  getLetterheadDownload: (...args: unknown[]) => getLetterheadDownload(...args),
  fetchLetterheadBytes: (...args: unknown[]) => fetchLetterheadBytes(...args),
}))
vi.mock('../../lib/letterhead/renderLetterhead', () => ({
  renderLetterhead: (...args: unknown[]) => renderLetterhead(...args),
}))

import { ApiError } from '../../lib/api'
import { LETTERHEAD_BUDGET_MS, useLetterhead } from './useLetterhead'

const LINK = 'https://bucket.example/letterheads/secret-link?sig=abc'
let decode: ReturnType<typeof vi.fn>
const created: string[] = []
const revoked: string[] = []

beforeEach(() => {
  getLetterheadDownload.mockReset().mockResolvedValue({ url: LINK })
  fetchLetterheadBytes.mockReset().mockResolvedValue(new Uint8Array([1]))
  renderLetterhead.mockReset().mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
  decode = vi.fn(async () => {})
  vi.stubGlobal(
    'Image',
    class {
      src = ''
      decode = decode
    },
  )
  created.length = 0
  revoked.length = 0
  let n = 0
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:letterhead-${++n}`
    created.push(url)
    return url
  })
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Props = { entity: Entity; present: boolean | null }
const mount = (props: Props) => renderHook((p: Props) => useLetterhead(p), { initialProps: props })

describe('useLetterhead', () => {
  it('shown: link, bytes, render, decode, then the blob URL', async () => {
    const { result } = mount({ entity: 'welld_ch', present: true })
    expect(result.current.state).toBe('pending')
    act(() => result.current.request())
    await waitFor(() => expect(result.current.state).toBe('shown'))
    expect(result.current.src).toBe('blob:letterhead-1')
    expect(getLetterheadDownload).toHaveBeenCalledWith(
      'welld_ch',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(fetchLetterheadBytes).toHaveBeenCalledWith(
      LINK,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('starts nothing until a preview asks, and stays pending', async () => {
    const { result } = mount({ entity: 'welld_ch', present: true })
    await act(async () => {})
    expect(result.current).toMatchObject({ state: 'pending' })
    expect(result.current.src).toBeUndefined()
    expect(getLetterheadDownload).not.toHaveBeenCalled()
  })

  it('present: false is none at once and makes no request', async () => {
    const { result } = mount({ entity: 'welld_ch', present: false })
    expect(result.current.state).toBe('none')
    act(() => result.current.request())
    await act(async () => {})
    expect(result.current.state).toBe('none')
    expect(getLetterheadDownload).not.toHaveBeenCalled()
  })

  it('present: null (not known yet) stays pending and starts nothing, even when asked', async () => {
    const { result } = mount({ entity: 'welld_ch', present: null })
    act(() => result.current.request())
    await act(async () => {})
    expect(result.current.state).toBe('pending')
    expect(getLetterheadDownload).not.toHaveBeenCalled()
  })

  it('a request made while unknown is honoured once the answer is true, and once false it is none', async () => {
    const { result, rerender } = mount({ entity: 'welld_ch', present: null })
    act(() => result.current.request())
    rerender({ entity: 'welld_ch', present: true })
    await waitFor(() => expect(result.current.state).toBe('shown'))
    expect(getLetterheadDownload).toHaveBeenCalledTimes(1)

    const other = mount({ entity: 'welld_it', present: null })
    act(() => other.result.current.request())
    other.rerender({ entity: 'welld_it', present: false })
    await act(async () => {})
    expect(other.result.current.state).toBe('none')
    expect(getLetterheadDownload).toHaveBeenCalledTimes(1)
  })

  it('does not fetch again on re-render, a second request or a settled result', async () => {
    const { result, rerender } = mount({ entity: 'welld_ch', present: true })
    act(() => result.current.request())
    act(() => result.current.request())
    await waitFor(() => expect(result.current.state).toBe('shown'))
    rerender({ entity: 'welld_ch', present: true })
    act(() => result.current.request())
    await act(async () => {})
    expect(getLetterheadDownload).toHaveBeenCalledTimes(1)
    expect(fetchLetterheadBytes).toHaveBeenCalledTimes(1)
    expect(renderLetterhead).toHaveBeenCalledTimes(1)
    expect(created).toHaveLength(1)
  })

  it('keeps one attempt per entity: switching back reuses the settled result', async () => {
    const { result, rerender } = mount({ entity: 'welld_ch', present: true })
    act(() => result.current.request())
    await waitFor(() => expect(result.current.state).toBe('shown'))
    rerender({ entity: 'welld_it', present: true })
    expect(result.current.state).toBe('pending')
    await waitFor(() => expect(result.current.state).toBe('shown'))
    rerender({ entity: 'welld_ch', present: true })
    expect(result.current.src).toBe('blob:letterhead-1')
    expect(getLetterheadDownload).toHaveBeenCalledTimes(2)
  })

  describe('failed, quietly and without a retry', () => {
    const cases: [string, () => void][] = [
      [
        'link 403',
        () => getLetterheadDownload.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 })),
      ],
      ['link 404', () => getLetterheadDownload.mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }))],
      ['network error on the link', () => getLetterheadDownload.mockRejectedValue(new TypeError('Failed to fetch'))],
      ['bucket refusal', () => fetchLetterheadBytes.mockRejectedValue(new Error('letterhead_unavailable'))],
      ['oversize', () => fetchLetterheadBytes.mockRejectedValue(new Error('letterhead_too_large'))],
      ['not a PDF', () => fetchLetterheadBytes.mockRejectedValue(new Error('letterhead_not_pdf'))],
      ['render throws', () => renderLetterhead.mockRejectedValue(new Error('bad pdf'))],
      ['image cannot be decoded', () => decode.mockRejectedValue(new Error('EncodingError'))],
    ]
    it.each(cases)('%s', async (_name, arrange) => {
      arrange()
      const { result, rerender } = mount({ entity: 'welld_ch', present: true })
      act(() => result.current.request())
      await waitFor(() => expect(result.current.state).toBe('failed'))
      expect(result.current.src).toBeUndefined()
      // no retry: not on a re-render, not on another request
      rerender({ entity: 'welld_ch', present: true })
      act(() => result.current.request())
      await act(async () => {})
      expect(result.current.state).toBe('failed')
      expect(getLetterheadDownload).toHaveBeenCalledTimes(1)
      // a blob URL made for an image that then failed to decode is not left behind
      expect(revoked.sort()).toEqual(created.sort())
    })
  })

  describe('unusable (security M-4, DD-76): the link answers 409 letterhead_unusable', () => {
    const unusable = (code = 'letterhead_unusable', status = 409) =>
      new ApiError({ status, title: 'Conflict', code, extras: { entity: 'welld_ch', reason: 'decoded_too_large' } })

    it('is a distinct outcome, not a failed one, and is never retried', async () => {
      getLetterheadDownload.mockRejectedValue(unusable())
      const { result, rerender } = mount({ entity: 'welld_ch', present: true })
      act(() => result.current.request())
      await waitFor(() => expect(result.current.state).toBe('unusable'))
      expect(result.current.src).toBeUndefined()
      rerender({ entity: 'welld_ch', present: true })
      act(() => result.current.request())
      await act(async () => {})
      expect(result.current.state).toBe('unusable')
      expect(getLetterheadDownload).toHaveBeenCalledTimes(1)
      expect(fetchLetterheadBytes).not.toHaveBeenCalled()
    })

    it.each([
      ['another 409 code', unusable('version_conflict')],
      ['the code with another status', unusable('letterhead_unusable', 422)],
      ['the code on a plain Error', Object.assign(new Error('x'), { code: 'letterhead_unusable', status: 409 })],
    ])('%s stays an ordinary failure', async (_name, error) => {
      getLetterheadDownload.mockRejectedValue(error)
      const { result } = mount({ entity: 'welld_ch', present: true })
      act(() => result.current.request())
      await waitFor(() => expect(result.current.state).toBe('failed'))
    })

    it('is kept per entity: the other entity still gets its own attempt', async () => {
      getLetterheadDownload.mockRejectedValueOnce(unusable())
      const { result, rerender } = mount({ entity: 'welld_ch', present: true })
      act(() => result.current.request())
      await waitFor(() => expect(result.current.state).toBe('unusable'))
      rerender({ entity: 'welld_it', present: true })
      await waitFor(() => expect(result.current.state).toBe('shown'))
      rerender({ entity: 'welld_ch', present: true })
      expect(result.current.state).toBe('unusable')
    })
  })

  it('fails when the whole attempt takes longer than the budget, and aborts what is in flight', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    getLetterheadDownload.mockImplementation((_entity: Entity, init: { signal: AbortSignal }) => {
      signal = init.signal
      return new Promise(() => {})
    })
    const { result } = mount({ entity: 'welld_ch', present: true })
    act(() => result.current.request())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LETTERHEAD_BUDGET_MS - 1)
    })
    expect(result.current.state).toBe('pending')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(result.current.state).toBe('failed')
    expect(signal?.aborted).toBe(true)
    expect(getLetterheadDownload).toHaveBeenCalledTimes(1)
  })

  it('counts the decode inside the budget', async () => {
    vi.useFakeTimers()
    decode.mockImplementation(() => new Promise(() => {}))
    const { result } = mount({ entity: 'welld_ch', present: true })
    act(() => result.current.request())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LETTERHEAD_BUDGET_MS)
    })
    expect(result.current.state).toBe('failed')
    expect(revoked).toEqual(created)
  })

  it('a browser without Image.decode falls back to load and error events', async () => {
    const handlers: { onload?: () => void; onerror?: () => void } = {}
    vi.stubGlobal(
      'Image',
      class {
        set onload(fn: () => void) {
          handlers.onload = fn
        }
        set onerror(fn: () => void) {
          handlers.onerror = fn
        }
        set src(_: string) {
          queueMicrotask(() => handlers.onerror?.())
        }
      },
    )
    const { result } = mount({ entity: 'welld_ch', present: true })
    act(() => result.current.request())
    await waitFor(() => expect(result.current.state).toBe('failed'))
  })

  it('revokes its blob URL and aborts when the owner unmounts', async () => {
    const { result, unmount } = mount({ entity: 'welld_ch', present: true })
    act(() => result.current.request())
    await waitFor(() => expect(result.current.state).toBe('shown'))
    expect(revoked).toEqual([])
    unmount()
    expect(revoked).toEqual(['blob:letterhead-1'])
  })

  it('an unmount during the attempt aborts it and leaves no blob URL', async () => {
    let signal: AbortSignal | undefined
    getLetterheadDownload.mockImplementation((_entity: Entity, init: { signal: AbortSignal }) => {
      signal = init.signal
      return new Promise(() => {})
    })
    const { result, unmount } = mount({ entity: 'welld_ch', present: true })
    act(() => result.current.request())
    await act(async () => {})
    unmount()
    expect(signal?.aborted).toBe(true)
    expect(created).toEqual([])
  })

  it('an unmount while the image decodes revokes the URL it had made', async () => {
    let finish: () => void = () => {}
    decode.mockImplementation(() => new Promise<void>((ok) => (finish = ok)))
    const { result, unmount } = mount({ entity: 'welld_ch', present: true })
    act(() => result.current.request())
    await waitFor(() => expect(created).toHaveLength(1))
    unmount()
    finish()
    await Promise.resolve()
    expect(revoked).toEqual(created)
  })

  it('never writes browser storage and never logs the link', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const logs = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'info'),
    ]
    fetchLetterheadBytes.mockRejectedValue(new Error(`boom ${LINK}`))
    const { result } = mount({ entity: 'welld_ch', present: true })
    act(() => result.current.request())
    await waitFor(() => expect(result.current.state).toBe('failed'))
    expect(setItem).not.toHaveBeenCalled()
    for (const spy of logs) expect(spy).not.toHaveBeenCalled()
  })
})
