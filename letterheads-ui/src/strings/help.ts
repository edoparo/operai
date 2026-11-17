/**
 * The help card "Placeholders and special characters" (design § How the frame model is exposed, § Copy keys
 * "Help card"). The names, the literal-brace table and the numbers come from `GET /v1/catalog`; this file
 * holds the words around them. A placeholder the catalog adds later has no meaning here and is listed by
 * its name alone.
 */
const en = {
  title: 'Placeholders and special characters',
  placeholders: 'Placeholders are replaced when a document is made.',
  /** The meaning of each placeholder the service knows today, by name. */
  placeholder: {
    legal_name: "The entity's legal name",
    address: 'The address, lines separated by a comma',
    vat: 'The VAT number',
    iban: 'The IBAN',
    contacts: 'The contacts line',
    page: 'The number of the page',
    pages: 'The total number of pages',
  } as Record<string, string>,
  pageFormat:
    'The zone a text is in sets where the page number is printed. Examples: Page {page} of {pages}, {page}/{pages}.',
  literal: 'To print a brace or a square bracket, write it twice.',
  youType: 'You type',
  itPrints: 'It prints',
  segment:
    'Text in square brackets around placeholders prints only when every placeholder in it has a value. [VAT: {vat}] prints "VAT: CHE-123.456.789" when a VAT number is sent, and nothing at all, label included, when it is not. A segment needs at least one placeholder and cannot hold another segment.',
  fit: (chars: number) =>
    `A header or footer must fit its margin. When you save, the service checks it with every placeholder replaced by a ${chars}-character value, and tells you which one does not fit. Raise the margin, shorten the text or use fewer lines.`,
  lines: (max: number, min: number, top: number) =>
    `Each zone holds up to ${max} lines. Each line has its own size (${min} to ${top} pt), weight and colour.`,
  placeholdersLabel: 'Placeholders',
  literalLabel: 'A brace or a bracket in the text',
  segmentLabel: 'A part that prints only when it has a value',
  fitLabel: 'It must fit the margin',
  linesLabel: 'Lines',
}

const it: typeof en = {
  title: 'Segnaposto e caratteri speciali',
  placeholders: 'I segnaposto vengono sostituiti quando si crea un documento.',
  placeholder: {
    legal_name: "La ragione sociale dell'entità",
    address: "L'indirizzo, righe separate da una virgola",
    vat: 'La partita IVA',
    iban: "L'IBAN",
    contacts: 'La riga dei contatti',
    page: 'Il numero della pagina',
    pages: 'Il numero totale di pagine',
  },
  pageFormat:
    'La zona in cui si trova un testo decide dove viene stampato il numero di pagina. Esempi: Pagina {page} di {pages}, {page}/{pages}.',
  literal: 'Per stampare una parentesi graffa o quadra, scrivila due volte.',
  youType: 'Scrivi',
  itPrints: 'Viene stampato',
  segment:
    'Il testo tra parentesi quadre attorno a dei segnaposto viene stampato solo se ogni segnaposto al suo interno ha un valore. [P.IVA: {vat}] stampa «P.IVA: CHE-123.456.789» quando la partita IVA è presente, e niente affatto, etichetta compresa, quando manca. Un segmento richiede almeno un segnaposto e non può contenerne un altro.',
  fit: (chars: number) =>
    `Intestazione e piè di pagina devono stare nel loro margine. Al salvataggio il servizio li controlla con ogni segnaposto sostituito da un valore di ${chars} caratteri e indica quale non ci sta. Aumenta il margine, accorcia il testo o usa meno righe.`,
  lines: (max: number, min: number, top: number) =>
    `Ogni zona contiene al massimo ${max} righe. Ogni riga ha la propria dimensione (da ${min} a ${top} pt), peso e colore.`,
  placeholdersLabel: 'Segnaposto',
  literalLabel: 'Una parentesi graffa o quadra nel testo',
  segmentLabel: 'Una parte che si stampa solo se ha un valore',
  fitLabel: 'Deve stare nel margine',
  linesLabel: 'Righe',
}

export const help = { en, it }
