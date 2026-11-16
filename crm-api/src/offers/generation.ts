/**
 * The generation core of an offer (specs/20261102-crm-offer-document; specs/20261115-crm-offer-wizard T27):
 * what drafting, generating and editing share, moved out of `offers.routes.ts` unchanged so the wizard's generate
 * route (T32) reads the same rules instead of copying them:
 *
 *   loadContext    the deal, its scope, the ready estimate (or the admin's override), the entity profile, an active template
 *   prepareOffer   contacts, costs, the chosen deal PDFs, the letterhead and the estimate's annex
 *   numbering      018's gap-free `number` and `NNNN/YYYY[rN]` reference, taken under the deal's advisory lock
 *   storage        the PDF is put in the CRM's bucket, and removed again when the row does not land (compensation)
 *
 * No route lives here and nothing answers HTTP; it throws the problems the routes map.
 */

import type { dealScope } from "../auth/guards";
import { assertInScope } from "../deals/deals.routes";
import { usableLetterhead } from "../entity-profiles/letterheadUse";
import { db } from "../lib/db";
import { getEstimate, type EstimateDocument } from "../lib/estimai";
import type { Prisma } from "../lib/generated/prisma/client";
import { loadPeople } from "../lib/people";
import { ProblemError, conflict, notFound, unprocessable } from "../lib/problem";
import { MAX_OFFER_ATTACHMENT_BYTES, requireStorage, type Storage } from "../lib/storage";
import { computeCosts } from "./costs";
import type { WizardAnswers } from "./engine/answers";
import type { ResolvedOffer } from "./engine/resolve";
import type { ContractSnapshot, OfferAttachmentRef, OfferCostLine, OfferLanguage } from "./contract";
import { renderContractPdf } from "./contractPdf";
import type { GenerateOfferSchema } from "./offerSchemas";
import { scopeLabels, type OfferSnapshot } from "./pdf";
import { buildScope, type Scope } from "./scope";
import type { z } from "@hono/zod-openapi";

export type OfferRow = Awaited<ReturnType<typeof db.dealOffer.findMany>>[number];
export type OfferTx = Prisma.TransactionClient;
export type StoredSnapshot = ContractSnapshot | OfferSnapshot;
export const isContract = (snapshot: StoredSnapshot): snapshot is ContractSnapshot => "kind" in snapshot && snapshot.kind === "contract";

/** Where an offer came from: an 018 summary (no `kind`), a contract made with a legacy template, or a wizard offer (AC-7.3). */
export function offerOrigin(snapshot: StoredSnapshot): "summary" | "sections" | "wizard" {
  if (!isContract(snapshot)) return "summary";
  return snapshot.wizard === undefined ? "sections" : "wizard";
}

/** The classic routes take a legacy (`sections`) template only: a wizard template is 409 `template_format_mismatch`. */
export function assertLegacyTemplate(template: { readonly id: string; readonly format: "sections" | "wizard" }): void {
  if (template.format !== "sections") {
    throw conflict("template_format_mismatch", "This template is not a legacy (sections) template", { templateId: template.id });
  }
}

const DEFAULT_PLACE = "Lugano";

export const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** Four digits, a slash and the year: `0017/2026`; `r1`, `r2`… for the later versions of a deal. */
export const offerReferenceOf = (no: number, year: number, revision: number) =>
  `${String(no).padStart(4, "0")}/${year}${revision > 0 ? `r${revision}` : ""}`;

/** A reference as a file name: the slash cannot be part of one. */
export const referenceFileName = (reference: string) => `${reference.replace(/[/\\]/g, "-")}.pdf`;

/** OF-2026-K3X9QZ-3: the specs/20261101-crm-sales-flow reference. Stable and unique per deal; kept for the old offers. */
export const offerReference = (dealId: string, number: number, issued: Date) =>
  `OF-${issued.getUTCFullYear()}-${dealId.slice(-6).toUpperCase()}-${number}`;


/**
 * Everything draft and generate share: the deal, its scope, the ready estimate,
 * the entity profile and an active template of the deal's entity. A deal whose
 * estimate gate an admin overrode (specs/20261101-crm-sales-flow AC-3.7) has an offer without an
 * estimate: `link` is then null and the scope, man-days and timeline are empty.
 */
export async function loadContext(dealId: string, templateId: string, scope: ReturnType<typeof dealScope>) {
  const { deal } = await loadDealInScope(dealId, scope);
  const link = estimateLinkOf(deal);
  const profile = await loadProfile(deal.entity);
  const template = await db.offerTemplate.findUnique({ where: { id: templateId } });
  // Another entity's template is "not found", like a missing one: no existence leak across entities.
  if (!template || template.entity !== deal.entity) throw notFound("Template not found");
  if (template.archivedAt) {
    throw conflict("template_archived", "This template is archived; choose an active one", { templateId });
  }
  return { deal, link, profile, template };
}

/** The deal with its company and estimate link; 404 when it does not exist, 403 `out_of_scope` outside the caller's entities. */
export async function loadDealInScope(dealId: string, scope: ReturnType<typeof dealScope>) {
  const deal = await db.deal.findUnique({ where: { id: dealId }, include: { company: true, estimate: true } });
  if (!deal) throw notFound("Deal not found");
  assertInScope(scope, deal.entity);
  return { deal, company: deal.company };
}

/** The ready estimate link, or null when an admin let the deal go without one; 409 `estimate_not_ready` otherwise. */
export function estimateLinkOf<T extends { estimateId: string; state: string; overrideAt: Date | null }>(deal: { estimate: T | null }): T | null {
  const link = deal.estimate?.estimateId && deal.estimate.state === "ready" ? deal.estimate : null;
  if (!link && !deal.estimate?.overrideAt) {
    throw new ProblemError({
      status: 409,
      code: "estimate_not_ready",
      detail: "An offer is generated from a ready technical estimate, or once an admin let the deal go without one",
    });
  }
  return link;
}

/** The entity's letterhead data; 409 `entity_profile_missing` without it. */
export async function loadProfile(entity: "welld_ch" | "welld_it") {
  const profile = await db.entityProfile.findUnique({ where: { entity } });
  if (!profile) {
    throw new ProblemError({
      status: 409,
      code: "entity_profile_missing",
      detail: "Set the entity's letterhead in CRM settings before generating an offer",
      extras: { entity },
    });
  }
  return profile;
}

/**
 * A profile whose legal name is blank after trim is refused like an absent one (409 `entity_profile_missing`): the
 * engine prints "" for it (DD-57) and an offer must never go out without its issuer (AC-12.7, DD-61). Only generate
 * calls it: the context route must answer and an autosave is never refused.
 */
export function requireIssuerName(profile: { readonly legalName: string }, entity: "welld_ch" | "welld_it"): void {
  if (profile.legalName.trim() !== "") return;
  throw new ProblemError({
    status: 409,
    code: "entity_profile_missing",
    detail: "Set the entity's legal name in CRM settings before generating an offer",
    extras: { entity },
  });
}

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
export async function loadAttachments(
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


export type GenerateBody = z.infer<typeof GenerateOfferSchema>;

/**
 * What generating and editing an offer share (US-3, US-7): the context checks,
 * the contacts, the costs, the chosen PDFs, the letterhead and the annex.
 */
export async function prepareOffer(
  c: Parameters<typeof getEstimate>[0] & { get(key: "userId"): string },
  scope: ReturnType<typeof dealScope>,
  dealId: string,
  body: GenerateBody,
) {
  const { deal, link, profile, template } = await loadContext(dealId, body.templateId, scope);
  assertLegacyTemplate(template);
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
  // A stored letterhead is used only once checked in this process: 409 `letterhead_unusable` before any render (DD-76).
  const letterhead = profile.letterheadKey ? await usableLetterhead(storage, profile.entity, profile.letterheadKey) : null;
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

export type Prepared = Awaited<ReturnType<typeof prepareOffer>>;

export function snapshotOf(prepared: Prepared, body: GenerateBody, reference: string, issued: Date): ContractSnapshot {
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

/** What a wizard offer's snapshot is made of (T31): the resolved offer WITH its reference, and what only the server knows. */
export interface WizardSnapshotInput {
  readonly template: { readonly id: string; readonly name: string };
  /** The template version the answers match (the draft's): enough, with the answers, to reopen the wizard (AC-6.6). */
  readonly templateVersion: number;
  readonly answers: WizardAnswers;
  /** `resolveOffer(…, { reference })`: every text is final, no pending reference. */
  readonly resolved: ResolvedOffer;
  readonly reference: string;
  readonly currency: "CHF" | "EUR";
  readonly profile: { readonly legalName: string; readonly addressLines: readonly string[]; readonly vatNumber: string | null; readonly iban: string | null };
  /** The effort detail, or null when the offer has none (the template's, or no estimate). */
  readonly annex: Scope | null;
  readonly attachments: readonly OfferAttachmentRef[];
  readonly preparedBy: string | null;
}

/**
 * The 018 contract snapshot of a wizard offer (plan § Data model): what was printed, plus `wizard` (the answers and the
 * template version they match — never the template text, DD-20), the text annexes, the printed cost rows and column
 * labels, and which sections were edited by hand. `issuedOn` is the PRINTED date (DD-16): validity counts from it.
 * Throws on what a complete offer cannot lack (the caller refused an incomplete draft before getting here).
 */
export function wizardSnapshotOf(input: WizardSnapshotInput): ContractSnapshot {
  const { resolved, answers } = input;
  const issuedOn = resolved.client.date;
  const { oneOffCents, yearlyCents } = resolved.costs.result;
  if (issuedOn === null) throw new Error("wizardSnapshotOf: the offer has no printed date");
  if (oneOffCents === null || yearlyCents === null) throw new Error("wizardSnapshotOf: a cost line has no amount");

  const lines: OfferCostLine[] = [];
  resolved.costs.rows.forEach((row, index) => {
    if (row.type !== "line") return;
    const figure = resolved.costs.result.rows[index];
    if (figure?.type !== "line" || figure.totalCents === null || row.quantity === null) {
      throw new Error("wizardSnapshotOf: a cost line has no amount");
    }
    lines.push({
      description: row.description,
      kind: row.kind,
      unitCents: row.unitCents,
      percentBp: row.percentBp,
      quantity: row.quantity,
      totalCents: figure.totalCents,
    });
  });

  return {
    kind: "contract",
    template: { id: input.template.id, name: input.template.name },
    language: resolved.language,
    reference: input.reference,
    issuedOn,
    validUntil: isoDate(new Date(Date.parse(`${issuedOn}T00:00:00Z`) + resolved.validityDays * 86_400_000)),
    validityDays: resolved.validityDays,
    place: resolved.client.place,
    issuer: {
      legalName: input.profile.legalName,
      addressLines: input.profile.addressLines,
      vatNumber: input.profile.vatNumber,
      iban: input.profile.iban,
    },
    salutation: resolved.salutation,
    clientLines: resolved.client.lines,
    contacts: resolved.client.contacts,
    contactIds: answers.client.contactIds,
    opening: resolved.opening,
    sections: resolved.sections.map((section) => ({
      heading: section.heading,
      body: section.body,
      costs: section.costs,
      handEdited: section.handEdited,
    })),
    costs: {
      currency: input.currency,
      columns: resolved.costs.columns,
      showTotal: resolved.costs.showTotals,
      lines,
      oneOffCents,
      yearlyCents,
      rows: resolved.costs.rows,
      labels: resolved.costs.labels,
    },
    acceptanceLabel: resolved.acceptanceLabel,
    annex: input.annex,
    attachments: input.attachments,
    aiAssisted: resolved.aiAssisted,
    preparedBy: input.preparedBy,
    wizard: { templateVersion: input.templateVersion, answers },
    textAnnexes: resolved.annexes.map((annex) => ({
      designation: annex.designation,
      title: annex.title,
      subtitle: annex.subtitle,
      intro: annex.intro,
      sections: annex.sections.map((section) => ({ heading: section.heading, body: section.body })),
    })),
  };
}

export async function renderOffer(snapshot: ContractSnapshot, prepared: Pick<Prepared, "letterhead" | "attachmentBytes">): Promise<Uint8Array> {
  try {
    return await renderContractPdf(snapshot, { letterhead: prepared.letterhead, attachments: prepared.attachmentBytes });
  } catch (error) {
    if (isUnreadable(error)) throw attachmentUnreadable(error.fileName ?? "");
    throw error;
  }
}

/** The deal's newest offer that is not deleted, or null. */
export const latestOffer = (tx: Pick<typeof db, "dealOffer">, dealId: string) =>
  tx.dealOffer.findFirst({ where: { dealId, deletedAt: null }, orderBy: { number: "desc" } });

/**
 * US-7: a new revision only once the previous one went out; until then it is edited. An
 * offer from before offer documents cannot be edited, so it never blocks the next one.
 */
export const blocksRevision = <T extends { sentAt: Date | null; snapshot: unknown }>(offer: T | null): offer is T =>
  offer !== null && offer.sentAt === null && isContract(offer.snapshot as StoredSnapshot);

export const notSent = (offer: { id: string; snapshot: unknown }) =>
  new ProblemError({
    status: 409,
    code: "offer_not_sent",
    detail: `Offer ${(offer.snapshot as StoredSnapshot).reference} has not been sent: edit it instead of making a new revision`,
    extras: { offerId: offer.id },
  });


/** One generator or editor at a time per deal, so versions are gap-free and never collide. */
export const lockDeal = (tx: OfferTx, dealId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm-offer:${dealId}`}))`;

/** Runs `work` in the transaction every offer write takes: the deal's lock first, a 30 s budget for the render and upload. */
export const inOfferTransaction = <T>(dealId: string, work: (tx: OfferTx) => Promise<T>): Promise<T> =>
  db.$transaction(
    async (tx) => {
      await lockDeal(tx, dealId);
      return work(tx);
    },
    { timeout: 30_000 },
  );

/**
 * The next number of the deal's offers and its reference (D-5): a deal keeps its number and year; each later version
 * adds a revision. Only an offer still on the deal, or one the client received (sent), holds the number: when every
 * earlier one was deleted unsent, the deal takes a new number (the old one stays a gap, AC-4.2), so the entity's
 * numbering setting applies (AC-8.1). Call it under `lockDeal`.
 */
export async function nextOfferNumbering(tx: OfferTx, dealId: string, entity: "welld_ch" | "welld_it", issued: Date) {
  const last = await tx.dealOffer.aggregate({ where: { dealId }, _max: { number: true } });
  const number = (last._max.number ?? 0) + 1;
  const sequenced = await tx.dealOffer.findMany({
    where: { dealId, sequenceNo: { not: null } },
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
          VALUES (${entity}::"Entity", ${sequenceYear}, 1)
          ON CONFLICT ("entity", "year") DO UPDATE SET "last" = "offer_sequence"."last" + 1
          RETURNING "last"`;
    sequenceNo = taken!.last;
  }
  return { number, sequenceYear, sequenceNo, reference: offerReferenceOf(sequenceNo, sequenceYear, revision) };
}

export interface NewOfferVersion {
  readonly dealId: string;
  readonly entity: "welld_ch" | "welld_it";
  readonly currency: "CHF" | "EUR";
  readonly storage: Storage;
  readonly issued: Date;
  readonly userId: string;
  readonly language: OfferLanguage;
  /** The stored price: one-off lines minus discounts (D-6). */
  readonly priceCents: number;
  readonly validityDays: number;
  /** The snapshot, given the reference this version takes. */
  readonly snapshotFor: (reference: string) => ContractSnapshot;
  /** Renders it; the caller maps what its renderer throws. */
  readonly render: (snapshot: ContractSnapshot) => Promise<Uint8Array>;
}

/**
 * Takes the next number, renders the PDF, puts it in the bucket and inserts the row — all in the caller's
 * transaction, which holds `lockDeal`. Compensation: when the row does not land, the object is deleted again
 * ("do not leave an unreachable object behind"); a caller that fails AFTER this returns (a later statement of its
 * own transaction) deletes `row.objectKey` itself.
 */
export async function createOfferVersion(tx: OfferTx, input: NewOfferVersion): Promise<OfferRow> {
  const { number, sequenceYear, sequenceNo, reference } = await nextOfferNumbering(tx, input.dealId, input.entity, input.issued);
  const snapshot = input.snapshotFor(reference);
  const pdf = await input.render(snapshot);
  const offerId = crypto.randomUUID();
  const objectKey = `offers/${input.dealId}/${offerId}.pdf`;
  await input.storage.putObject(objectKey, pdf, "application/pdf");
  try {
    return await tx.dealOffer.create({
      data: {
        id: offerId,
        dealId: input.dealId,
        number,
        language: input.language,
        priceCents: BigInt(input.priceCents),
        currency: input.currency,
        validityDays: input.validityDays,
        terms: null,
        sequenceYear,
        sequenceNo,
        snapshot: snapshot as unknown as object,
        objectKey,
        sizeBytes: pdf.byteLength,
        createdBy: input.userId,
        createdAt: input.issued,
      },
    });
  } catch (error) {
    // The row did not land: do not leave an unreachable object behind.
    await input.storage.deleteObject(objectKey).catch(() => undefined);
    throw error;
  }
}
