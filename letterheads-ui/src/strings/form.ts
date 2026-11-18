/**
 * The configurator form's copy (design § Copy keys "Form"): page setup, the look of the document, the
 * variants (default, first, last), the frame of a variant (header, footer), a zone's lines, the logo's
 * placement and the background image. The file fields' words are in `asset.ts` and `upload.ts` (T23).
 */
const en = {
  setup: { title: 'Page setup' },
  margins: {
    legend: 'Margins (mm)',
    top: 'Top',
    bottom: 'Bottom',
    left: 'Left',
    right: 'Right',
    hint: (min: number, max: number, width: number, height: number) =>
      `Between ${min} and ${max} mm. The body area must stay at least ${width} × ${height} mm.`,
  },
  fonts: {
    legend: 'Fonts',
    body: 'Body text',
    heading: 'Headings',
    frame: 'Header and footer',
  },
  look: {
    title: 'Look of the document',
    heading: (n: number) => `Heading ${n}`,
    size: 'Size (pt)',
    bold: 'Bold',
    colour: 'Colour',
    bodyText: 'Body text',
    lineSpacing: 'Line spacing',
    table: 'Table',
    headerFill: 'Header row background',
    borders: 'Draw cell borders',
    borderColour: 'Border colour',
    marker: 'List marker (bulleted lists)',
    bullet: 'Bullet',
    dash: 'Dash',
  },
  variant: {
    default: 'Default page',
    first: 'First page',
    last: 'Last page',
    useFirst: 'Use a different first page',
    useLast: 'Use a different last page',
    firstHint: 'Without it, page 1 uses the default page.',
    lastHint:
      'Used on the last page of a document of more than one page. It must fit the same margins, so it never changes where pages break.',
    off: 'Not used. Its settings are kept in this form until you leave.',
    shown: (name: string) => `${name} settings shown`,
    hidden: (name: string) => `${name} settings hidden`,
  },
  frame: {
    header: 'Header',
    footer: 'Footer',
    valign: 'Align the three zones to the',
    top: 'Top',
    bottom: 'Bottom',
    valignHint: 'Bottom lines up a one-line zone with the last line of a longer one.',
    gap: 'Distance from the body (mm)',
    gapHint: (min: number, max: number) =>
      `Between ${min} and ${max} mm. The header or footer keeps this far from the body text; with it, it must fit its margin.`,
    placeholdersHint:
      'Placeholders such as {page} and {pages} are described in "Placeholders and special characters" above.',
  },
  rule: {
    showHeader: 'Draw a line between the header and the body',
    showFooter: 'Draw a line between the footer and the body',
    thickness: 'Thickness (pt)',
    colour: 'Colour',
  },
  zone: {
    left: 'Left zone',
    center: 'Centre zone',
    right: 'Right zone',
  },
  line: {
    n: (n: number) => `Line ${n}`,
    textIt: 'Text, Italian',
    textEn: 'Text, English',
    size: 'Size (pt)',
    bold: 'Bold',
    colour: 'Colour',
    add: 'Add a line',
    limit: (max: number) => `A zone holds up to ${max} lines.`,
    remove: (variant: string, frame: string, zone: string, n: number) =>
      `Remove ${variant.toLowerCase()}, ${frame.toLowerCase()}, ${zone.toLowerCase()}, line ${n}`,
    removed: 'Line removed',
  },
  logo: {
    title: 'Logo',
    file: 'Logo file',
    remove: 'Remove logo',
    position: 'Position',
    left: 'Left',
    center: 'Centre',
    right: 'Right',
    height: 'Height (mm)',
    heightHint: (min: number, max: number) =>
      `Between ${min} and ${max} mm. It must fit the top margin together with the header lines. The width follows the proportions.`,
  },
  background: {
    title: 'Background image',
    file: 'Background image file',
    hint: 'Drawn under everything else on the whole page. Text stays inside the margins.',
    remove: 'Remove background',
  },
}

const it: typeof en = {
  setup: { title: 'Impaginazione' },
  margins: {
    legend: 'Margini (mm)',
    top: 'Superiore',
    bottom: 'Inferiore',
    left: 'Sinistro',
    right: 'Destro',
    hint: (min: number, max: number, width: number, height: number) =>
      `Tra ${min} e ${max} mm. L'area del testo deve restare di almeno ${width} × ${height} mm.`,
  },
  fonts: {
    legend: 'Caratteri',
    body: 'Testo',
    heading: 'Titoli',
    frame: 'Intestazione e piè di pagina',
  },
  look: {
    title: 'Aspetto del documento',
    heading: (n: number) => `Titolo ${n}`,
    size: 'Dimensione (pt)',
    bold: 'Grassetto',
    colour: 'Colore',
    bodyText: 'Testo',
    lineSpacing: 'Interlinea',
    table: 'Tabella',
    headerFill: 'Sfondo della riga di intestazione',
    borders: 'Disegna i bordi delle celle',
    borderColour: 'Colore dei bordi',
    marker: "Simbolo dell'elenco puntato",
    bullet: 'Punto',
    dash: 'Trattino',
  },
  variant: {
    default: 'Pagina predefinita',
    first: 'Prima pagina',
    last: 'Ultima pagina',
    useFirst: 'Usa una prima pagina diversa',
    useLast: "Usa un'ultima pagina diversa",
    firstHint: 'Senza, la pagina 1 usa la pagina predefinita.',
    lastHint:
      "Usata sull'ultima pagina di un documento di più pagine. Deve stare negli stessi margini, quindi non cambia mai dove vanno a capo le pagine.",
    off: 'Non usata. Le sue impostazioni restano in questo modulo finché non esci.',
    shown: (name: string) => `Impostazioni di ${name} mostrate`,
    hidden: (name: string) => `Impostazioni di ${name} nascoste`,
  },
  frame: {
    header: 'Intestazione',
    footer: 'Piè di pagina',
    valign: 'Allinea le tre zone in',
    top: 'Alto',
    bottom: 'Basso',
    valignHint: "«Basso» allinea una zona di una riga all'ultima riga di una più lunga.",
    gap: 'Distanza dal testo (mm)',
    gapHint: (min: number, max: number) =>
      `Tra ${min} e ${max} mm. L’intestazione o il piè di pagina resta a questa distanza dal testo; con essa deve stare nel suo margine.`,
    placeholdersHint:
      'I segnaposto come {page} e {pages} sono descritti in «Segnaposto e caratteri speciali» qui sopra.',
  },
  rule: {
    showHeader: "Disegna una linea tra l'intestazione e il testo",
    showFooter: 'Disegna una linea tra il piè di pagina e il testo',
    thickness: 'Spessore (pt)',
    colour: 'Colore',
  },
  zone: {
    left: 'Zona sinistra',
    center: 'Zona centrale',
    right: 'Zona destra',
  },
  line: {
    n: (n: number) => `Riga ${n}`,
    textIt: 'Testo, italiano',
    textEn: 'Testo, inglese',
    size: 'Dimensione (pt)',
    bold: 'Grassetto',
    colour: 'Colore',
    add: 'Aggiungi una riga',
    limit: (max: number) => `Una zona contiene al massimo ${max} righe.`,
    remove: (variant: string, frame: string, zone: string, n: number) =>
      `Rimuovi ${variant.toLowerCase()}, ${frame.toLowerCase()}, ${zone.toLowerCase()}, riga ${n}`,
    removed: 'Riga rimossa',
  },
  logo: {
    title: 'Logo',
    file: 'File del logo',
    remove: 'Rimuovi il logo',
    position: 'Posizione',
    left: 'Sinistra',
    center: 'Centro',
    right: 'Destra',
    height: 'Altezza (mm)',
    heightHint: (min: number, max: number) =>
      `Tra ${min} e ${max} mm. Deve stare nel margine superiore insieme alle righe dell’intestazione. La larghezza segue le proporzioni.`,
  },
  background: {
    title: 'Immagine di sfondo',
    file: "File dell'immagine di sfondo",
    hint: 'Disegnata sotto tutto il resto su tutta la pagina. Il testo resta dentro i margini.',
    remove: 'Rimuovi lo sfondo',
  },
}

export const form = { en, it }
