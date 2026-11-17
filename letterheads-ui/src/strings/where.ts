/**
 * The words for where a refused value is (design S4 "Naming", § Copy keys `where.*`): a pointer into the
 * configuration is read segment by segment into the name of the setting as the person knows it, so that a
 * sentence makes sense without the form in front of the reader ("Footer, left zone, line 2, English text").
 * Lower case: `fieldPath` capitalises the first letter of the whole phrase.
 */
const en = {
  margins: { top: 'top margin', bottom: 'bottom margin', left: 'left margin', right: 'right margin' },
  fonts: { body: 'body text font', heading: 'headings font', frame: 'header and footer font' },
  look: {
    heading: (n: number) => `heading ${n}`,
    body: 'body text',
    table: 'table',
    bulletMarker: 'list marker',
    size: 'size',
    bold: 'bold',
    colour: 'colour',
    lineSpacing: 'line spacing',
    headerFill: 'header row background',
    borders: 'cell borders',
    borderColour: 'border colour',
  },
  variant: { default: 'default page', first: 'first page', last: 'last page' },
  frame: { header: 'header', footer: 'footer' },
  valign: 'alignment',
  rule: { rule: 'rule', show: 'shown', thickness: 'thickness', colour: 'colour' },
  zone: { left: 'left zone', center: 'centre zone', right: 'right zone' },
  line: (n: number) => `line ${n}`,
  text: { it: 'Italian text', en: 'English text' },
  logo: { logo: 'logo', file: 'file', position: 'position', height: 'height' },
  background: 'background image',
}

const it: typeof en = {
  margins: { top: 'margine superiore', bottom: 'margine inferiore', left: 'margine sinistro', right: 'margine destro' },
  fonts: {
    body: 'carattere del testo',
    heading: 'carattere dei titoli',
    frame: 'carattere di intestazione e piè di pagina',
  },
  look: {
    heading: (n: number) => `titolo ${n}`,
    body: 'testo',
    table: 'tabella',
    bulletMarker: 'simbolo dell’elenco',
    size: 'dimensione',
    bold: 'grassetto',
    colour: 'colore',
    lineSpacing: 'interlinea',
    headerFill: 'sfondo della riga di intestazione',
    borders: 'bordi delle celle',
    borderColour: 'colore dei bordi',
  },
  variant: { default: 'pagina predefinita', first: 'prima pagina', last: 'ultima pagina' },
  frame: { header: 'intestazione', footer: 'piè di pagina' },
  valign: 'allineamento',
  rule: { rule: 'linea', show: 'visibilità', thickness: 'spessore', colour: 'colore' },
  zone: { left: 'zona sinistra', center: 'zona centrale', right: 'zona destra' },
  line: (n: number) => `riga ${n}`,
  text: { it: 'testo italiano', en: 'testo inglese' },
  logo: { logo: 'logo', file: 'file', position: 'posizione', height: 'altezza' },
  background: 'immagine di sfondo',
}

export const where = { en, it }
