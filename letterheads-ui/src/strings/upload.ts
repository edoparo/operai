/**
 * The sentence for each way an upload is refused (design § Copy keys "Upload refusals"; plan G3 and its
 * amendment of 2026-11-17: `invalid_asset.reason` is one of ten). The keys of `reason` are the service's
 * reasons, so the sentence is looked up by what the service said and never by its wording. A reason this
 * build does not know falls back to `refused`; a request that failed some other way (the network, a 5xx, a
 * request-shape error) is `failed`. Every SVG sentence says how to fix the file.
 */
const en = {
  reason: {
    unsupported_format:
      'This file is not a PNG, JPEG or SVG image. The file name does not matter; the content is checked.',
    too_many_bytes: 'This file is larger than 2 MB.',
    too_many_pixels: 'This image has too many pixels. A PNG or JPEG can have at most 25 megapixels.',
    too_many_elements: 'This SVG is too complex. It can have at most 10 000 elements.',
    svg_script: 'This SVG contains a script. Export it again as a plain SVG.',
    svg_event_handler:
      'This SVG contains an event handler (an attribute such as onclick). Export it again as a plain SVG.',
    svg_foreign_object: 'This SVG contains an embedded page element (foreignObject). Export it again as a plain SVG.',
    svg_doctype: 'This SVG contains a document-type or entity declaration. Export it again as a plain SVG.',
    svg_external_reference:
      'This SVG refers to something outside the file (a web address, a file or a stylesheet). Embed what it needs and export it again.',
    svg_not_allowed:
      'This SVG uses something that is not allowed, such as styles, embedded images or data added by an editor. Export it again as a plain SVG with presentation attributes, or upload a PNG.',
  },
  refused: 'This file was not accepted.',
  forbidden: 'You can no longer change this letterhead, so the file was not uploaded.',
  failed: 'The file could not be uploaded. Try again.',
}

const it: typeof en = {
  reason: {
    unsupported_format:
      "Questo file non è un'immagine PNG, JPEG o SVG. Il nome del file non conta: si controlla il contenuto.",
    too_many_bytes: 'Questo file supera i 2 MB.',
    too_many_pixels: 'Questa immagine ha troppi pixel. Un PNG o JPEG può avere al massimo 25 megapixel.',
    too_many_elements: 'Questo SVG è troppo complesso. Può avere al massimo 10 000 elementi.',
    svg_script: 'Questo SVG contiene uno script. Esportalo di nuovo come SVG semplice.',
    svg_event_handler:
      'Questo SVG contiene un gestore di eventi (un attributo come onclick). Esportalo di nuovo come SVG semplice.',
    svg_foreign_object:
      'Questo SVG contiene un elemento di pagina incorporato (foreignObject). Esportalo di nuovo come SVG semplice.',
    svg_doctype:
      'Questo SVG contiene una dichiarazione di tipo di documento o di entità. Esportalo di nuovo come SVG semplice.',
    svg_external_reference:
      'Questo SVG rimanda a qualcosa fuori dal file (un indirizzo web, un file o un foglio di stile). Incorpora ciò che serve ed esportalo di nuovo.',
    svg_not_allowed:
      'Questo SVG usa qualcosa che non è consentito, come stili, immagini incorporate o dati aggiunti da un editor. Esportalo di nuovo come SVG semplice con attributi di presentazione, oppure carica un PNG.',
  },
  refused: 'Questo file non è stato accettato.',
  forbidden: 'Non puoi più modificare questa carta intestata, quindi il file non è stato caricato.',
  failed: 'Impossibile caricare il file. Riprova.',
}

export const upload = { en, it }
