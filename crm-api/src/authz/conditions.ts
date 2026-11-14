/**
 * Pure, DB-free authorization-condition helpers (specs/20261101-crm, ADR 20260716-refund-api-authorization-enforcing-resource-server
 * point 3 + ADR 20260716-entity-scoped-abac-refund-api). Ported from inventory-api/src/authz/conditions.ts,
 * which fails CLOSED on a condition it does not recognise; kept as is.
 *
 *   - `hasCapability` / `findPermission`  does the resolved set contain the grant?
 *   - `scopeFor`                          which entities does a grant cover?
 *   - `inScope`                           is this record's entity inside such a set?
 *
 * The CRM's one entity-scoped capability is `deal:manage`: a deal has one
 * entity, so scope is exact. Unlike inventory, every CRM user can READ every
 * deal, so a write outside the scope is a 403 `out_of_scope`, not a 404
 * (decisions D-5, ADR 20260807-denial-taxonomy-shared-records-403-vs-404's "relationship exists" branch).
 */

import type { ResolveConditions, ResolvedPermission } from "./resolveClient";

/** The wellD legal entities, in a fixed order so scope lists are stable. */
export const ENTITIES = ["welld_ch", "welld_it"] as const;
export type Entity = (typeof ENTITIES)[number];

export const isEntity = (value: unknown): value is Entity =>
  typeof value === "string" && (ENTITIES as readonly string[]).includes(value);

// ─── Capability check ──────────────────────────────────────────────────────

/**
 * Whether the resolved permission set contains a grant for `(resource, action)`
 * AT ALL, regardless of attached conditions. A missing capability is a
 * wholesale 403, never a 404.
 */
export function hasCapability(
  permissions: readonly ResolvedPermission[],
  resource: string,
  action: string,
): boolean {
  return permissions.some(
    (permission) =>
      permission.resource === resource && permission.action === action,
  );
}

/** The first `(resource, action)` grant, with its conditions, if any. */
export function findPermission(
  permissions: readonly ResolvedPermission[],
  resource: string,
  action: string,
): ResolvedPermission | undefined {
  return permissions.find(
    (permission) =>
      permission.resource === resource && permission.action === action,
  );
}

// ─── Entity scope (ADR 20260716-entity-scoped-abac-refund-api, reused by plan.md § Authorization model) ──────

type GrantKind = "unrestricted" | "entity" | "unrecognised";

/**
 * How a grant's conditions read:
 *
 *   - `unrestricted`   no conditions at all (null, or an object with neither an
 *                      `ownership` nor any `attributes`)
 *   - `entity`         every condition is `{key:"entity", match:"user"}` - the
 *                      grant narrows to the caller's own entity
 *   - `unrecognised`   anything else: another attribute, another match, an
 *                      `ownership`, or the entity condition next to one of those
 *
 * DELIBERATE DIFFERENCE from refund-api, whose `entityScopeForPermission`
 * treats a condition it does not recognise as no restriction (fail OPEN):
 * crm-api fails CLOSED. This service serves purchase prices, book values
 * and the fiscal-year ledger, so a condition we cannot evaluate must never
 * widen a grant - an unrecognised grant contributes nothing. The catalog
 * declares `supportedConditions: ["entity"]` for `asset:manage` and
 * `ledger:manage` (auth/src/authz/catalogs/inventory.ts), so the admin API
 * cannot attach anything else today; this is the backstop for the day it can,
 * or for a corrupt row.
 */
function grantKind(conditions: ResolveConditions | null): GrantKind {
  if (conditions === null) return "unrestricted";
  const attributes = conditions.attributes ?? [];
  if (conditions.ownership === undefined && attributes.length === 0) return "unrestricted";
  const onlyEntity = attributes.every(
    (attribute) => attribute["key"] === "entity" && attribute.match === "user",
  );
  return conditions.ownership === undefined && onlyEntity ? "entity" : "unrecognised";
}

/** One warning per dropped grant: which condition names (never values), never the caller. */
function warnUnrecognised(permission: ResolvedPermission): void {
  const conditions = permission.conditions;
  const names = [
    ...(conditions?.ownership !== undefined ? ["ownership"] : []),
    ...(conditions?.attributes ?? []).map((attribute) => attribute["key"]),
  ];
  console.warn(
    `[authz] ignoring grant ${permission.resource}:${permission.action}: unrecognised condition(s) [${names.join(", ")}] - it contributes no access`,
  );
}

/**
 * The entities the caller may act on through `(resource, action)`:
 *
 *   - no such grant                              → `[]`
 *   - unconditioned grant                        → both entities
 *   - entity-conditioned, caller has an entity   → `[callerEntity]`
 *   - entity-conditioned, `callerEntity` is null → `[]` (R-7: fail closed on a
 *     data-integrity edge the admin GUI should prevent — never "everything")
 *   - carries a condition we do not recognise    → nothing from that grant, plus a
 *     warning (fails closed; see `grantKind` for why this differs from refund-api)
 *
 * Several grants of the same pair are unioned, widest wins (ADR 20260713-authz-hand-rolled-rbac-abac-epoch-claims): a
 * conditioned one plus an unconditioned one covers both entities. `auth`'s
 * resolver already de-duplicates, so this is defence in depth, not the main
 * path. The result is in the fixed `ENTITIES` order with no duplicates.
 */
export function scopeFor(
  permissions: readonly ResolvedPermission[],
  resource: string,
  action: string,
  callerEntity: string | null,
): Entity[] {
  const covered = new Set<Entity>();

  for (const permission of permissions) {
    if (permission.resource !== resource || permission.action !== action) {
      continue;
    }
    const kind = grantKind(permission.conditions);
    if (kind === "unrestricted") return [...ENTITIES];
    if (kind === "unrecognised") {
      warnUnrecognised(permission);
      continue;
    }
    // A callerEntity that is not one of ours (corrupt attribute) matches nothing.
    if (isEntity(callerEntity)) covered.add(callerEntity);
  }

  return ENTITIES.filter((entity) => covered.has(entity));
}

/** Whether `record` falls inside `scope` (the result of `scopeFor`). */
export function inScope(
  record: { readonly entity: string },
  scope: readonly Entity[],
): boolean {
  return (scope as readonly string[]).includes(record.entity);
}
