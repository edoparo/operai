/**
 * `GET /source-details?source=event|referral|other` (specs/20261101-crm US-7): the
 * details already written for one lead source, across companies and deals, so
 * the forms can offer them and the same event is not recorded three ways.
 *
 * Every `crm:access` holder already reads every company and deal with its
 * source detail (ADR 20261101-crm-tool-shape-and-authorization), so this projection reuses that gate and needs no
 * permission of its own (ADR 20260811-derived-projection-reuses-existing-gate-reconstructibility-test's reconstructibility test). The list is the
 * whole corpus for that source, matched in the browser: the typed text never
 * reaches the server (ADR 20260811-client-side-autocomplete-server-projected-corpus-app-code-folding's shape).
 *
 * Spellings that differ only by case, accents or spacing are one entry; the
 * most used spelling names it. Ordered by use, then alphabetically.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { authorized } from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import { db } from "../lib/db";
import { commonErrors } from "../lib/http";
import { validationHook } from "../lib/problem";

/** More than any form needs; the rarest entries drop first. */
export const MAX_SOURCE_DETAILS = 300;

const DETAILED_SOURCES = ["event", "referral", "other"] as const;

/** The key two spellings of the same detail share: no case, no accents, single spaces. */
export const foldDetail = (value: string): string =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const listRoute = createRoute({
  method: "get",
  path: "/source-details",
  tags: ["Companies"],
  summary: "Details already written for a lead source",
  middleware: authorized,
  request: { query: z.object({ source: z.enum(DETAILED_SOURCES) }) },
  responses: {
    200: {
      description: "Distinct details, most used first",
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(z.object({ value: z.string(), count: z.number().int() })),
          }),
        },
      },
    },
    ...commonErrors,
  },
});

export const sourceDetailsRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({
  defaultHook: validationHook,
});

sourceDetailsRouter.openapi(listRoute, async (c) => {
  const { source } = c.req.valid("query");
  const where = { source, sourceDetail: { not: null } } as const;
  const [companies, deals] = await Promise.all([
    db.company.groupBy({ by: ["sourceDetail"], where, _count: { _all: true } }),
    db.deal.groupBy({ by: ["sourceDetail"], where, _count: { _all: true } }),
  ]);

  // key → total count, and per spelling its own count (the most used one names the entry)
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const row of [...companies, ...deals]) {
    const spelling = row.sourceDetail?.trim().replace(/\s+/g, " ");
    if (!spelling) continue;
    const key = foldDetail(spelling);
    const group = groups.get(key) ?? { count: 0, spellings: new Map<string, number>() };
    group.count += row._count._all;
    group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + row._count._all);
    groups.set(key, group);
  }

  const items = [...groups.values()]
    .map((group) => ({
      value: [...group.spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0],
      count: group.count,
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, MAX_SOURCE_DETAILS);

  return c.json({ items }, 200);
});
