import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The contract of DD-53 (specs/20261115-crm-offer-wizard): what pdf.js is asked to do, and that nothing is left open.
// pdf.js itself is mocked (jsdom has no canvas); the real library is exercised by the L0 spike under the production CSP.
const order: string[] = []
const taskDestroy = vi.fn(async () => {})
const render = vi.fn(() => ({ promise: Promise.resolve() }))
let viewport1 = { width: 595.28, height: 841.89 }
const getDocument = vi.fn((params: Record<string, unknown>) => {
  order.push('getDocument')
  void params
  return {
    promise: Promise.resolve({
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: viewport1.width * scale,
          height: viewport1.height * scale,
        }),
        render,
      }),
    }),
    destroy: taskDestroy,
  }
})

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs', () => {
  order.push('worker')
  return {}
})
vi.mock('pdfjs-dist', () => {
  order.push('main')
  return { getDocument, VerbosityLevel: { ERRORS: 0 }, AnnotationMode: { DISABLE: 0, ENABLE: 1 } }
})

import {
  LETTERHEAD_RENDER_WIDTH_PX,
  MAX_LETTERHEAD_BYTES,
  MAX_LETTERHEAD_CANVAS_PIXELS,
  planLetterheadCanvas,
  renderLetterhead,
} from './renderLetterhead'

const pdf = (extra = 16) => {
  const b = new Uint8Array(5 + extra)
  b.set([0x25, 0x50, 0x44, 0x46, 0x2d])
  return b
}

const context = { id: 'ctx' }
const getContext = vi.fn((kind: string, options?: unknown) => {
  void kind
  void options
  return context as unknown
})
let canvas: {
  width: number
  height: number
  toBlob: (cb: (b: Blob | null) => void) => void
  getContext: typeof getContext
}
let toBlobResult: Blob | null

beforeEach(() => {
  vi.clearAllMocks()
  viewport1 = { width: 595.28, height: 841.89 }
  toBlobResult = new Blob(['png'], { type: 'image/png' })
  getContext.mockImplementation(() => context)
  canvas = { width: 0, height: 0, toBlob: (cb) => cb(toBlobResult), getContext }
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
})
afterEach(() => vi.unstubAllGlobals())

describe('renderLetterhead', () => {
  it('rejects a file that is not a PDF before loading pdf.js', async () => {
    await expect(
      renderLetterhead(new TextEncoder().encode('<html>nope</html>'), new AbortController().signal),
    ).rejects.toThrow('letterhead_not_pdf')
    expect(getDocument).not.toHaveBeenCalled()
  })

  it('rejects more than 5 MiB before loading pdf.js', async () => {
    const big = new Uint8Array(MAX_LETTERHEAD_BYTES + 1)
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d])
    await expect(renderLetterhead(big, new AbortController().signal)).rejects.toThrow('letterhead_too_large')
    expect(getDocument).not.toHaveBeenCalled()
  })

  it('imports the worker module before pdf.js so no Worker is constructed', async () => {
    vi.resetModules() // the mocks' factories run again on the next import, in the order the module asks for them
    order.length = 0
    const fresh = await import('./renderLetterhead')
    await fresh.renderLetterhead(pdf(), new AbortController().signal)
    expect(order.indexOf('worker')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('worker')).toBeLessThan(order.indexOf('main'))
  })

  it('hands pdf.js the bytes and nothing that makes it fetch, evaluate or load fonts', async () => {
    const bytes = pdf()
    await renderLetterhead(bytes, new AbortController().signal)
    const params = getDocument.mock.calls[0]![0]
    expect(params['data']).toBe(bytes)
    expect(params['disableFontFace']).toBe(true)
    expect(params['useSystemFonts']).toBe(false)
    expect(params['useWasm']).toBe(false)
    expect(params['disableRange']).toBe(true)
    expect(params['disableStream']).toBe(true)
    expect(params['disableAutoFetch']).toBe(true)
    // defence in depth (security M-4, DD-77): no image above 40 million pixels is decoded, whatever the server let by
    expect(params['maxImageSize']).toBe(40_000_000)
    // pdfjs-dist 5.x/6.x has no `isEvalSupported` option: nothing in the library evaluates code.
    for (const k of [
      'url',
      'isEvalSupported',
      'workerSrc',
      'worker',
      'standardFontDataUrl',
      'cMapUrl',
      'wasmUrl',
      'httpHeaders',
      'withCredentials',
    ])
      expect(params).not.toHaveProperty(k)
  })

  it('renders page 1 once at the fixed width on a transparent canvas and returns the PNG', async () => {
    const blob = await renderLetterhead(pdf(), new AbortController().signal)
    expect(blob).toBe(toBlobResult)
    expect(render).toHaveBeenCalledTimes(1)
    const args = (
      render.mock.calls[0] as unknown as [
        { canvas: unknown; background: string; annotationMode: number; viewport: { width: number } },
      ]
    )[0]
    expect(args.background).toBe('rgba(0,0,0,0)')
    expect(args.annotationMode).toBe(0) // AnnotationMode.DISABLE: no annotation appearance is drawn (security D23)
    // The context is ours and has an alpha channel: pdf.js opens a context it makes itself with alpha:false (black).
    expect(getContext).toHaveBeenCalledWith('2d')
    expect((args as unknown as { canvasContext: unknown }).canvasContext).toBe(context)
    expect(Math.round(args.viewport.width)).toBe(LETTERHEAD_RENDER_WIDTH_PX)
  })

  it('releases the canvas and the loading task after a render', async () => {
    await renderLetterhead(pdf(), new AbortController().signal)
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
    expect(taskDestroy).toHaveBeenCalled() // 6.x: destroying the loading task destroys the document
  })

  it('still destroys the document when pdf.js cannot draw the page', async () => {
    render.mockReturnValueOnce({ promise: Promise.reject(new Error('draw')) })
    await expect(renderLetterhead(pdf(), new AbortController().signal)).rejects.toThrow('draw')
    expect(taskDestroy).toHaveBeenCalled()
    expect(canvas.width).toBe(0)
  })

  it('fails, releasing the document, when there is no 2D context', async () => {
    getContext.mockImplementation(() => null)
    await expect(renderLetterhead(pdf(), new AbortController().signal)).rejects.toThrow('letterhead_canvas')
    expect(taskDestroy).toHaveBeenCalled()
  })

  it('fails when the canvas yields no PNG', async () => {
    toBlobResult = null
    await expect(renderLetterhead(pdf(), new AbortController().signal)).rejects.toThrow('letterhead_png')
    expect(taskDestroy).toHaveBeenCalled()
  })

  it.each([
    ['a crop box 16 pt wide (the L-6 repro)', 16, 841.89],
    ['a crop box 50 pt wide', 50, 841.89],
    ['a landscape page', 841.89, 595.28],
    ['US Letter', 612, 792],
    ['a huge page', 5000, 7000],
    ['a zero-size page', 0, 0],
    ['not a number', Number.NaN, Number.NaN],
  ])('refuses %s before allocating any canvas', async (_name, width, height) => {
    viewport1 = { width, height }
    await expect(renderLetterhead(pdf(), new AbortController().signal)).rejects.toThrow('letterhead_not_a4')
    expect(document.createElement).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
    expect(taskDestroy).toHaveBeenCalled()
  })

  it('accepts a page within 2 pt of A4 and no more', async () => {
    viewport1 = { width: 595.28 + 2, height: 841.89 - 2 }
    await expect(renderLetterhead(pdf(), new AbortController().signal)).resolves.toBeInstanceOf(Blob)
    viewport1 = { width: 595.28 + 2.5, height: 841.89 }
    await expect(renderLetterhead(pdf(), new AbortController().signal)).rejects.toThrow('letterhead_not_a4')
  })

  it('draws an A4 page well inside the canvas cap', () => {
    const plan = planLetterheadCanvas(595.28, 841.89)
    expect(plan.width).toBe(LETTERHEAD_RENDER_WIDTH_PX)
    expect(plan.width * plan.height).toBeLessThanOrEqual(MAX_LETTERHEAD_CANVAS_PIXELS)
    expect(MAX_LETTERHEAD_CANVAS_PIXELS).toBe(1600 * 2400)
    // the largest a within-tolerance page can be drawn
    const tall = planLetterheadCanvas(595.28 - 2, 841.89 + 2)
    expect(tall.width * tall.height).toBeLessThanOrEqual(MAX_LETTERHEAD_CANVAS_PIXELS)
  })

  it('rejects when already aborted, without touching pdf.js', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(renderLetterhead(pdf(), ac.signal)).rejects.toThrow()
    expect(getDocument).not.toHaveBeenCalled()
  })

  it('destroys the loading task when aborted while pdf.js is working', async () => {
    const ac = new AbortController()
    render.mockImplementationOnce(() => {
      ac.abort()
      return { promise: Promise.resolve() }
    })
    await expect(renderLetterhead(pdf(), ac.signal)).rejects.toThrow()
    expect(taskDestroy).toHaveBeenCalled()
    expect(taskDestroy).toHaveBeenCalled()
  })
})
