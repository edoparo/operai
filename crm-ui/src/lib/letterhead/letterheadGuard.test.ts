import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Defence for the advisory class of GHSA-hq66-cqwq-w95j (security M-3, specs/20261115-crm-offer-wizard): pdf.js runs
// scripts from a PDF only through its viewer layers (annotation layer + scripting manager), never through
// `getDocument` + `page.render` onto a canvas. crm-ui draws the canvas only; this test fails if any of the viewer
// pieces, the worker options or a second importer ever appears, so a later "show the text / the form" change must
// reopen the ADR (docs/adr/20261115-letterhead-preview-pdfjs-main-thread-in-the-remote.md).
const SRC = join(__dirname, '..', '..')
const ALLOWED_IMPORTER = join(SRC, 'lib', 'letterhead', 'renderLetterhead.ts')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sources(full)
    return /\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

// Comments may name what the code refuses to do; code may not use it.
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const files = sources(SRC).map((f) => ({
  path: f,
  rel: relative(SRC, f),
  text: stripComments(readFileSync(f, 'utf8')),
}))

describe('pdf.js use stays canvas-only', () => {
  it('scans the application sources', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(files.some((f) => f.path === ALLOWED_IMPORTER)).toBe(true)
  })

  it.each([
    ['the viewer entry pdfjs-dist/web', /pdfjs-dist\/web/],
    ['the legacy build (a different bundle, not the one proved)', /pdfjs-dist\/legacy/],
    ['the scripting sandbox pdf.sandbox', /pdf\.sandbox/],
    ['AnnotationLayer', /AnnotationLayer/],
    ['enableScripting', /enableScripting/],
    ['PDFScriptingManager', /ScriptingManager/],
    ['pdf_viewer', /pdf_viewer/],
    ['a text layer (TextLayer)', /\bTextLayer\b/],
    ['a Worker or SharedWorker constructor', /new\s+(Shared)?Worker\b/],
    ['workerSrc / GlobalWorkerOptions', /workerSrc|GlobalWorkerOptions/],
    ['wasmUrl, cMapUrl or standardFontDataUrl', /wasmUrl|cMapUrl|standardFontDataUrl/],
    ['an eval-style flag', /isEvalSupported/],
  ])('no source file uses %s', (_name, pattern) => {
    const hits = files.filter((f) => pattern.test(f.text)).map((f) => f.rel)
    expect(hits).toEqual([])
  })

  it('only renderLetterhead.ts imports pdfjs-dist, and only the main entry and the worker module', () => {
    const importers = files.filter((f) => /['"]pdfjs-dist/.test(f.text))
    expect(importers.map((f) => f.path)).toEqual([ALLOWED_IMPORTER])
    const specifiers = [...importers[0]!.text.matchAll(/['"](pdfjs-dist[^'"]*)['"]/g)].map((m) => m[1])
    expect(new Set(specifiers)).toEqual(new Set(['pdfjs-dist', 'pdfjs-dist/build/pdf.worker.min.mjs']))
  })

  it('bounds the pixels of any one image pdf.js decodes (security M-4, DD-77)', () => {
    const text = files.find((f) => f.path === ALLOWED_IMPORTER)!.text
    expect(text).toMatch(/maxImageSize:\s*40_000_000\b/)
  })

  it('draws no annotations: page.render passes annotationMode DISABLE (security D23)', () => {
    const text = files.find((f) => f.path === ALLOWED_IMPORTER)!.text
    expect(text).toMatch(/annotationMode:\s*pdfjs\.AnnotationMode\.DISABLE\b/)
  })

  it('does not hand pdf.js a URL', () => {
    const text = files.find((f) => f.path === ALLOWED_IMPORTER)!.text
    expect(text).not.toMatch(/getDocument\(\s*(['"`]|\{\s*url\b)/)
  })
})
