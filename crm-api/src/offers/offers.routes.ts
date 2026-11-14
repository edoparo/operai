/**
 * Offer documents (specs/20261101-crm-sales-flow US-4; specs/20261102-crm-offer-document plan.md § API).
 *
 *   GET    /deals/{id}/offers                      versions, deleted ones included (the gap is visible)
 *   GET    /deals/{id}/offers/draft?templateId=    the dialog prefill from a template (placeholders resolved)
 *   POST   /deals/{id}/offers                      generate the next version from a template-based body
 *   GET    /deals/{id}/offers/{offerId}/download   60 s presigned GET
 *   DELETE /deals/{id}/offers/{offerId}            author or admin; the number is never reused
 *
 * Every route is financial (`deal:financials`, ADR 20261101-crm-financial-visibility-permission): an offer prints the
 * price. Drafting and generating also need `deal:manage` over the deal's entity
 * and a ready estimate. The PDF is rendered here from a snapshot that is stored
 * with the row, so the figures a client received can always be shown again; it
 * lives in the CRM's EU bucket. Generating reads the entity's letterhead and the
 * chosen deal PDFs from that bucket (ADR 20261102-crm-api-reads-attachment-bytes-for-offer-annexes): sizes are bounded from the
 * database before any byte is read.
 *
 * The reference is `NNNN/YYYY` (D-5): the next number of the deal's entity in
 * the year of the deal's first offer, then `r1`, `r2`… for each later version of
 * the same deal. Specs/018 offers (`OF-…`, no `kind` in their snapshot) keep
 * listing and downloading as they were.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  DEAL_FINANCIALS,
  DEAL_MANAGE,
  authorized,
  dealScope,
  managesAllDeals,
  requireCapability,
} from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import { db } from "../lib/db";
import { getEstimate, type EstimateDocument } from "../lib/estimai";
import {
  IdParams,
  PersonRefSchema,
  assertVersion,
  commonErrors,
  etag,
  requireIfMatch,
  versionConflict,
  type HeaderSource,
} from "../lib/http";
import { MAX_NAME, announce, clip } from "../lib/notify";
import { loadPeople } from "../lib/people";
import { ProblemError, conflict, forbidden, notFound, unprocessable, validationHook } from "../lib/problem";
import { MAX_OFFER_ATTACHMENT_BYTES, requireStorage, type Storage } from "../lib/storage";
import { assertInScope } from "../deals/deals.routes";
import { computeCosts } from "./costs";
import type {
  ContractSnapshot,
  OfferAttachmentRef,
  OfferLanguage,
  OfferSection,
  OfferTemplateContent,
} from "./contract";
import { renderContractPdf } from "./contractPdf";
import { DEFAULT_VALIDITY_DAYS, buildDraft, type OfferDraft } from "./draft";
import { CostColumnsSchema, GenerateOfferSchema, SectionSchema } from "./offerSchemas";
import { scopeLabels, type OfferSnapshot } from "./pdf";
import { buildScope, roundHalfUp, totalManDays } from "./scope";

export { DEFAULT_VALIDITY_DAYS };

const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });
const financial = [...authorized, requireCapability(DEAL_FINANCIALS)];
const generating = [...authorized, requireCapability(DEAL_FINANCIALS), requireCapability(DEAL_MANAGE)];

const OfferParams = z.object({ id: z.string().min(1).max(64), offerId: z.string().min(1).max(64) });

const DEFAULT_PLACE = "Lugano";

const OfferSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  /** "0017/2026", "0017/2026r1"; "OF-…" for offers generated before specs/20261102-crm-offer-document. */
  reference: z.string(),
  language: z.enum(["en", "it"]),
  /** One-off lines minus discounts (specs/20261102-crm-offer-document D-6). */
  priceCents: z.number().int(),
  /** The yearly lines, shown apart as "+ CHF 2'500 per year"; 0 for older offers. */
  yearlyCents: z.number().int(),
  currency: z.enum(["CHF", "EUR"]),
  validityDays: z.number().int(),
  validUntil: z.string(),
  aiAssisted: z.boolean(),
  /** Annex A's total in tenths of a man-day; 0 when the offer has no annex. */
  manDaysTenths: z.number().int(),
  /** The template the offer started from; null for older offers. */
  templateName: z.string().nullable(),
  sizeBytes: z.number().int(),
  createdBy: PersonRefSchema,
  createdAt: z.string(),
  deleted: z.boolean(),
  /** When and by whom it was marked sent; null while it can still be edited (US-7). */
  sent: z.object({ at: z.string(), by: PersonRefSchema }).nullable(),
  /** The If-Match precondition of an edit. */
  version: z.number().int(),
});

const DraftCostLineSchema = z.object({
  description: z.string(),
  kind: z.enum(["one_off", "yearly", "discount"]),
  unitCents: z.number().int().nullable(),
  percentBp: z.number().int().nullable(),
  quantity: z.number().int(),
});

/** The dialog prefill: every field the generate body takes, plus the template's identity. */
const DraftSchema = z.object({
  templateId: z.string(),
  templateName: z.string(),
  language: z.enum(["en", "it"]),
  currency: z.enum(["CHF", "EUR"]),
  salutation: z.string(),
  clientLines: z.array(z.string()),
  opening: z.string(),
  sections: z.array(SectionSchema),
  costColumns: CostColumnsSchema,
  showTotal: z.boolean(),
  costLines: z.array(DraftCostLineSchema),
  acceptanceLabel: z.string().nullable(),
  annex: z.boolean(),
  validityDays: z.number().int(),
  aiAssisted: z.boolean(),
  /** The estimate's total expected man-days, rounded half up (AI-assisted when asked). */
  manDays: z.number().int(),
});

const DraftQuery = z.object({
  templateId: z.string().min(1).max(64),
  aiAssisted: z.enum(["true", "false"]).default("false"),
});

type OfferRow = Awaited<ReturnType<typeof db.dealOffer.findMany>>[number];
type StoredSnapshot = ContractSnapshot | OfferSnapshot;
const isContract = (snapshot: StoredSnapshot): snapshot is ContractSnapshot => "kind" in snapshot && snapshot.kind === "contract";

async function toViews(c: HeaderSource, rows: readonly OfferRow[]) {
  const { person } = await loadPeople(c, rows.flatMap((row) => [row.createdBy, ...(row.sentBy ? [row.sentBy] : [])]));
  return rows.map((row) => {
    const snapshot = row.snapshot as unknown as StoredSnapshot;
    const common = {
      id: row.id,
      number: row.number,
      reference: snapshot.reference,
      language: row.language,
      priceCents: Number(row.priceCents),
      currency: row.currency,
      validityDays: row.validityDays,
      validUntil: snapshot.validUntil,
      sizeBytes: row.sizeBytes,
      createdBy: person(row.createdBy),
      createdAt: row.createdAt.toISOString(),
      deleted: row.deletedAt !== null,
      sent: row.sentAt ? { at: row.sentAt.toISOString(), by: person(row.sentBy ?? row.createdBy) } : null,
      version: row.version,
    };
    return isContract(snapshot)
      ? {
          ...common,
          yearlyCents: snapshot.costs.yearlyCents,
          aiAssisted: snapshot.aiAssisted,
          manDaysTenths: snapshot.annex?.manDaysTenths ?? 0,
          templateName: snapshot.template.name,
        }
      : {
          ...common,
          yearlyCents: 0,
          aiAssisted: snapshot.scope.aiAssisted,
          manDaysTenths: snapshot.scope.manDaysTenths,
          templateName: null,
        };
  });
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** Four digits, a slash and the year: `0017/2026`; `r1`, `r2`… for the later versions of a deal. */
export const offerReferenceOf = (no: number, year: number, revision: number) =>
  `${String(no).padStart(4, "0")}/${year}${revision > 0 ? `r${revision}` : ""}`;

/** A reference as a file name: the slash cannot be part of one. */
const referenceFileName = (reference: string) => `${reference.replace(/[/\\]/g, "-")}.pdf`;

/** OF-2026-K3X9QZ-3: the specs/20261101-crm-sales-flow reference. Stable and unique per deal; kept for the old offers. */
export const offerReference = (dealId: string, number: number, issued: Date) =>
  `OF-${issued.getUTCFullYear()}-${dealId.slice(-6).toUpperCase()}-${number}`;

const listRoute = createRoute({
  method: "get",
  path: "/deals/{id}/offers",
  tags: ["Offers"],
  summary: "Offer versions of a deal (deal:financials)",
  middleware: financial,
  request: { params: IdParams },
  responses: { 200: { description: "Offers, newest first", ...json(z.object({ items: z.array(OfferSchema) })) }, 404: { description: "Not found" }, ...commonErrors },
});

const draftRoute = createRoute({
  method: "get",
  path: "/deals/{id}/offers/draft",
  tags: ["Offers"],
  summary: "The generate dialog's prefill from a template (deal:manage in scope + deal:financials)",
  description:
    "Resolves the template's placeholders against the deal, the company and the ready estimate. " +
    "404 when the template does not exist or belongs to another entity, 409 `template_archived`, " +
    "409 `estimate_not_ready`, 409 `entity_profile_missing`.",
  middleware: generating,
  request: { params: IdParams, query: DraftQuery },
  responses: {
    200: { description: "The prefill", ...json(DraftSchema) },
    404: { description: "Deal or template not found" },
    409: { description: "estimate_not_ready / entity_profile_missing / template_archived" },
    ...commonErrors,
  },
});

const generateRoute = createRoute({
  method: "post",
  path: "/deals/{id}/offers",
  tags: ["Offers"],
  summary: "Generate the next offer version (deal:manage in scope + deal:financials)",
  middleware: generating,
  request: { params: IdParams, body: { content: { "application/json": { schema: GenerateOfferSchema } }, required: true } },
  responses: {
    ...commonErrors,
    201: { description: "Generated", ...json(OfferSchema) },
    404: { description: "Not found" },
    409: { description: "estimate_not_ready / entity_profile_missing / template_archived" },
    422: {
      description:
        "Validation; contact_not_in_company, attachment_invalid, attachment_not_pdf, attachments_too_large, " +
        "attachment_unreadable (names the file), discounts_exceed_one_off, cost_total_too_large",
    },
  },
});

const downloadRoute = createRoute({
  method: "get",
  path: "/deals/{id}/offers/{offerId}/download",
  tags: ["Offers"],
  summary: "A short-lived download link for an offer PDF",
  middleware: financial,
  request: { params: OfferParams },
  responses: { 200: { description: "Presigned URL", ...json(z.object({ url: z.string() })) }, 404: { description: "Not found" }, ...commonErrors },
});

const formRoute = createRoute({
  method: "get",
  path: "/deals/{id}/offers/{offerId}/form",
  tags: ["Offers"],
  summary: "The dialog's prefill from an offer: to edit it, or to start its next revision (specs/20261102-crm-offer-document US-7)",
  middleware: generating,
  request: { params: OfferParams },
  responses: {
    200: {
      description: "The prefill, with the offer's contacts, still-stored PDFs, version and sent state",
      ...json(
        DraftSchema.extend({
          contactIds: z.array(z.string()),
          attachmentIds: z.array(z.string()),
          version: z.number().int(),
          sent: z.boolean(),
        }),
      ),
    },
    404: { description: "Not found" },
    409: { description: "offer_legacy" },
    ...commonErrors,
  },
});

const editRoute = createRoute({
  method: "put",
  path: "/deals/{id}/offers/{offerId}",
  tags: ["Offers"],
  summary: "Edit an offer that has not been sent: same reference, new PDF (If-Match required)",
  middleware: generating,
  request: { params: OfferParams, body: { content: { "application/json": { schema: GenerateOfferSchema } }, required: true } },
  responses: {
    ...commonErrors,
    200: { description: "Edited", ...json(OfferSchema) },
    404: { description: "Not found" },
    409: { description: "offer_sent / offer_not_latest / offer_legacy / version_conflict / template_archived" },
    428: { description: "precondition_required" },
  },
});

const sentRoute = createRoute({
  method: "post",
  path: "/deals/{id}/offers/{offerId}/sent",
  tags: ["Offers"],
  summary: "Mark an offer sent: it is frozen, and the deal moves to \"Offer sent\" (specs/20261102-crm-offer-document US-7)",
  middleware: generating,
  request: { params: OfferParams },
  responses: { 200: { description: "The offer", ...json(OfferSchema) }, 404: { description: "Not found" }, ...commonErrors },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/deals/{id}/offers/{offerId}",
  tags: ["Offers"],
  summary: "Delete an offer version (author or admin); its number stays used",
  middleware: financial,
  request: { params: OfferParams },
  responses: { 204: { description: "Deleted" }, 404: { description: "Not found" }, ...commonErrors },
});

export const offersRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({
  defaultHook: validationHook,
});

/**
 * Everything draft and generate share: the deal, its scope, the ready estimate,
 * the entity profile and an active template of the deal's entity. A deal whose
 * estimate gate an admin overrode (specs/20261101-crm-sales-flow AC-3.7) has an offer without an
 * estimate: `link` is then null and the scope, man-days and timeline are empty.
 */
async function loadContext(dealId: string, templateId: string, scope: ReturnType<typeof dealScope>) {
  const deal = await db.deal.findUnique({ where: { id: dealId }, include: { company: true, estimate: true } });
  if (!deal) throw notFound("Deal not found");
  assertInScope(scope, deal.entity);
  const link = deal.estimate?.estimateId && deal.estimate.state === "ready" ? deal.estimate : null;
  if (!link && !deal.estimate?.overrideAt) {
    throw new ProblemError({
      status: 409,
      code: "estimate_not_ready",
      detail: "An offer is generated from a ready technical estimate, or once an admin let the deal go without one",
    });
  }
  const profile = await db.entityProfile.findUnique({ where: { entity: deal.entity } });
  if (!profile) {
    throw new ProblemError({
      status: 409,
      code: "entity_profile_missing",
      detail: "Set the entity's letterhead in CRM settings before generating an offer",
      extras: { entity: deal.entity },
    });
  }
  const template = await db.offerTemplate.findUnique({ where: { id: templateId } });
  // Another entity's template is "not found", like a missing one: no existence leak across entities.
  if (!template || template.entity !== deal.entity) throw notFound("Template not found");
  if (template.archivedAt) {
    throw conflict("template_archived", "This template is archived; choose an active one", { templateId });
  }
  return { deal, link, profile, template };
}

const templateContentOf = (template: NonNullable<Awaited<ReturnType<typeof db.offerTemplate.findUnique>>>) => ({
  id: template.id,
  name: template.name,
  language: template.language,
  salutation: template.salutation,
  opening: template.opening,
  sections: template.sections as unknown as OfferSection[],
  costLines: template.costLines as unknown as OfferTemplateContent["costLines"],
  costColumns: template.costColumns as unknown as OfferTemplateContent["costColumns"],
  showTotal: template.showTotal,
  acceptanceLabel: template.acceptanceLabel,
  annex: template.annex,
});

/** The stand-in for a deal that goes without an estimate: no releases, no activities. */
const NO_ESTIMATE: EstimateDocument = { id: "", name: "", content: { params: {}, releases: [], acts: [] } };

offersRouter.openapi(listRoute, async (c) => {
  const { id } = c.req.valid("param");
  if (!(await db.deal.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Deal not found");
  const rows = await db.dealOffer.findMany({ where: { dealId: id }, orderBy: { number: "desc" } });
  return c.json({ items: await toViews(c, rows) }, 200);
});

offersRouter.openapi(draftRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { templateId, aiAssisted } = c.req.valid("query");
  const { deal, link, profile, template } = await loadContext(id, templateId, dealScope(c));
  const estimate = link ? await getEstimate(c, link.estimateId) : NO_ESTIMATE;
  const built = buildDraft({
    template: templateContentOf(template),
    deal: { title: deal.title, amountCents: deal.amountCents === null ? null : Number(deal.amountCents), currency: deal.currency },
    company: deal.company,
    issuerLegalName: profile.legalName,
    estimate,
    aiAssisted: aiAssisted === "true",
    validityDays: DEFAULT_VALIDITY_DAYS,
  });
  // Without an estimate there is no scope to append.
  const draft: OfferDraft = link ? built : { ...built, annex: false };
  return c.json(draft, 200);
});

const isUnreadable = (error: unknown): error is Error & { fileName?: string } =>
  error instanceof Error && (error.name === "AttachmentUnreadableError" || error.constructor.name === "AttachmentUnreadableError");

const attachmentUnreadable = (fileName: string) =>
  unprocessable(
    `The attachment "${fileName}" cannot be read as a PDF`,
    { field: "attachmentIds", fileName },
    "attachment_unreadable",
  );

/**
 * The chosen deal PDFs, validated and read (ADR 20261102-crm-api-reads-attachment-bytes-for-offer-annexes): this deal's, stored, not
 * deleted, PDF, in the requested order. Their total size is checked from the
 * database BEFORE the first byte is downloaded.
 */
async function loadAttachments(
  storage: Storage,
  dealId: string,
  ids: readonly string[],
): Promise<{ refs: OfferAttachmentRef[]; bytes: Uint8Array[] }> {
  if (ids.length === 0) return { refs: [], bytes: [] };
  const rows = await db.dealAttachment.findMany({
    where: { id: { in: [...ids] }, dealId, status: "stored", deletedAt: null },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = ids.map((attachmentId) => byId.get(attachmentId));
  if (ordered.some((row) => row === undefined)) {
    throw unprocessable("An attachment is not one of this deal's files", { field: "attachmentIds" }, "attachment_invalid");
  }
  const chosen = ordered as NonNullable<(typeof ordered)[number]>[];
  const notPdf = chosen.find((row) => row.contentType !== "application/pdf");
  if (notPdf) {
    throw unprocessable(
      `Only PDF files can be appended to an offer: "${notPdf.fileName}"`,
      { field: "attachmentIds", fileName: notPdf.fileName },
      "attachment_not_pdf",
    );
  }
  const total = chosen.reduce((sum, row) => sum + row.sizeBytes, 0);
  if (total > MAX_OFFER_ATTACHMENT_BYTES) {
    throw unprocessable(
      "The attachments of an offer are at most 20 MiB together",
      { field: "attachmentIds", maxBytes: MAX_OFFER_ATTACHMENT_BYTES, totalBytes: total },
      "attachments_too_large",
    );
  }
  const bytes: Uint8Array[] = [];
  for (const row of chosen) {
    try {
      bytes.push(await storage.getObject(row.objectKey, row.sizeBytes));
    } catch (error) {
      console.error("[offers] could not read an attachment:", row.objectKey, error instanceof Error ? error.message : error);
      throw attachmentUnreadable(row.fileName);
    }
  }
  return { refs: chosen.map((row) => ({ id: row.id, fileName: row.fileName, sizeBytes: row.sizeBytes })), bytes };
}

type GenerateBody = z.infer<typeof GenerateOfferSchema>;

/**
 * What generating and editing an offer share (US-3, US-7): the context checks,
 * the contacts, the costs, the chosen PDFs, the letterhead and the annex.
 */
async function prepareOffer(
  c: Parameters<typeof getEstimate>[0] & { get(key: "userId"): string },
  scope: ReturnType<typeof dealScope>,
  dealId: string,
  body: GenerateBody,
) {
  const { deal, link, profile, template } = await loadContext(dealId, body.templateId, scope);
  const language: OfferLanguage = template.language;

  const contactRows = body.contactIds.length ? await db.contact.findMany({ where: { id: { in: body.contactIds } } }) : [];
  const contactById = new Map(contactRows.map((contact) => [contact.id, contact]));
  const contacts = body.contactIds.map((contactId) => {
    const contact = contactById.get(contactId);
    if (!contact || contact.companyId !== deal.companyId) {
      throw unprocessable("A contact is not one of the company's", { field: "contactIds" }, "contact_not_in_company");
    }
    return `${contact.firstName} ${contact.lastName}`.trim();
  });

  const costs = computeCosts({
    currency: deal.currency,
    columns: body.costColumns,
    showTotal: body.showTotal,
    lines: body.costLines,
  });

  const storage = requireStorage();
  const { refs: attachments, bytes: attachmentBytes } = await loadAttachments(storage, dealId, body.attachmentIds);
  const letterhead = profile.letterheadKey ? await storage.getObject(profile.letterheadKey, 5 * 1024 * 1024) : null;
  const estimate: EstimateDocument | null = link ? await getEstimate(c, link.estimateId) : null;
  const userId = c.get("userId");
  const { person } = await loadPeople(c, [userId]);
  const annex = body.annex && estimate ? buildScope(estimate, { aiAssisted: body.aiAssisted, ...scopeLabels(language) }) : null;
  return {
    deal,
    profile,
    template,
    language,
    contacts,
    costs,
    storage,
    attachments,
    attachmentBytes,
    letterhead,
    annex,
    preparedBy: person(userId).name,
  };
}

type Prepared = Awaited<ReturnType<typeof prepareOffer>>;

function snapshotOf(prepared: Prepared, body: GenerateBody, reference: string, issued: Date): ContractSnapshot {
  const { profile, template } = prepared;
  return {
    kind: "contract",
    template: { id: template.id, name: template.name },
    language: prepared.language,
    reference,
    issuedOn: isoDate(issued),
    validUntil: isoDate(new Date(issued.getTime() + body.validityDays * 86_400_000)),
    validityDays: body.validityDays,
    place: profile.placeOfIssue ?? DEFAULT_PLACE,
    issuer: {
      legalName: profile.legalName,
      addressLines: profile.addressLines,
      vatNumber: profile.vatNumber,
      iban: profile.iban,
    },
    salutation: body.salutation,
    clientLines: body.clientLines,
    contacts: prepared.contacts,
    contactIds: body.contactIds,
    opening: body.opening,
    sections: body.sections,
    costs: prepared.costs,
    acceptanceLabel: body.acceptanceLabel ?? null,
    annex: prepared.annex,
    attachments: prepared.attachments,
    aiAssisted: body.aiAssisted,
    preparedBy: prepared.preparedBy,
  };
}

async function renderOffer(snapshot: ContractSnapshot, prepared: Prepared): Promise<Uint8Array> {
  try {
    return await renderContractPdf(snapshot, { letterhead: prepared.letterhead, attachments: prepared.attachmentBytes });
  } catch (error) {
    if (isUnreadable(error)) throw attachmentUnreadable(error.fileName ?? "");
    throw error;
  }
}

/** The deal's newest offer that is not deleted, or null. */
const latestOffer = (tx: Pick<typeof db, "dealOffer">, dealId: string) =>
  tx.dealOffer.findFirst({ where: { dealId, deletedAt: null }, orderBy: { number: "desc" } });

/**
 * US-7: a new revision only once the previous one went out; until then it is edited. An
 * offer from before offer documents cannot be edited, so it never blocks the next one.
 */
const blocksRevision = <T extends { sentAt: Date | null; snapshot: unknown }>(offer: T | null): offer is T =>
  offer !== null && offer.sentAt === null && isContract(offer.snapshot as StoredSnapshot);

const notSent = (offer: { id: string; snapshot: unknown }) =>
  new ProblemError({
    status: 409,
    code: "offer_not_sent",
    detail: `Offer ${(offer.snapshot as StoredSnapshot).reference} has not been sent: edit it instead of making a new revision`,
    extras: { offerId: offer.id },
  });

offersRouter.openapi(generateRoute, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const userId = c.get("userId");
  const latest = await latestOffer(db, id);
  if (blocksRevision(latest)) throw notSent(latest);
  const prepared = await prepareOffer(c, dealScope(c), id, body);
  const { deal } = prepared;
  const issued = new Date();

  const created = await db.$transaction(
    async (tx) => {
      // One generator at a time per deal, so versions are gap-free and never collide.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm-offer:${id}`}))`;
      const newest = await latestOffer(tx, id);
      if (blocksRevision(newest)) throw notSent(newest);
      const last = await tx.dealOffer.aggregate({ where: { dealId: id }, _max: { number: true } });
      const number = (last._max.number ?? 0) + 1;

      // D-5: a deal keeps its number and year; each later version adds a revision. Only an
      // offer still on the deal, or one the client received (sent), holds the number: when
      // every earlier one was deleted unsent, the deal takes a new number (the old one stays
      // a gap, AC-4.2), so the entity's numbering setting applies (AC-8.1).
      const sequenced = await tx.dealOffer.findMany({
        where: { dealId: id, sequenceNo: { not: null } },
        orderBy: { number: "asc" },
        select: { sequenceYear: true, sequenceNo: true, deletedAt: true, sentAt: true },
      });
      const holder = sequenced.find((offer) => offer.deletedAt === null || offer.sentAt !== null);
      let sequenceYear: number;
      let sequenceNo: number;
      let revision = 0;
      if (holder) {
        sequenceYear = holder.sequenceYear!;
        sequenceNo = holder.sequenceNo!;
        revision = sequenced.filter((offer) => offer.sequenceYear === sequenceYear && offer.sequenceNo === sequenceNo).length;
      } else {
        sequenceYear = issued.getUTCFullYear();
        const [taken] = await tx.$queryRaw<{ last: number }[]>`
          INSERT INTO "offer_sequence" ("entity", "year", "last")
          VALUES (${deal.entity}::"Entity", ${sequenceYear}, 1)
          ON CONFLICT ("entity", "year") DO UPDATE SET "last" = "offer_sequence"."last" + 1
          RETURNING "last"`;
        sequenceNo = taken!.last;
      }
      const snapshot = snapshotOf(prepared, body, offerReferenceOf(sequenceNo, sequenceYear, revision), issued);
      const pdf = await renderOffer(snapshot, prepared);
      const offerId = crypto.randomUUID();
      const objectKey = `offers/${id}/${offerId}.pdf`;
      await prepared.storage.putObject(objectKey, pdf, "application/pdf");
      try {
        return await tx.dealOffer.create({
          data: {
            id: offerId,
            dealId: id,
            number,
            language: prepared.language,
            priceCents: BigInt(prepared.costs.oneOffCents),
            currency: deal.currency,
            validityDays: body.validityDays,
            terms: null,
            sequenceYear,
            sequenceNo,
            snapshot: snapshot as unknown as object,
            objectKey,
            sizeBytes: pdf.byteLength,
            createdBy: userId,
            createdAt: issued,
          },
        });
      } catch (error) {
        // The row did not land: do not leave an unreachable object behind.
        await prepared.storage.deleteObject(objectKey).catch(() => undefined);
        throw error;
      }
    },
    { timeout: 30_000 },
  );
  const [view] = await toViews(c, [created]);
  // E9 — the owner learns an offer exists (no figure in it, AC-1.2).
  await announce(c, {
    kind: "offer_generated",
    dealId: id,
    recipientIds: [deal.ownerUserId],
    severity: "info",
    email: false,
    href: `/crm/deals/${id}`,
    copy: (actor) => ({
      title: `Offer generated: ${clip(deal.title, MAX_NAME)}`,
      body: `${actor} generated offer ${view!.reference} for ${clip(deal.title, MAX_NAME)} (${clip(deal.company.name, MAX_NAME)}).`,
    }),
  });
  c.header("ETag", etag(created.version));
  return c.json(view!, 201);
});

/** The offer of this deal, not deleted, generated from a template (specs/20261102-crm-offer-document), or a 404/409. */
async function editableTarget(dealId: string, offerId: string) {
  const offer = await db.dealOffer.findUnique({ where: { id: offerId } });
  if (!offer || offer.dealId !== dealId || offer.deletedAt) throw notFound("Offer not found");
  if (!isContract(offer.snapshot as unknown as StoredSnapshot)) {
    throw conflict("offer_legacy", "An offer generated before offer documents cannot be edited or revised", { offerId });
  }
  return offer;
}

offersRouter.openapi(formRoute, async (c) => {
  const { id, offerId } = c.req.valid("param");
  const offer = await editableTarget(id, offerId);
  const deal = await db.deal.findUnique({ where: { id }, include: { estimate: true } });
  if (!deal) throw notFound("Deal not found");
  assertInScope(dealScope(c), deal.entity);
  const snapshot = offer.snapshot as unknown as ContractSnapshot;
  // The PDFs it appended that are still this deal's: a removed one is simply not offered again.
  const stored = await db.dealAttachment.findMany({
    where: { id: { in: snapshot.attachments.map((ref) => ref.id) }, dealId: id, status: "stored", deletedAt: null },
    select: { id: true },
  });
  const storedIds = new Set(stored.map((row) => row.id));
  const link = deal.estimate?.estimateId ? deal.estimate : null;
  const manDays = link ? roundHalfUp(totalManDays(await getEstimate(c, link.estimateId), snapshot.aiAssisted)) : 0;
  c.header("ETag", etag(offer.version));
  return c.json(
    {
      templateId: snapshot.template.id,
      templateName: snapshot.template.name,
      language: snapshot.language,
      currency: snapshot.costs.currency,
      salutation: snapshot.salutation,
      clientLines: [...snapshot.clientLines],
      opening: snapshot.opening,
      sections: [...snapshot.sections],
      costColumns: snapshot.costs.columns,
      showTotal: snapshot.costs.showTotal,
      costLines: snapshot.costs.lines.map(({ description, kind, unitCents, percentBp, quantity }) => ({
        description,
        kind,
        unitCents,
        percentBp,
        quantity,
      })),
      acceptanceLabel: snapshot.acceptanceLabel,
      annex: snapshot.annex !== null,
      validityDays: snapshot.validityDays,
      aiAssisted: snapshot.aiAssisted,
      manDays,
      contactIds: [...(snapshot.contactIds ?? [])],
      attachmentIds: snapshot.attachments.map((ref) => ref.id).filter((attachmentId) => storedIds.has(attachmentId)),
      version: offer.version,
      sent: offer.sentAt !== null,
    },
    200,
  );
});

offersRouter.openapi(editRoute, async (c) => {
  const { id, offerId } = c.req.valid("param");
  const body = c.req.valid("json");
  const userId = c.get("userId");
  const expected = requireIfMatch(c);
  const offer = await editableTarget(id, offerId);
  assertVersion(offer.version, expected);
  if (offer.sentAt) {
    throw conflict("offer_sent", "This offer has been sent: make a new revision instead", { offerId });
  }
  const prepared = await prepareOffer(c, dealScope(c), id, body);
  const issued = new Date();
  const previousKey = offer.objectKey;

  const updated = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm-offer:${id}`}))`;
      const newest = await latestOffer(tx, id);
      if (newest?.id !== offerId) {
        throw conflict("offer_not_latest", "Only the newest version of an offer can be edited", { offerId });
      }
      const reference = (offer.snapshot as unknown as ContractSnapshot).reference;
      const snapshot = snapshotOf(prepared, body, reference, issued);
      const pdf = await renderOffer(snapshot, prepared);
      const objectKey = `offers/${id}/${crypto.randomUUID()}.pdf`;
      await prepared.storage.putObject(objectKey, pdf, "application/pdf");
      // Compare-and-set on the version, and never on a sent offer.
      const changed = await tx.dealOffer.updateMany({
        where: { id: offerId, version: expected, sentAt: null, deletedAt: null },
        data: {
          language: prepared.language,
          priceCents: BigInt(prepared.costs.oneOffCents),
          currency: prepared.deal.currency,
          validityDays: body.validityDays,
          snapshot: snapshot as unknown as object,
          objectKey,
          sizeBytes: pdf.byteLength,
          version: { increment: 1 },
          updatedBy: userId,
          updatedAt: issued,
        },
      });
      if (changed.count === 0) {
        await prepared.storage.deleteObject(objectKey).catch(() => undefined);
        const now = await tx.dealOffer.findUnique({ where: { id: offerId }, select: { version: true, sentAt: true } });
        if (now?.sentAt) throw conflict("offer_sent", "This offer has been sent: make a new revision instead", { offerId });
        throw versionConflict(now?.version ?? expected);
      }
      return tx.dealOffer.findUniqueOrThrow({ where: { id: offerId } });
    },
    { timeout: 30_000 },
  );
  // The old PDF is unreachable now; a failed delete leaves an orphan, never a wrong document.
  await prepared.storage.deleteObject(previousKey).catch((error: unknown) => {
    console.error("[offers] could not delete the replaced PDF:", previousKey, error instanceof Error ? error.message : error);
  });
  const [view] = await toViews(c, [updated]);
  c.header("ETag", etag(updated.version));
  return c.json(view!, 200);
});

offersRouter.openapi(sentRoute, async (c) => {
  const { id, offerId } = c.req.valid("param");
  const userId = c.get("userId");
  const offer = await db.dealOffer.findUnique({ where: { id: offerId } });
  if (!offer || offer.dealId !== id || offer.deletedAt) throw notFound("Offer not found");
  const deal = await db.deal.findUnique({ where: { id }, select: { entity: true, stage: true } });
  if (!deal) throw notFound("Deal not found");
  assertInScope(dealScope(c), deal.entity);
  const now = new Date();
  const updated = await db.$transaction(async (tx) => {
    // Idempotent: a second "sent" keeps the first moment and person.
    if (!offer.sentAt) {
      await tx.dealOffer.update({
        where: { id: offerId },
        data: { sentAt: now, sentBy: userId, version: { increment: 1 } },
      });
    }
    // AC-7.3: the deal moves to "Offer sent" when it was before it.
    if (SENDABLE_STAGES.includes(deal.stage)) {
      await tx.deal.update({
        where: { id },
        data: { stage: "negotiation", closedAt: null, lostReason: null, version: { increment: 1 }, updatedBy: userId },
      });
    }
    return tx.dealOffer.findUniqueOrThrow({ where: { id: offerId } });
  });
  const [view] = await toViews(c, [updated]);
  c.header("ETag", etag(updated.version));
  return c.json(view!, 200);
});

/** The stages from which marking an offer sent moves the deal to `negotiation` ("Offer sent"). */
const SENDABLE_STAGES: readonly string[] = ["lead", "qualified", "proposal"];

offersRouter.openapi(downloadRoute, async (c) => {
  const { id, offerId } = c.req.valid("param");
  const offer = await db.dealOffer.findUnique({ where: { id: offerId } });
  if (!offer || offer.dealId !== id || offer.deletedAt) throw notFound("Offer not found");
  const snapshot = offer.snapshot as unknown as StoredSnapshot;
  const url = await requireStorage().mintPresignedGet(offer.objectKey, {
    contentType: "application/pdf",
    fileName: referenceFileName(snapshot.reference),
  });
  return c.json({ url }, 200);
});

offersRouter.openapi(deleteRoute, async (c) => {
  const { id, offerId } = c.req.valid("param");
  const userId = c.get("userId");
  const offer = await db.dealOffer.findUnique({ where: { id: offerId } });
  if (!offer || offer.dealId !== id || offer.deletedAt) throw notFound("Offer not found");
  if (offer.createdBy !== userId && !managesAllDeals(c)) {
    throw forbidden("Only the author or an admin deletes an offer", "author_only");
  }
  await db.dealOffer.update({ where: { id: offerId }, data: { deletedAt: new Date(), deletedBy: userId } });
  try {
    await requireStorage().deleteObject(offer.objectKey);
  } catch (error) {
    // The row is what the CRM shows; an object left behind is unreachable without it.
    console.error("[offers] could not delete the PDF object:", offer.objectKey, error instanceof Error ? error.message : error);
  }
  return c.body(null, 204);
});
