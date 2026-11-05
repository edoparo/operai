/**
 * The purchase order (PO) of a project made from a won deal (specs/022; ledger D38): its card on the
 * project page — the deal, the "no longer won" notice, the estimate, the Bexio order id. The referent,
 * the ops-manager and the pick of the project manager are T32's, in this file and `strings/project.ts`.
 */
const en = {
  title: 'Purchase order',
  saved: {
    bexio: 'Bexio order saved.',
  },
  card: {
    deal: 'Deal',
    dealUnavailable: 'Deal title unavailable',
    estimate: 'Estimate',
    openEstimate: 'Open the estimate',
    dealNotWon: {
      title: 'The deal is no longer won',
      body: 'It was reopened in the CRM. This purchase order is unchanged.',
    },
  },
  bexio: {
    label: 'Bexio order',
    hint: 'The order administration opened in Bexio. Free text, up to 64 characters; leave empty to clear it.',
    save: 'Save',
    saving: 'Saving…',
    tooLong: 'Use at most 64 characters.',
    none: 'Not set',
  },
}

const it: typeof en = {
  title: 'Ordine d’acquisto',
  saved: {
    bexio: 'Ordine Bexio salvato.',
  },
  card: {
    deal: 'Trattativa',
    dealUnavailable: 'Titolo della trattativa non disponibile',
    estimate: 'Stima',
    openEstimate: 'Apri la stima',
    dealNotWon: {
      title: 'La trattativa non è più vinta',
      body: 'È stata riaperta nel CRM. Questo ordine d’acquisto resta invariato.',
    },
  },
  bexio: {
    label: 'Ordine Bexio',
    hint: 'L’ordine aperto dall’amministrazione in Bexio. Testo libero, al massimo 64 caratteri; lascia vuoto per cancellarlo.',
    save: 'Salva',
    saving: 'Salvataggio…',
    tooLong: 'Usa al massimo 64 caratteri.',
    none: 'Non impostato',
  },
}

export const purchaseOrder = { en, it }
