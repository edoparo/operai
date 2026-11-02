/**
 * `GET /scope` (specs/017-crm, plan.md § Scope): which entities `deal:manage`
 * covers for the caller, and whether they may erase contacts — so crm-ui offers
 * exactly the controls the server would accept. An `auth` outage is a 503,
 * never an empty scope. specs/018 adds `financials` (the caller sees money) and
 * `managesAll` (deal:manage over every entity: the admin's override reach).
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { CONTACT_ERASE, DEAL_MANAGE, authorized, canSeeFinancials, managesAllDeals } from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import { hasCapability, scopeFor } from "../authz/conditions";
import { EntitySchema, commonErrors } from "../lib/http";
import { validationHook } from "../lib/problem";

const scopeRoute = createRoute({
  method: "get",
  path: "/scope",
  tags: ["Scope"],
  summary: "What the caller may manage",
  middleware: authorized,
  responses: {
    200: {
      description: "Entities covered by deal:manage, and whether contact:erase is held",
      content: {
        "application/json": {
          schema: z.object({
            deal: z.array(EntitySchema),
            canErase: z.boolean(),
            financials: z.boolean(),
            managesAll: z.boolean(),
          }),
        },
      },
    },
    ...commonErrors,
  },
});

export const scopeRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({
  defaultHook: validationHook,
});

scopeRouter.openapi(scopeRoute, (c) => {
  const { permissions, entity } = c.get("authz");
  return c.json(
    {
      deal: scopeFor(permissions, DEAL_MANAGE[0], DEAL_MANAGE[1], entity),
      canErase: hasCapability(permissions, CONTACT_ERASE[0], CONTACT_ERASE[1]),
      financials: canSeeFinancials(c),
      managesAll: managesAllDeals(c),
    },
    200,
  );
});
