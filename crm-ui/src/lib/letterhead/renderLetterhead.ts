// The ONLY importer of `pdfjs-dist` (specs/20261115-crm-offer-wizard, DD-53). Draws page 1 of an entity's
// letterhead PDF as an image for the offer preview. Everything here is chosen so that the renderer runs under
// the shell's CSP as it stands (`script-src` without `'unsafe-eval'` or `'wasm-unsafe-eval'`, no `worker-src`
// beyond `'self'`, `connect-src` without the bucket for pdf.js) and talks to nobody:
//  - main thread: the worker module is imported FIRST, which sets `globalThis.pdfjsWorker`; pdf.js then runs its
//    parser in-process and never constructs a `Worker` (a dedicated worker must be same-origin with the shell's
//    document, which a remote's chunk is not);
//  - no eval: pdf.js 5.x/6.x has no `new Function`/`eval` left and no `isEvalSupported` option (it was removed after
//    the CVE-2024-4367 class; checked at 5.7.284 in L0 and again at 6.4.299, security M-3), no font loading
//    (`disableFontFace`), no `workerSrc`, `standardFontDataUrl`, `cMapUrl` or `wasmUrl`, and `useWasm: false`:
//    it fetches nothing and instantiates no wasm module of its own. Only the page canvas is drawn: never the
//    annotation layer, the text layer, the scripting sandbox or the package's `web` viewer entry (GHSA-hq66-cqwq-w95j needs them;
//    `letterheadGuard.test.ts` fails if any appears).
//    (A PostScript-calculator function in a PDF makes pdf.js TRY `new WebAssembly.Module`, which the CSP refuses
//    inside a try/catch; it then interprets the function in JS. One reported violation, no failure.) We hand it
//    bytes, never a URL.
// Both pdf.js modules are lazy chunks of crm-ui, loaded only when a preview needs a letterhead that exists.
// The 1.2 MB `pdf.worker.min-*.js` in `dist/assets` is NOT dead weight (eval, QE I5): it is the lazy chunk of the
// `import('pdfjs-dist/build/pdf.worker.min.mjs')` below - pdf.js's parser, run on the main thread - and the ONLY copy of
// it in the build (the `./pdf.worker.mjs` inside pdf.js's `workerSrc` default is a string, never emitted). Dropping the
// import would make pdf.js `import()` that missing path. It is fetched only when a preview draws a letterhead.

/** What the bucket link may deliver (AC-11.4 "larger than the entity profile accepts"). */
export const MAX_LETTERHEAD_BYTES = 5 * 1024 * 1024
/** Width of the rendered page: about 193 dpi on A4. R23 allows 1240 if the main-thread render is slow. */
export const LETTERHEAD_RENDER_WIDTH_PX = 1600

/**
 * Page 1 must be A4 portrait as pdf.js will draw it (its viewport is the page's crop box, rotation applied, which can
 * differ from the MediaBox the server's `checkLetterhead` measures). The tolerance is the server's own: 2 pt.
 */
export const LETTERHEAD_A4_WIDTH_PT = 595.28
export const LETTERHEAD_A4_HEIGHT_PT = 841.89
export const LETTERHEAD_A4_TOLERANCE_PT = 2
/** Upper bound of the canvas we allocate: 1600 x 2400. A4 at the render width is 1600 x 2263, so this never bites a real one. */
export const MAX_LETTERHEAD_CANVAS_PIXELS = 1600 * 2400

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"

export function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes.length >= PDF_MAGIC.length && PDF_MAGIC.every((b, i) => bytes[i] === b)
}

/**
 * The canvas size for a page whose scale-1 viewport is `width` x `height` points, or a refusal. Pure; called before
 * any canvas exists, so a hostile crop box never reaches an allocation (security L-6).
 */
export function planLetterheadCanvas(width: number, height: number): { scale: number; width: number; height: number } {
  const near = (v: number, target: number) => Math.abs(v - target) <= LETTERHEAD_A4_TOLERANCE_PT
  if (!(near(width, LETTERHEAD_A4_WIDTH_PT) && near(height, LETTERHEAD_A4_HEIGHT_PT))) {
    throw new Error('letterhead_not_a4') // also catches NaN, 0 and Infinity
  }
  const scale = LETTERHEAD_RENDER_WIDTH_PX / width
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  if (w * h > MAX_LETTERHEAD_CANVAS_PIXELS) throw new Error('letterhead_canvas_too_large')
  return { scale, width: w, height: h }
}

/**
 * Page 1 of `bytes` as a transparent PNG at `LETTERHEAD_RENDER_WIDTH_PX` wide. Rejects a non-PDF, anything over
 * `MAX_LETTERHEAD_BYTES`, an aborted `signal` and whatever pdf.js cannot parse. Takes ownership of `bytes`
 * (pdf.js transfers the buffer to its in-process worker). The document and the canvas are released on every path.
 */
export async function renderLetterhead(bytes: Uint8Array, signal: AbortSignal): Promise<Blob> {
  if (bytes.length > MAX_LETTERHEAD_BYTES) throw new Error('letterhead_too_large')
  if (!isPdfBytes(bytes)) throw new Error('letterhead_not_pdf')
  signal.throwIfAborted()

  await import('pdfjs-dist/build/pdf.worker.min.mjs') // sets globalThis.pdfjsWorker: no Worker is constructed
  const pdfjs = await import('pdfjs-dist')
  signal.throwIfAborted()

  const task = pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    useWasm: false,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
    // defence in depth (security M-4, DD-77): no single image above 40 million pixels (about 6 300 x 6 300) is decoded.
    // The server's decoded-size bound is the control; this is the one bound pdf.js exposes, and a real 300 dpi logo is
    // far below it. Pinned by `letterheadGuard.test.ts`.
    maxImageSize: 40_000_000,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  })
  const onAbort = () => void task.destroy()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const natural = page.getViewport({ scale: 1 }) // the crop box pdf.js draws, /Rotate honoured
    const plan = planLetterheadCanvas(natural.width, natural.height) // throws before any allocation
    const viewport = page.getViewport({ scale: plan.scale })
    const canvas = document.createElement('canvas')
    canvas.width = plan.width
    canvas.height = plan.height
    // Our own 2D context, with an alpha channel. Given only `canvas`, pdf.js opens it with `alpha: false`, which is
    // opaque black wherever the PDF paints nothing (a letterhead with no page fill came out black, found in L0).
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) throw new Error('letterhead_canvas')
    try {
      // Transparent: the paper behind the image shows through.
      // `annotationMode: DISABLE` (security D23): pdf.js draws annotation appearance streams by default; the offer PDF
      // carries none, so the preview draws none. Pinned by `renderLetterhead.test.ts` and `letterheadGuard.test.ts`.
      await page.render({
        canvasContext,
        canvas,
        viewport,
        background: 'rgba(0,0,0,0)',
        annotationMode: pdfjs.AnnotationMode.DISABLE,
      }).promise
      signal.throwIfAborted()
      return await new Promise<Blob>((ok, fail) =>
        canvas.toBlob((b) => (b ? ok(b) : fail(new Error('letterhead_png'))), 'image/png'),
      )
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    await task.destroy() // 6.x: the loading task owns the document's lifetime (`PDFDocumentProxy.destroy` is gone)
  }
}
