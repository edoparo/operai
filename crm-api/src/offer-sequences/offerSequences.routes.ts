/**
 * Offer numbering (specs/20261102-crm-offer-document US-8, 2026-11-04): where an entity's offer numbers
 * continue from, so the CRM follows wellD's document system instead of starting
 * at 1. The counter is `offer_sequence` (entity, year, last); generation takes
 * `last + 1` (offers.routes). Setting the next number can never hand out a
 * number an offer of that entity and year already carries.
 *
 *   GET /offer-sequences/{entity}   this year's next number and the lowest it may be
 *   PUT /offer-sequences/{entity}   set the next number for this year or the next
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { DEAL_FINANCIALS, DEAL_MANAGE, authorized, dealScope, requireCapability } from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import { db } from "../lib/db";
import { EntitySchema, commonErrors } from "../lib/http";
import { ProblemError, unprocessable, validationHook } from "../lib/problem";
import { assertInScope } from "../deals/deals.routes";

/** Four digits are printed (`0017/2026`); the counter stays within them. */
export const MAX_OFFER_NUMBER = 9_999;

const manage = [...authorized, requireCapability(DEAL_FINANCIALS), requireCapability(DEAL_MANAGE)];
const EntityParams = z.object({ entity: EntitySchema });

const SequenceSchema = z.object({
  entity: EntitySchema,
  year: z.number().int(),
  /** The number the entity's next new offer of `year` takes. */
  next: z.number().int(),
  /** One above the highest number an offer of that entity and year carries (1 when none). */
  lowestAllowed: z.number().int(),
});

const SetSequenceSchema = z
  .object({
    year: z.number().int(),
    next: z.number().int().min(1).max(MAX_OFFER_NUMBER),
  })
  .strict();

const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

const getRoute = createRoute({
  method: "get",
  path: "/offer-sequences/{entity}",
  tags: ["Offers"],
  summary: "This year's next offer number of an entity (deal:manage in scope + deal:financials)",
  middleware: manage,
  request: { params: EntityParams },
  responses: { 200: { description: "The numbering", ...json(SequenceSchema) }, ...commonErrors },
});

const putRoute = createRoute({
  method: "put",
  path: "/offer-sequences/{entity}",
  tags: ["Offers"],
  summary: "Set where an entity's offer numbers continue from, for this year or the next",
  middleware: manage,
  request: { params: EntityParams, body: { content: { "application/json": { schema: SetSequenceSchema } }, required: true } },
  responses: {
    ...commonErrors,
    200: { description: "The numbering", ...json(SequenceSchema) },
    409: { description: "offer_number_used: an offer already carries that number or a higher one" },
    422: { description: "Validation; year_out_of_range" },
  },
});

export const offerSequencesRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({
  defaultHook: validationHook,
});

type Tx = Pick<typeof db, "dealOffer" | "offerSequence">;

/** The highest number an offer of this entity and year carries, deleted ones included (never reused). */
async function highestUsed(tx: Tx, entity: "welld_ch" | "welld_it", year: number): Promise<number> {
  const used = await tx.dealOffer.aggregate({
    where: { sequenceYear: year, deal: { entity } },
    _max: { sequenceNo: true },
  });
  return used._max.sequenceNo ?? 0;
}

async function viewOf(tx: Tx, entity: "welld_ch" | "welld_it", year: number) {
  const row = await tx.offerSequence.findUnique({ where: { entity_year: { entity, year } } });
  return { entity, year, next: (row?.last ?? 0) + 1, lowestAllowed: (await highestUsed(tx, entity, year)) + 1 };
}

offerSequencesRouter.openapi(getRoute, async (c) => {
  const { entity } = c.req.valid("param");
  assertInScope(dealScope(c), entity);
  return c.json(await viewOf(db, entity, new Date().getUTCFullYear()), 200);
});

offerSequencesRouter.openapi(putRoute, async (c) => {
  const { entity } = c.req.valid("param");
  const { year, next } = c.req.valid("json");
  assertInScope(dealScope(c), entity);
  const thisYear = new Date().getUTCFullYear();
  // This year, or the next one ahead of January; past years are closed.
  if (year !== thisYear && year !== thisYear + 1) {
    throw unprocessable("Set the numbering of this year or the next", { field: "year" }, "year_out_of_range");
  }
  const view = await db.$transaction(async (tx) => {
    // Generation takes the counter row with INSERT … ON CONFLICT, so this lock waits for any
    // generation in flight, and the check below sees the number it took.
    await tx.$executeRaw`
      INSERT INTO "offer_sequence" ("entity", "year", "last")
      VALUES (${entity}::"Entity", ${year}, 0)
      ON CONFLICT ("entity", "year") DO NOTHING`;
    await tx.$queryRaw`SELECT 1 FROM "offer_sequence" WHERE "entity" = ${entity}::"Entity" AND "year" = ${year} FOR UPDATE`;
    const used = await highestUsed(tx, entity, year);
    if (next <= used) {
      throw new ProblemError({
        status: 409,
        code: "offer_number_used",
        detail: `An offer already carries number ${used} of ${year}: the next one must be ${used + 1} or more`,
        extras: { field: "next", lowestAllowed: used + 1 },
      });
    }
    await tx.offerSequence.update({ where: { entity_year: { entity, year } }, data: { last: next - 1 } });
    return viewOf(tx, entity, year);
  });
  return c.json(view, 200);
});
