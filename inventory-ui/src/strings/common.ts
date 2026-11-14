/**
 * strings.common — copy for the shared primitives (T25, specs/20261006-hardware-
 * inventory): ErrorBanner, PermissionDenied, SkeletonListRows, ConfirmDialog,
 * GuardrailDialog, FormModal and the entity / currency chips. Ported from
 * refund-ui's `components` and `badges` strings, reworded for this tool.
 */
const en = {
  errorBanner: {
    defaultRetryLabel: 'Retry',
    dismissLabel: 'Dismiss',
  },
  /** The 503 fail-closed variant of ErrorBanner (design.md § Screens & states). */
  authUnavailable: {
    heading: 'Authorization service unavailable',
    body: 'We cannot verify your access right now. Nothing was changed.',
  },
  permissionDenied: {
    heading: 'You do not have access to this section.',
    body: 'If this is unexpected, contact your administrator.',
  },
  skeletonListRows: {
    /** sr-only aria-live loading text a caller composes into its own list-loading announcement. */
    loadingLabel: 'Loading…',
  },
  confirmDialog: {
    /** "Delete {entityLabel}?" — a function so the noun stays caller-supplied. */
    title: (entityLabel: string) => `Delete ${entityLabel}?`,
    cancelLabel: 'Cancel',
    cancelAriaLabel: 'Cancel',
    deleteLabel: 'Delete',
    deletingLabel: 'Deleting…',
    untitledFallback: 'Untitled',
    /** Default body copy when the caller does not override `body`. */
    defaultBody: (itemName: string) => `‘${itemName}’ will be permanently deleted. This cannot be undone.`,
  },
  supplierField: {
    /** Announced when the suggestion list opens or changes. */
    suggestions: (n: number) => (n === 1 ? '1 supplier suggestion available' : `${n} supplier suggestions available`),
  },
  guardrailDialog: {
    defaultAcknowledgeLabel: 'OK',
  },
  formModal: {
    cancelLabel: 'Cancel',
    closeAriaLabel: 'Close',
    defaultSubmitLabel: 'Save',
    defaultSubmittingLabel: 'Saving…',
  },
  entity: {
    welld_it: 'WellD Italia',
    welld_ch: 'WellD CH',
  },
  currency: {
    EUR: 'EUR',
    CHF: 'CHF',
  },
}

const it: typeof en = {
  errorBanner: {
    defaultRetryLabel: 'Riprova',
    dismissLabel: 'Chiudi',
  },
  authUnavailable: {
    heading: 'Servizio di autorizzazione non disponibile',
    body: 'Al momento non è possibile verificare i permessi di accesso. Non è stato modificato nulla.',
  },
  permissionDenied: {
    heading: 'Non si dispone dei permessi per accedere a questa sezione.',
    body: "Se non è previsto, contattare l'amministratore.",
  },
  skeletonListRows: {
    loadingLabel: 'Caricamento…',
  },
  confirmDialog: {
    title: (entityLabel: string) => `Eliminare ${entityLabel}?`,
    cancelLabel: 'Annulla',
    cancelAriaLabel: 'Annulla',
    deleteLabel: 'Elimina',
    deletingLabel: 'Eliminazione…',
    untitledFallback: 'Senza titolo',
    defaultBody: (itemName: string) =>
      `‘${itemName}’ verrà eliminato definitivamente. L'operazione non può essere annullata.`,
  },
  supplierField: {
    suggestions: (n: number) =>
      n === 1 ? '1 fornitore suggerito disponibile' : `${n} fornitori suggeriti disponibili`,
  },
  guardrailDialog: {
    defaultAcknowledgeLabel: 'OK',
  },
  formModal: {
    cancelLabel: 'Annulla',
    closeAriaLabel: 'Chiudi',
    defaultSubmitLabel: 'Salva',
    defaultSubmittingLabel: 'Salvataggio…',
  },
  entity: {
    welld_it: 'WellD Italia',
    welld_ch: 'WellD CH',
  },
  currency: {
    EUR: 'EUR',
    CHF: 'CHF',
  },
}

export const common = { en, it }
