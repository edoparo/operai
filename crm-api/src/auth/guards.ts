/**
 * The guard stack and capabilities every crm-api route uses (specs/20261101-crm,
 * ADR 20260716-refund-api-authorization-enforcing-resource-server; decisions D-3).
 *
 *   authorized   JWT + live authorization (`GET /authz/resolve`) + `crm:access`.
 *                Every route except `/health`. An `auth` outage is a 503.
 *
 * Attach per route, through `createRoute({ middleware: authorized })`, never
 * with `router.use("*", …)`: every router is mounted at "/" in src/index.ts and
 * Hono copies a sub-app's `use("*")` onto the whole app.
 */

import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { jwtMiddleware } from "./jwt.middleware";
import { authzMiddleware, type AuthzVariables } from "./authz.middleware";
import { ENTITIES, hasCapability, scopeFor, type Entity } from "../authz/conditions";
import { problem } from "../lib/problem";

/** A `(resource, action)` pair from the `crm` catalog (auth/src/authz/catalogs/crm.ts). */
export type Capability = readonly [resource: string, action: string];

/** Tool access: read everything, create/edit companies, contacts and activities. */
export const CRM_ACCESS: Capability = ["crm", "access"];
/** Create, edit and move deals — entity-scoped (ADR 20260716-entity-scoped-abac-refund-api). */
export const DEAL_MANAGE: Capability = ["deal", "manage"];
/** Erase a contact's personal data (D-13). */
export const CONTACT_ERASE: Capability = ["contact", "erase"];
/**
 * See the money: amounts, weighted amounts, pipeline totals, deal notes and
 * offers (specs/20261101-crm-sales-flow US-1, ADR 20261101-crm-financial-visibility-permission). Without it crm-api leaves those fields out.
 */
export const DEAL_FINANCIALS: Capability = ["deal", "financials"];

/** The resolved permissions and entity the authz middleware put on the context. */
export interface AuthzSource {
  get(key: "authz"): AuthzVariables["authz"];
}

export const canSeeFinancials = (c: AuthzSource): boolean =>
  hasCapability(c.get("authz").permissions, DEAL_FINANCIALS[0], DEAL_FINANCIALS[1]);

/** Entities the caller manages deals for (ADR 20260716-entity-scoped-abac-refund-api). */
export const dealScope = (c: AuthzSource): Entity[] => {
  const { permissions, entity } = c.get("authz");
  return scopeFor(permissions, DEAL_MANAGE[0], DEAL_MANAGE[1], entity);
};

/**
 * `deal:manage` over every entity: the admin's reach. Used where specs/20261101-crm-sales-flow says
 * "an admin" (the estimate gate override, acting for another person).
 */
export const managesAllDeals = (c: AuthzSource): boolean => dealScope(c).length === ENTITIES.length;

/**
 * 403 unless the caller holds AT LEAST ONE of `needs` (any scope). Must run
 * after `authzMiddleware`. Whether the caller may touch a particular deal is a
 * separate, record-level question answered with `scopeFor` (D-5).
 */
export const requireCapability = (
  ...needs: readonly Capability[]
): MiddlewareHandler =>
  createMiddleware<{ Variables: AuthzVariables }>(async (c, next) => {
    const { permissions } = c.get("authz");
    if (!needs.some(([resource, action]) => hasCapability(permissions, resource, action))) {
      return problem(
        {
          status: 403,
          detail: "You do not have permission to perform this action",
        },
        c.req.path,
      );
    }
    return next();
  });

export const authorized: MiddlewareHandler[] = [
  jwtMiddleware,
  authzMiddleware,
  requireCapability(CRM_ACCESS),
];
