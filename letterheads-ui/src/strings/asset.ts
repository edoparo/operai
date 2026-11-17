/**
 * The file fields' copy (design § Copy keys "Logo, background"): the file chosen for a logo or a background
 * image, its thumbnail line and the words around the picker. The sentences for a refused file are in
 * `upload.ts`; the logo's and the background's own titles and labels are in `form.ts`.
 */
const en = {
  current: (format: string, width: number, height: number) => `Current file: ${format}, ${width} × ${height} px`,
  currentFormat: (format: string) => `Current file: ${format}`,
  currentSvg: 'Current file: SVG',
  thumbAlt: (what: string) => `Current ${what.toLowerCase()}`,
  thumbFailed: 'The image could not be shown.',
  choose: 'Choose file',
  clear: 'Cancel upload',
  none: 'No file chosen',
  uploading: 'Uploading…',
  uploaded: 'File uploaded',
  accept: 'PNG, JPEG or SVG, up to 2 MB.',
}

const it: typeof en = {
  current: (format: string, width: number, height: number) => `File attuale: ${format}, ${width} × ${height} px`,
  currentFormat: (format: string) => `File attuale: ${format}`,
  currentSvg: 'File attuale: SVG',
  thumbAlt: (what: string) => `${what} attuale`,
  thumbFailed: "Non è stato possibile mostrare l'immagine.",
  choose: 'Scegli file',
  clear: 'Annulla il caricamento',
  none: 'Nessun file scelto',
  uploading: 'Caricamento…',
  uploaded: 'File caricato',
  accept: 'PNG, JPEG o SVG, fino a 2 MB.',
}

export const asset = { en, it }
