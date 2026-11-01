/**
 * strings.nav — the tool layout's copy (T28, specs/015-hardware-inventory;
 * design.md § T0 InventoryShell and Resolutions G1/G11): the heading, the tab
 * navigation and the states the layout shows before a page does.
 */
const en = {
  /** The tool's h1. */
  heading: 'Inventory',
  /** `aria-label` of the tab navigation landmark. */
  landmarkLabel: 'Inventory sections',
  assets: 'Assets',
  rules: 'Depreciation rules',
  years: 'Fiscal years',
  /** sr-only polite line while `GET /scope` loads. */
  loading: 'Loading inventory…',
  /** Tool access, but both capability scopes are empty (not an empty list). */
  scopeEmpty: {
    heading: 'No entity in your scope',
    body: 'You can use Inventory, but no legal entity is assigned to your account yet. Ask an administrator to assign one.',
  },
}

const it: typeof en = {
  heading: 'Inventario',
  landmarkLabel: "Sezioni dell'inventario",
  assets: 'Beni',
  rules: 'Regole di ammortamento',
  years: 'Esercizi',
  loading: 'Caricamento inventario…',
  scopeEmpty: {
    heading: 'Nessuna entità di competenza',
    body: "L'accesso a Inventario è attivo, ma all'account non è ancora assegnata alcuna entità legale. Chiedere a un amministratore di assegnarne una.",
  },
}

export const nav = { en, it }
