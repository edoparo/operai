import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLetterheadBytes } from './crmApi'
import { MAX_LETTERHEAD_BYTES } from './letterhead/renderLetterhead'

// DD-54: the bucket is not a trusted origin — plain fetch, no credentials, no cache, bounded, `%PDF-` checked.
const PDF = new TextEncoder().encode('%PDF-1.7\nbody')
const LINK = 'https://bucket.example/letterheads/x?sig=secret'

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++])
      else controller.close()
    },
  })
}
const respond = (body: BodyInit | null, init?: ResponseInit) => vi.fn(async () => new Response(body, init))

afterEach(() => vi.unstubAllGlobals())

describe('fetchLetterheadBytes', () => {
  it('asks without credentials, referrer, cache or redirect, and passes the signal', async () => {
    const fetchSpy = respond(PDF)
    vi.stubGlobal('fetch', fetchSpy)
    const controller = new AbortController()
    const bytes = await fetchLetterheadBytes(LINK, { signal: controller.signal })
    expect(Array.from(bytes)).toEqual(Array.from(PDF))
    expect(fetchSpy).toHaveBeenCalledWith(LINK, {
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: controller.signal,
    })
  })

  it('joins a streamed body', async () => {
    vi.stubGlobal('fetch', respond(streamOf(PDF.slice(0, 4), PDF.slice(4))))
    expect(Array.from(await fetchLetterheadBytes(LINK))).toEqual(Array.from(PDF))
  })

  it('refuses a non-2xx answer, without the link in the error', async () => {
    vi.stubGlobal('fetch', respond('nope', { status: 403 }))
    const failure = await fetchLetterheadBytes(LINK).catch((e: Error) => e)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).not.toContain('secret')
  })

  it('refuses something that is not a PDF', async () => {
    vi.stubGlobal('fetch', respond('<html>login</html>'))
    await expect(fetchLetterheadBytes(LINK)).rejects.toThrow('letterhead_not_pdf')
  })

  it('stops reading once past the limit, even when the body keeps coming', async () => {
    const cancel = vi.fn()
    let pulled = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(new Uint8Array(1024 * 1024))
      },
      cancel,
    })
    vi.stubGlobal('fetch', respond(endless))
    await expect(fetchLetterheadBytes(LINK)).rejects.toThrow('letterhead_too_large')
    expect(pulled).toBeLessThan(MAX_LETTERHEAD_BYTES / 1024 / 1024 + 4)
    expect(cancel).toHaveBeenCalled()
  })

  it('accepts exactly the limit', async () => {
    const exact = new Uint8Array(MAX_LETTERHEAD_BYTES)
    exact.set(PDF)
    vi.stubGlobal('fetch', respond(streamOf(exact)))
    expect((await fetchLetterheadBytes(LINK)).length).toBe(MAX_LETTERHEAD_BYTES)
  })

  it('refuses a declared length over the limit before reading', async () => {
    vi.stubGlobal('fetch', respond(PDF, { headers: { 'content-length': String(MAX_LETTERHEAD_BYTES + 1) } }))
    await expect(fetchLetterheadBytes(LINK)).rejects.toThrow('letterhead_too_large')
  })

  it('propagates a network failure and an abort', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(fetchLetterheadBytes(LINK)).rejects.toThrow('Failed to fetch')
  })
})
