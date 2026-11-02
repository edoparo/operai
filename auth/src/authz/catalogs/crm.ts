/**
 * The CRM's declared permission catalog (specs/017-crm — AC-5.1, AC-5.2;
 * decisions D-3; ADR-0052).
 *
 * Mirrors `catalogs/inventory.ts`'s shape: a plain constant describing the
 * (resource, action, supportedConditions) surface `crm-api` enforces
 * server-side. `../seed.ts`'s `seedCrmCatalog` registers it via
 * `upsertAppCatalog` (one full-replace upsert keyed by `appId`).
 *
 * Three resources:
 *   - the app-access resource (`crm`) — `access`, no conditions. Gates the tool
 *     AND is the whole read/collaborate capability: companies, contacts,
 *     activities and reading deals. `crm` is registered ONLY here, never also
 *     through `SUITE_APPS` (a second full-replace registration would prune it).
 *   - `deal` — `manage`, supporting the `entity` condition (ADR-0015): create,
 *     edit and move deals of the holder's own entity, or both when unconditioned;
 *     and `financials` (specs/018), unconditioned: see/edit a deal's money.
 *   - `contact` — `erase`, no conditions: the irreversible deletion of a
 *     contact's personal data (GDPR art. 17, D-13).
 *
 * Declaration only: the role grants are `seedCrmGrants`, a separate step.
 */

import type { AppCatalogInput } from "../catalog";

/** The CRM's app id across the Operai suite catalog/role system. */
export const CRM_APP_ID = "crm";

export const CRM_CATALOG: AppCatalogInput = {
  appId: CRM_APP_ID,
  resources: [
    {
      key: CRM_APP_ID,
      label: "CRM",
      actions: [{ key: "access", label: "Access", supportedConditions: [] }],
    },
    {
      key: "deal",
      label: "Deal",
      actions: [
        { key: "manage", label: "Manage", supportedConditions: ["entity"] },
        // Sees and edits a deal's money (value, quote lines, margin) — specs/018
        // (ADR-0054). Unconditioned: financial visibility is not entity-scoped.
        { key: "financials", label: "View and edit financials", supportedConditions: [] },
      ],
    },
    {
      key: "contact",
      label: "Contact",
      actions: [{ key: "erase", label: "Erase", supportedConditions: [] }],
    },
  ],
};
