/**
 * Offices that hold assets (specs/20261006-hardware-inventory US-14).
 *
 *   GET   /offices                          asset:manage or ledger:manage: every office, archived included, name order
 *   POST  /offices                          asset:manage over the office's entity
 *   PATCH /offices/{id}                     asset:manage over the office's entity (and the new one when it changes)
 *   POST  /assets/{id}/office-assignment    asset:manage over the ASSET's entity: an in_stock asset goes to an office
 *
 * An office is never deleted: archived, it keeps the history and the assets that point at it, and it takes no new
 * asset. Archiving one that still holds assets is refused (409 `office_in_use`). The office's entity is information
 * only (the owner, 2026-11-18): an asset of either entity may sit in any office.
 *
 * Assigning to an office is IMMEDIATE: no one confirms it (a person's assignment stays pending until they confirm,
 * US-2). The asset becomes `assigned`, held by the office and by no person; the existing `return`, `lost` and dispose
 * clear it like a person, and repair keeps it.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ASSET_MANAGE, LEDGER_MANAGE, authorized, requireCapability } from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import { assetInScope, scopeFor } from "../authz/conditions";
import { db } from "../lib/db";
import { conflict, forbidden, notFound, unprocessable, validationHook } from "../lib/problem";
import { recordEvent } from "../history/record";
import { lockAsset } from "../assets/lockAsset";
import { findAsset } from "../assets/read.repo";
import { project } from "../assets/read.routes";
import { AssetViewSchema } from "../assets/register.schemas";
import { EntitySchema } from "../depreciation/rules.schemas";

const NameSchema = z.string().trim().min(1).max(80);

const OfficeSchema = z.object({
  id: z.string(),
  name: z.string(),
  entity: EntitySchema,
  archived: z.boolean(),
  /** Assets it holds now. */
  assetCount: z.number().int(),
});
type OfficeView = z.infer<typeof OfficeSchema>;

const CreateBody = z.object({ name: NameSchema, entity: EntitySchema }).strict();
const PatchBody = z.object({ name: NameSchema.optional(), entity: EntitySchema.optional(), archived: z.boolean().optional() }).strict();
const AssignBody = z.object({ officeId: z.string().trim().min(1).max(64) }).strict();
const IdParams = z.object({ id: z.string().min(1).max(64) });
const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === "object" && err !== null && ((err as { code?: unknown }).code === "P2002" || String((err as { message?: unknown }).message ?? "").includes("office_name_ci_key"));

const nameTaken = () => conflict("office_name_taken", "An office with this name already exists");

async function viewOf(id: string): Promise<OfficeView> {
  const office = await db.office.findUnique({ where: { id }, include: { _count: { select: { assets: true } } } });
  if (!office) throw notFound("Office not found");
  return { id: office.id, name: office.name, entity: office.entity, archived: office.archivedAt !== null, assetCount: office._count.assets };
}

const listRoute = createRoute({
  method: "get",
  path: "/offices",
  tags: ["Offices"],
  summary: "Every office, archived included",
  middleware: [...authorized, requireCapability(ASSET_MANAGE, LEDGER_MANAGE)],
  responses: { 200: { description: "The offices", ...json(z.object({ items: z.array(OfficeSchema) })) } },
});

const createRouteDef = createRoute({
  method: "post",
  path: "/offices",
  tags: ["Offices"],
  summary: "Add an office",
  middleware: [...authorized, requireCapability(ASSET_MANAGE)],
  request: { body: { content: { "application/json": { schema: CreateBody } }, required: true } },
  responses: {
    201: { description: "The office", ...json(OfficeSchema) },
    403: { description: "asset:manage required, or entity out of scope" },
    409: { description: "office_name_taken" },
  },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/offices/{id}",
  tags: ["Offices"],
  summary: "Rename, move to another entity, archive or restore an office",
  middleware: [...authorized, requireCapability(ASSET_MANAGE)],
  request: { params: IdParams, body: { content: { "application/json": { schema: PatchBody } }, required: true } },
  responses: {
    200: { description: "The office", ...json(OfficeSchema) },
    403: { description: "the new entity is out of scope" },
    404: { description: "Unknown or out of scope" },
    409: { description: "office_name_taken | office_in_use" },
  },
});

const assignRoute = createRoute({
  method: "post",
  path: "/assets/{id}/office-assignment",
  tags: ["Offices"],
  summary: "Put an in_stock asset in an office (immediate, no confirmation)",
  middleware: [...authorized, requireCapability(ASSET_MANAGE)],
  request: { params: IdParams, body: { content: { "application/json": { schema: AssignBody } }, required: true } },
  responses: {
    200: { description: "The asset, held by the office", ...json(AssetViewSchema) },
    404: { description: "Unknown or out of scope" },
    409: { description: "invalid_transition | assignment_pending | asset_disposed" },
    422: { description: "office_not_found (unknown or archived)" },
  },
});

export const officesRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({ defaultHook: validationHook });

officesRouter.openapi(listRoute, async (c) => {
  const rows = await db.office.findMany({ include: { _count: { select: { assets: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  return c.json(
    { items: rows.map((o) => ({ id: o.id, name: o.name, entity: o.entity, archived: o.archivedAt !== null, assetCount: o._count.assets })) },
    200,
  );
});

officesRouter.openapi(createRouteDef, async (c) => {
  const body = c.req.valid("json");
  const { permissions, entity } = c.get("authz");
  if (!assetInScope(body, scopeFor(permissions, "asset", "manage", entity))) throw forbidden("You may not add offices for this entity");
  try {
    const row = await db.office.create({ data: { name: body.name, entity: body.entity } });
    return c.json(await viewOf(row.id), 201);
  } catch (err) {
    if (isUniqueViolation(err)) throw nameTaken();
    throw err;
  }
});

officesRouter.openapi(patchRoute, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const { permissions, entity } = c.get("authz");
  const scope = scopeFor(permissions, "asset", "manage", entity);
  const office = await db.office.findUnique({ where: { id } });
  if (!office || !assetInScope(office, scope)) throw notFound("Office not found");
  if (body.entity !== undefined && !assetInScope({ entity: body.entity }, scope)) throw forbidden("You may not move an office to this entity");

  try {
    await db.$transaction(async (tx) => {
      // The office row lock serialises an archive against an assignment to it (which reads it under the same lock).
      await tx.$executeRaw`SELECT 1 FROM "office" WHERE "id" = ${id} FOR UPDATE`;
      if (body.archived === true) {
        const held = await tx.asset.count({ where: { holderOfficeId: id } });
        if (held > 0) throw conflict("office_in_use", "This office still holds assets: return or move them first", { assetCount: held });
      }
      await tx.office.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.entity !== undefined ? { entity: body.entity } : {}),
          ...(body.archived !== undefined ? { archivedAt: body.archived ? (office.archivedAt ?? new Date()) : null } : {}),
        },
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw nameTaken();
    throw err;
  }
  return c.json(await viewOf(id), 200);
});

officesRouter.openapi(assignRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { officeId } = c.req.valid("json");
  const { permissions, entity } = c.get("authz");
  const authorization = c.req.header("Authorization")!;

  const row = await findAsset(id);
  if (!row || !assetInScope(row, scopeFor(permissions, "asset", "manage", entity))) throw notFound("Asset not found");
  const actor = { userId: c.get("userId"), email: c.get("email") };

  await db.$transaction(async (tx) => {
    await lockAsset(tx, id);
    await tx.$executeRaw`SELECT 1 FROM "office" WHERE "id" = ${officeId} FOR UPDATE`;
    const office = await tx.office.findUnique({ where: { id: officeId } });
    if (!office || office.archivedAt !== null) {
      throw unprocessable("Choose an office that exists and is not archived", { field: "officeId" }, "office_not_found");
    }
    const asset = await tx.asset.findUnique({ where: { id } });
    if (!asset) throw notFound("Asset not found");
    if (asset.status === "disposed") throw conflict("asset_disposed", "A disposed asset accepts no further changes", { assetId: id });
    if (asset.status !== "in_stock") {
      throw conflict("invalid_transition", `Only an in_stock asset can be assigned, this one is ${asset.status}`, { from: asset.status });
    }
    const pending = await tx.assignment.findFirst({ where: { assetId: id, status: "pending" }, select: { id: true } });
    if (pending) throw conflict("assignment_pending", "This asset already has a pending assignment", { assignmentId: pending.id });

    const cas = await tx.asset.updateMany({
      where: { id, status: "in_stock", holderUserId: null, holderOfficeId: null },
      data: { status: "assigned", holderOfficeId: office.id },
    });
    if (cas.count !== 1) throw conflict("invalid_transition", "The asset changed while this was being applied", { from: asset.status });
    await recordEvent(tx, {
      assetId: id,
      entity: asset.entity,
      action: "assigned_to_office",
      actor,
      changes: [
        { field: "status", from: "in_stock", to: "assigned" },
        { field: "office", from: null, to: office.name },
      ],
    });
  });

  const fresh = await findAsset(id);
  if (!fresh) throw notFound("Asset not found");
  const [view] = await project([fresh], authorization, scopeFor(permissions, "ledger", "manage", entity), true);
  return c.json(view!, 200);
});
