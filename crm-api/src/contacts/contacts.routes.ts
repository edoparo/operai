/**
 * Contacts (specs/017-crm US-2; plan.md § Contacts). Every route needs
 * `crm:access`; erasure additionally needs `contact:erase` (D-13). Writes to an
 * existing contact carry `If-Match` (D-7).
 *
 * A contact is a third party's personal data: nothing here logs a body or a
 * search term (src/lib/logger.ts drops the query string).
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { CONTACT_ERASE, authorized, requireCapability } from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import { db } from "../lib/db";
import type { Prisma } from "../lib/generated/prisma/client";
import {
  ArchivedFilterSchema,
  IdParams,
  archivedWhere,
  assertVersion,
  commonErrors,
  definedOnly,
  etag,
  isRecordNotFound,
  optionalText,
  pageOf,
  pageQuery,
  sortQuery,
  requireIfMatch,
  requiredText,
  skipTake,
  versionConflict,
  type HeaderSource,
} from "../lib/http";
import { notFound, unprocessable, validationHook } from "../lib/problem";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const EmailSchema = z
  .string()
  .max(254)
  .transform((v) => v.trim())
  .refine((v) => v === "" || z.string().email().safeParse(v).success, "Not an email address")
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const CompanyIdSchema = z.string().min(1).max(64).nullable().optional();

export const CreateContactSchema = z
  .object({
    firstName: requiredText(100),
    lastName: requiredText(100),
    email: EmailSchema,
    phone: optionalText(50),
    jobTitle: optionalText(100),
    companyId: CompanyIdSchema,
    notes: optionalText(10_000),
  })
  .strict();

export const UpdateContactSchema = z
  .object({
    firstName: requiredText(100).optional(),
    lastName: requiredText(100).optional(),
    email: EmailSchema,
    phone: optionalText(50),
    jobTitle: optionalText(100),
    companyId: CompanyIdSchema,
    notes: optionalText(10_000),
  })
  .strict();

/** The columns a contact list sorts by (US-9). */
const CONTACT_SORTS = ["name", "company", "jobTitle", "email"] as const;

const ListContactsQuery = z.object({
  q: z.string().max(200).optional(),
  companyId: z.string().max(64).optional(),
  archived: ArchivedFilterSchema,
  ...sortQuery(CONTACT_SORTS),
  ...pageQuery(),
});

/** US-9: the asked column first (empty values last), then last and first name, then the id. */
function contactOrder(
  sort: (typeof CONTACT_SORTS)[number] | undefined,
  order: "asc" | "desc",
): Prisma.ContactOrderByWithRelationInput[] {
  const byName = (direction: "asc" | "desc"): Prisma.ContactOrderByWithRelationInput[] => [
    { lastName: direction },
    { firstName: direction },
    { id: direction },
  ];
  switch (sort) {
    case undefined:
    case "name":
      return byName(order);
    case "company":
      return [{ company: { name: order } }, ...byName("asc")];
    default:
      return [{ [sort]: { sort: order, nulls: "last" } }, ...byName("asc")];
  }
}

const CompanyRefSchema = z.object({ id: z.string(), name: z.string() });

export const ContactSummarySchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  jobTitle: z.string().nullable(),
  company: CompanyRefSchema.nullable(),
  archived: z.boolean(),
  updatedAt: z.string(),
});

export const ContactSchema = ContactSummarySchema.extend({
  notes: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
});

// ─── Views ───────────────────────────────────────────────────────────────────

const withCompany = { company: { select: { id: true, name: true } } } satisfies Prisma.ContactInclude;
type ContactRow = Prisma.ContactGetPayload<{ include: typeof withCompany }>;

const toSummary = (row: ContactRow) => ({
  id: row.id,
  firstName: row.firstName,
  lastName: row.lastName,
  email: row.email,
  phone: row.phone,
  jobTitle: row.jobTitle,
  company: row.company,
  archived: row.archivedAt !== null,
  updatedAt: row.updatedAt.toISOString(),
});

const toView = (row: ContactRow) => ({
  ...toSummary(row),
  notes: row.notes,
  version: row.version,
  createdAt: row.createdAt.toISOString(),
});

/** A contact's company must exist (archived is fine: you may record an old client's people). */
async function assertCompany(companyId: string | null | undefined): Promise<void> {
  if (!companyId) return;
  const company = await db.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) {
    throw unprocessable("The company does not exist", { field: "companyId" }, "company_not_found");
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });
const concurrency = {
  404: { description: "Not found" },
  409: { description: "version_conflict" },
  428: { description: "precondition_required" },
} as const;

const listRoute = createRoute({
  method: "get",
  path: "/contacts",
  tags: ["Contacts"],
  summary: "List contacts, by last then first name",
  middleware: authorized,
  request: { query: ListContactsQuery },
  responses: { 200: { description: "A page of contacts", ...json(pageOf(ContactSummarySchema)) }, ...commonErrors },
});

const createContactRoute = createRoute({
  method: "post",
  path: "/contacts",
  tags: ["Contacts"],
  summary: "Create a contact",
  middleware: authorized,
  request: { body: { content: { "application/json": { schema: CreateContactSchema } }, required: true } },
  responses: { 201: { description: "Created", ...json(ContactSchema) }, ...commonErrors },
});

const getRoute = createRoute({
  method: "get",
  path: "/contacts/{id}",
  tags: ["Contacts"],
  summary: "Get a contact",
  middleware: authorized,
  request: { params: IdParams },
  responses: { 200: { description: "The contact", ...json(ContactSchema) }, 404: { description: "Not found" }, ...commonErrors },
});

const updateRoute = createRoute({
  method: "patch",
  path: "/contacts/{id}",
  tags: ["Contacts"],
  summary: "Edit a contact (If-Match required)",
  middleware: authorized,
  request: {
    params: IdParams,
    body: { content: { "application/json": { schema: UpdateContactSchema } }, required: true },
  },
  responses: { 200: { description: "Updated", ...json(ContactSchema) }, ...concurrency, ...commonErrors },
});

const archiveRoute = (action: "archive" | "unarchive") =>
  createRoute({
    method: "post",
    path: `/contacts/{id}/${action}`,
    tags: ["Contacts"],
    summary: action === "archive" ? "Archive a contact (If-Match required)" : "Unarchive a contact (If-Match required)",
    middleware: authorized,
    request: { params: IdParams },
    responses: { 200: { description: "The contact", ...json(ContactSchema) }, ...concurrency, ...commonErrors },
  });

const eraseRoute = createRoute({
  method: "delete",
  path: "/contacts/{id}",
  tags: ["Contacts"],
  summary: "Erase a contact's personal data (contact:erase; irreversible)",
  description:
    "Deletes the contact. Activities that referenced it keep their row with no contact (D-13). " +
    "Free-text activity bodies are not scrubbed.",
  middleware: [...authorized, requireCapability(CONTACT_ERASE)],
  request: { params: IdParams },
  responses: { 204: { description: "Erased" }, 404: { description: "Not found" }, ...commonErrors },
});

export const contactsRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({
  defaultHook: validationHook,
});

contactsRouter.openapi(listRoute, async (c) => {
  const { q, companyId, archived, sort, order, page, pageSize } = c.req.valid("query");
  const term = q?.trim();
  const where: Prisma.ContactWhereInput = {
    ...archivedWhere(archived),
    ...(companyId ? { companyId } : {}),
    ...(term
      ? {
          OR: [
            { firstName: { contains: term, mode: "insensitive" } },
            { lastName: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    db.contact.count({ where }),
    db.contact.findMany({
      where,
      include: withCompany,
      orderBy: contactOrder(sort, order),
      ...skipTake(page, pageSize),
    }),
  ]);
  return c.json({ items: rows.map(toSummary), total, page, pageSize }, 200);
});

contactsRouter.openapi(createContactRoute, async (c) => {
  const body = c.req.valid("json");
  const userId = c.get("userId");
  await assertCompany(body.companyId);
  const row = await db.contact.create({
    data: {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email ?? null,
      phone: body.phone ?? null,
      jobTitle: body.jobTitle ?? null,
      companyId: body.companyId ?? null,
      notes: body.notes ?? null,
      createdBy: userId,
      updatedBy: userId,
    },
    include: withCompany,
  });
  c.header("ETag", etag(row.version));
  return c.json(toView(row), 201);
});

contactsRouter.openapi(getRoute, async (c) => {
  const { id } = c.req.valid("param");
  const row = await db.contact.findUnique({ where: { id }, include: withCompany });
  if (!row) throw notFound("Contact not found");
  c.header("ETag", etag(row.version));
  return c.json(toView(row), 200);
});

async function casUpdate(
  c: HeaderSource & { get(key: "userId"): string },
  id: string,
  data: Prisma.ContactUncheckedUpdateInput,
) {
  const expected = requireIfMatch(c);
  const current = await db.contact.findUnique({ where: { id }, select: { version: true } });
  if (!current) throw notFound("Contact not found");
  assertVersion(current.version, expected);
  try {
    return await db.contact.update({
      where: { id, version: expected },
      data: { ...data, version: { increment: 1 }, updatedBy: c.get("userId") },
      include: withCompany,
    });
  } catch (error) {
    if (isRecordNotFound(error)) {
      const now = await db.contact.findUnique({ where: { id }, select: { version: true } });
      if (!now) throw notFound("Contact not found");
      throw versionConflict(now.version);
    }
    throw error;
  }
}

contactsRouter.openapi(updateRoute, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  requireIfMatch(c);
  await assertCompany(body.companyId);
  const row = await casUpdate(c, id, definedOnly(body));
  c.header("ETag", etag(row.version));
  return c.json(toView(row), 200);
});

for (const action of ["archive", "unarchive"] as const) {
  contactsRouter.openapi(archiveRoute(action), async (c) => {
    const { id } = c.req.valid("param");
    const row = await casUpdate(c, id, { archivedAt: action === "archive" ? new Date() : null });
    c.header("ETag", etag(row.version));
    return c.json(toView(row), 200);
  });
}

contactsRouter.openapi(eraseRoute, async (c) => {
  const { id } = c.req.valid("param");
  // `activity.contactId` is ON DELETE SET NULL: one statement erases the row
  // and unlinks every activity that referenced it.
  const { count } = await db.contact.deleteMany({ where: { id } });
  if (count === 0) throw notFound("Contact not found");
  // Logged without any personal data: who erased, which opaque id.
  console.log(`[contacts] erased contact ${id} by ${c.get("userId")}`);
  return c.body(null, 204);
});
