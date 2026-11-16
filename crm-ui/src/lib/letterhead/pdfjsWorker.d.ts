// pdfjs-dist ships no types for its worker module. Importing it only has a side effect: it sets
// `globalThis.pdfjsWorker`, which makes pdf.js run its parser on the main thread (DD-53).
declare module 'pdfjs-dist/build/pdf.worker.min.mjs'
