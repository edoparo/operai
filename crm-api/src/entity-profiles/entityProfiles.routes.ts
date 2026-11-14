/**
 * Letterhead, place of issue and standard terms of each wellD entity
 * (specs/20261101-crm-sales-flow O2; specs/20261102-crm-offer-document US-2).
 *
 *   GET  /entity-profiles                           deal:financials (the terms are commercial)
 *   PUT  /entity-profiles/{entity}                  deal:manage covering that entity
 *   POST /entity-profiles/{entity}/letterhead       deal:manage covering that entity: a presigned POST (PDF ≤ 5 MiB)
 *   POST /entity-profiles/{entity}/letterhead/confirm   the same: validate the upload, swap the key
 *   GET  /entity-profiles/{entity}/letterhead       deal:financials: a 60 s presigned GET
 *
 * One row per entity, replaced whole on PUT (the letterhead columns are not part
 * of it: only the upload flow moves them). Not an audit record: the offers
 * snapshot what they printed, so changing the letterhead never rewrites one.
 *
 * The letterhead upload is two-phase like the deal attachments (ADR 20260716-eu-object-storage-refund-attachments
 * posture): the browser POSTs straight to the EU bucket under
 * `letterheads/<entity>/<uuid>.pdf`, then confirm reads the object, checks it
 * with pdf-lib (one A4 page) and only then points the profile at it. A key
 * outside that entity's prefix is refused BEFORE anything is read or deleted,
 * so confirm can never be used to inspect or remove another object (no IDOR on
 * keys).
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { DEAL_FINANCIALS, DEAL_MANAGE, authorized, dealScope, requireCapability } from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import { db } from "../lib/db";
import {
  EntitySchema,
  PersonRefSchema,
  commonErrors,
  optionalText,
  requiredText,
  type HeaderSource,
} from "../lib/http";
import { loadPeople } from "../lib/people";
import { ProblemError, notFound, unprocessable, validationHook } from "../lib/problem";
import { MAX_LETTERHEAD_BYTES, requireStorage } from "../lib/storage";
import { assertInScope } from "../deals/deals.routes";
import { checkLetterhead } from "./letterhead";

const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

const ProfileBodySchema = z
  .object({
    legalName: requiredText(200),
    addressLines: z.array(z.string().trim().min(1).max(200)).max(5),
    vatNumber: optionalText(50),
    iban: optionalText(50),
    offerTermsEn: optionalText(10_000),
    offerTermsIt: optionalText(10_000),
    placeOfIssue: optionalText(100),
  })
  .strict();

const ProfileSchema = z.object({
  entity: EntitySchema,
  legalName: z.string(),
  addressLines: z.array(z.string()),
  vatNumber: z.string().nullable(),
  iban: z.string().nullable(),
  offerTermsEn: z.string().nullable(),
  offerTermsIt: z.string().nullable(),
  /** Printed beside the date of an offer; null means the default, "Lugano". */
  placeOfIssue: z.string().nullable(),
  /** Who uploaded the current letterhead and when; null when there is none. */
  letterhead: z.object({ uploadedBy: PersonRefSchema, uploadedAt: z.string() }).nullable(),
  updatedAt: z.string(),
});

const EntityParams = z.object({ entity: EntitySchema });
const manage = [...authorized, requireCapability(DEAL_MANAGE)];

const listRoute = createRoute({
  method: "get",
  path: "/entity-profiles",
  tags: ["Settings"],
  summary: "Letterhead and offer terms per entity (deal:financials)",
  middleware: [...authorized, requireCapability(DEAL_FINANCIALS)],
  responses: { 200: { description: "Profiles", ...json(z.object({ items: z.array(ProfileSchema) })) }, ...commonErrors },
});

const putRoute = createRoute({
  method: "put",
  path: "/entity-profiles/{entity}",
  tags: ["Settings"],
  summary: "Replace an entity's offer details (deal:manage over that entity); the letterhead is untouched",
  middleware: manage,
  request: {
    params: EntityParams,
    body: { content: { "application/json": { schema: ProfileBodySchema } }, required: true },
  },
  responses: { 200: { description: "Saved", ...json(ProfileSchema) }, ...commonErrors },
});

const letterheadStartRoute = createRoute({
  method: "post",
  path: "/entity-profiles/{entity}/letterhead",
  tags: ["Settings"],
  summary: "Start a letterhead upload: a presigned POST for a PDF of at most 5 MiB (deal:manage over that entity)",
  middleware: manage,
  request: { params: EntityParams },
  responses: {
    ...commonErrors,
    201: {
      description: "Upload to `upload.url` with `upload.fields`, then confirm with `key`",
      ...json(z.object({ key: z.string(), upload: z.object({ url: z.string(), fields: z.record(z.string(), z.string()) }) })),
    },
    403: { description: "out_of_scope" },
    409: { description: "entity_profile_missing" },
  },
});

const LetterheadConfirmSchema = z.object({ key: z.string().min(1).max(300) }).strict();

const letterheadConfirmRoute = createRoute({
  method: "post",
  path: "/entity-profiles/{entity}/letterhead/confirm",
  tags: ["Settings"],
  summary: "Confirm a letterhead upload: one readable A4 page, else the object is deleted (deal:manage over that entity)",
  middleware: manage,
  request: {
    params: EntityParams,
    body: { content: { "application/json": { schema: LetterheadConfirmSchema } }, required: true },
  },
  responses: {
    ...commonErrors,
    200: { description: "The profile, with the new letterhead", ...json(ProfileSchema) },
    403: { description: "out_of_scope" },
    409: { description: "entity_profile_missing / upload_missing" },
    422: { description: "letterhead_invalid (reason: not_pdf, page_count, not_a4, unembeddable, too_large) / letterhead_key_invalid" },
  },
});

const letterheadDownloadRoute = createRoute({
  method: "get",
  path: "/entity-profiles/{entity}/letterhead",
  tags: ["Settings"],
  summary: "A 60 s download link for the entity's letterhead (deal:financials)",
  middleware: [...authorized, requireCapability(DEAL_FINANCIALS)],
  request: { params: EntityParams },
  responses: { 200: { description: "Presigned URL", ...json(z.object({ url: z.string() })) }, 404: { description: "No letterhead" }, ...commonErrors },
});

export const entityProfilesRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({
  defaultHook: validationHook,
});

type ProfileRow = Awaited<ReturnType<typeof db.entityProfile.findUniqueOrThrow>>;

async function toViews(c: HeaderSource, rows: readonly ProfileRow[]) {
  const { person } = await loadPeople(c, rows.map((row) => row.letterheadBy));
  return rows.map((row) => ({
    entity: row.entity,
    legalName: row.legalName,
    addressLines: row.addressLines,
    vatNumber: row.vatNumber,
    iban: row.iban,
    offerTermsEn: row.offerTermsEn,
    offerTermsIt: row.offerTermsIt,
    placeOfIssue: row.placeOfIssue,
    letterhead:
      row.letterheadKey && row.letterheadAt && row.letterheadBy
        ? { uploadedBy: person(row.letterheadBy), uploadedAt: row.letterheadAt.toISOString() }
        : null,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

const profileMissing = (entity: string) =>
  new ProblemError({
    status: 409,
    code: "entity_profile_missing",
    detail: "Save the entity's offer details before uploading its letterhead",
    extras: { entity },
  });

entityProfilesRouter.openapi(listRoute, async (c) => {
  const rows = await db.entityProfile.findMany({ orderBy: { entity: "asc" } });
  return c.json({ items: await toViews(c, rows) }, 200);
});

entityProfilesRouter.openapi(putRoute, async (c) => {
  const { entity } = c.req.valid("param");
  const body = c.req.valid("json");
  assertInScope(dealScope(c), entity);
  const data = {
    legalName: body.legalName,
    addressLines: body.addressLines,
    vatNumber: body.vatNumber ?? null,
    iban: body.iban ?? null,
    offerTermsEn: body.offerTermsEn ?? null,
    offerTermsIt: body.offerTermsIt ?? null,
    placeOfIssue: body.placeOfIssue ?? null,
    updatedBy: c.get("userId"),
  };
  const row = await db.entityProfile.upsert({ where: { entity }, create: { entity, ...data }, update: data });
  return c.json((await toViews(c, [row]))[0]!, 200);
});

/** `letterheads/<entity>/<uuid>.pdf`, the only shape this service ever mints. */
const letterheadKeyPattern = (entity: string) =>
  new RegExp(`^letterheads/${entity}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.pdf$`);

entityProfilesRouter.openapi(letterheadStartRoute, async (c) => {
  const { entity } = c.req.valid("param");
  assertInScope(dealScope(c), entity);
  if (!(await db.entityProfile.findUnique({ where: { entity }, select: { entity: true } }))) throw profileMissing(entity);
  const key = `letterheads/${entity}/${crypto.randomUUID()}.pdf`;
  const upload = await requireStorage().mintPresignedPost(key, "application/pdf", MAX_LETTERHEAD_BYTES);
  return c.json({ key, upload }, 201);
});

async function deleteQuietly(key: string): Promise<void> {
  try {
    await requireStorage().deleteObject(key);
  } catch (error) {
    console.error("[letterhead] could not delete the object:", key, error instanceof Error ? error.message : error);
  }
}

entityProfilesRouter.openapi(letterheadConfirmRoute, async (c) => {
  const { entity } = c.req.valid("param");
  const { key } = c.req.valid("json");
  assertInScope(dealScope(c), entity);
  const profile = await db.entityProfile.findUnique({ where: { entity } });
  if (!profile) throw profileMissing(entity);
  // Before anything is read or deleted: only this entity's own upload keys.
  if (!letterheadKeyPattern(entity).test(key)) {
    throw unprocessable("The key is not a letterhead upload of this entity", { field: "key" }, "letterhead_key_invalid");
  }
  const storage = requireStorage();
  const head = await storage.headObject(key);
  if (!head) throw new ProblemError({ status: 409, code: "upload_missing", detail: "The file has not reached storage yet" });

  const invalid = async (reason: string): Promise<never> => {
    await deleteQuietly(key);
    throw unprocessable(
      "The letterhead must be a readable PDF of exactly one A4 page",
      { field: "key", reason },
      "letterhead_invalid",
    );
  };
  if (head.sizeBytes > MAX_LETTERHEAD_BYTES) return invalid("too_large");
  const verdict = await checkLetterhead(await storage.getObject(key, MAX_LETTERHEAD_BYTES));
  if (!verdict.ok) return invalid(verdict.reason);

  const previous = profile.letterheadKey;
  const row = await db.entityProfile.update({
    where: { entity },
    data: { letterheadKey: key, letterheadBy: c.get("userId"), letterheadAt: new Date() },
  });
  if (previous && previous !== key) await deleteQuietly(previous);
  return c.json((await toViews(c, [row]))[0]!, 200);
});

entityProfilesRouter.openapi(letterheadDownloadRoute, async (c) => {
  const { entity } = c.req.valid("param");
  const profile = await db.entityProfile.findUnique({ where: { entity }, select: { letterheadKey: true } });
  if (!profile?.letterheadKey) throw notFound("No letterhead has been uploaded for this entity");
  const url = await requireStorage().mintPresignedGet(profile.letterheadKey, {
    contentType: "application/pdf",
    fileName: `letterhead-${entity}.pdf`,
  });
  return c.json({ url }, 200);
});
