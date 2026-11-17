/**
 * The letterhead service's declared permission catalog (specs/20261116-letterhead-service —
 * AC-8.1, AC-8.2, AC-8.9; owner decision O9).
 *
 * Mirrors `catalogs/projects.ts`'s shape: a plain constant describing the
 * (resource, action, supportedConditions) surface `letterhead-api` enforces
 * server-side. `../seed.ts`'s `seedLetterheadsCatalog` registers it via
 * `upsertAppCatalog` (one full-replace upsert per `appId`).
 *
 * Two resources:
 *   - the app-access resource (`letterheads`) — `access`, no conditions. Gates the tool
 *     and is the whole read capability. `letterheads` is registered ONLY here, never
 *     also through `SUITE_APPS` (a second full-replace registration would prune it).
 *   - `letterhead` — `manage`, supporting the `entity` condition (ADR 20260716-entity-scoped-abac-refund-api):
 *     change the letterhead of the holder's own entity, or of both when unconditioned.
 *
 * Resource names stay unique across catalogs: the resolver matches grants by
 * `(resource, action)` without the app id.
 *
 * Declaration only: the role grants are `seedLetterheadsGrants` (`admin` only, AC-8.9).
 */

import type { AppCatalogInput } from "../catalog";

/** The letterhead tool's app id across the Operai suite catalog/role system. */
export const LETTERHEADS_APP_ID = "letterheads";

export const LETTERHEADS_CATALOG: AppCatalogInput = {
  appId: LETTERHEADS_APP_ID,
  resources: [
    {
      key: LETTERHEADS_APP_ID,
      label: "Letterheads",
      actions: [{ key: "access", label: "Access", supportedConditions: [] }],
    },
    {
      key: "letterhead",
      label: "Letterhead",
      actions: [{ key: "manage", label: "Manage", supportedConditions: ["entity"] }],
    },
  ],
};
