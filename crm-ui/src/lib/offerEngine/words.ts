/**
 * The document's fixed words, per offer language (specs/20261115-crm-offer-wizard DD-29): moved out of
 * the renderer's `t` table so the PDF and the wizard's preview print the same words. Document text in
 * the OFFER's language, never UI copy — it does not go through a strings module (AC-10.1).
 * Pure; no `Intl`, no locale.
 *
 * Shared with the CRM UI: byte-identical copy (group offerEngine.words).
 */
// shared-copy:begin offerEngine.words

export type DocLanguage = "en" | "it";

const WORDS = {
  it: {
    offer: "Offerta",
    title: (reference: string) => `CONTRATTO DI FORNITURA – Rif. ${reference}`,
    attn: "A.c.a.",
    index: "INDICE",
    acceptance: "Per accettazione",
    place: "Luogo e data:",
    signature: "Firma valida del Cliente:",
    annexes: "Allegati:",
    annex: "Allegato",
    annexTitle: "Dettaglio dell’impegno",
    annexHeading: (letter: string) => `ALLEGATO ${letter} – DETTAGLIO DELL’IMPEGNO`,
    aiNote: "L’impegno considera uno sviluppo assistito da AI.",
    manDays: "Giorni-uomo",
    release: "Release",
    epic: "Epic",
    total: "TOTALE",
    annexTotal: "Totale",
    position: "Pos.",
    item: "Voce di costo",
    unit: (currency: string) => `${currency} / unità`,
    quantity: "Qt.",
    amount: (currency: string) => `Totale ${currency}`,
    vat: "P. IVA",
  },
  en: {
    offer: "Offer",
    title: (reference: string) => `SUPPLY CONTRACT – Ref. ${reference}`,
    attn: "Attn.",
    index: "CONTENTS",
    acceptance: "Acceptance",
    place: "Place and date:",
    signature: "Valid signature of the Client:",
    annexes: "Annexes:",
    annex: "Annex",
    annexTitle: "Effort detail",
    annexHeading: (letter: string) => `ANNEX ${letter} – EFFORT DETAIL`,
    aiNote: "Effort assumes AI-assisted delivery.",
    manDays: "Man-days",
    release: "Release",
    epic: "Epic",
    total: "TOTAL",
    annexTotal: "Total",
    position: "Pos.",
    item: "Item",
    unit: (currency: string) => `${currency} / unit`,
    quantity: "Qty",
    amount: (currency: string) => `Total ${currency}`,
    vat: "VAT",
  },
} satisfies Record<DocLanguage, unknown>;

export const words = (language: DocLanguage) => WORDS[language];
// shared-copy:end offerEngine.words
