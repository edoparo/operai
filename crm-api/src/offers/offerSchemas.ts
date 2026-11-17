/**
 * Validation shared by the template routes and the generate route (specs/20261102-crm-offer-document
 * AC-3.3). The limits are the spec's; a template is held to the same ones as an
 * offer so a template can never prefill a dialog that then refuses to submit.
 */

import { z } from "@hono/zod-openapi";
import { PersonRefSchema, requiredText, idText } from "../lib/http";

/** Integer cents on the wire and in the database: same ceiling as a deal's amount. */
export const MAX_CENTS = 10_000_000_000_000;
export const MAX_QUANTITY = 100_000;
export const MAX_SECTIONS = 15;
export const MAX_COST_LINES = 10;

export const SectionSchema = z
  .object({
    heading: requiredText(120),
    body: z.string().max(20_000),
    costs: z.boolean(),
  })
  .strict();

export const CostColumnsSchema = z.object({ position: z.boolean(), unit: z.boolean() }).strict();

const sectionsOf = z.array(SectionSchema).min(1).max(MAX_SECTIONS);

/** Exactly one costs section (AC-3.3). */
function checkSections(sections: readonly { costs: boolean }[], ctx: z.RefinementCtx, path: string): void {
  if (sections.filter((section) => section.costs).length !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: "Exactly one section must carry the cost table" });
  }
}

export const SectionsSchema = sectionsOf;

// ─── Template cost lines ─────────────────────────────────────────────────────

export const CostKindSchema = z.enum(["one_off", "yearly", "discount"]);

export const TemplateCostLineSchema = z
  .object({
    description: requiredText(200),
    kind: CostKindSchema,
    amount: z.union([
      z.literal("deal"),
      z.literal("perRelease"),
      z.object({ cents: z.number().int().min(0).max(MAX_CENTS) }).strict(),
      z.object({ percentBp: z.number().int().min(1).max(10_000) }).strict(),
    ]),
    quantity: z.union([z.number().int().min(1).max(MAX_QUANTITY), z.literal("manDays")]),
  })
  .strict();

const templateBase = z
  .object({
    name: requiredText(80),
    language: z.enum(["en", "it"]),
    salutation: requiredText(100),
    opening: requiredText(5_000),
    sections: sectionsOf,
    costLines: z.array(TemplateCostLineSchema).min(1).max(MAX_COST_LINES),
    costColumns: CostColumnsSchema,
    showTotal: z.boolean(),
    acceptanceLabel: z
      .string()
      .max(100)
      .transform((v) => (v.trim() === "" ? null : v.trim()))
      .nullable()
      .optional(),
    annex: z.boolean(),
  })
  .strict();

function refineTemplate(template: z.infer<typeof templateBase>, ctx: z.RefinementCtx): void {
  checkSections(template.sections, ctx, "sections");
  let oneOff = false;
  template.costLines.forEach((line, index) => {
    const at = (member: string) => ["costLines", index, member];
    const amount = line.amount;
    const percent = typeof amount === "object" && "percentBp" in amount;
    if (line.kind !== "discount" && percent) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("amount"), message: "A percentage applies to a discount only" });
    }
    if (line.kind === "discount" && (amount === "deal" || amount === "perRelease")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("amount"), message: "A discount is a fixed amount or a percentage" });
    }
    if (amount === "perRelease" && line.kind !== "one_off") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("amount"), message: "A per-release line is a one-off line" });
    }
    if (percent && line.quantity !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("quantity"), message: "A percentage discount has quantity 1" });
    }
    if (!template.costColumns.unit && line.quantity !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: at("quantity"),
        message: "A quantity other than 1 needs the unit-price and quantity columns",
      });
    }
    if (line.kind === "one_off") oneOff = true;
  });
  if (!oneOff) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["costLines"], message: "At least one cost line must be one-off" });
  }
}

export const TemplateContentSchema = templateBase.superRefine(refineTemplate);
/** A new template names its entity beside the content. */
export const CreateTemplateSchema = templateBase.extend({ entity: z.enum(["welld_ch", "welld_it"]) }).superRefine(refineTemplate);

export type TemplateContentInput = z.infer<typeof TemplateContentSchema>;

// ─── Generate body ───────────────────────────────────────────────────────────

export const OfferCostLineSchema = z
  .object({
    description: requiredText(200),
    kind: CostKindSchema,
    unitCents: z.number().int().min(0).max(MAX_CENTS).optional(),
    percentBp: z.number().int().min(1).max(10_000).optional(),
    quantity: z.number().int().min(1).max(MAX_QUANTITY),
  })
  .strict();

export const GenerateOfferSchema = z
  .object({
    templateId: idText(),
    salutation: requiredText(100),
    clientLines: z.array(requiredText(200)).min(1).max(8),
    contactIds: z.array(idText()).max(5).default([]),
    opening: requiredText(5_000),
    sections: sectionsOf,
    costColumns: CostColumnsSchema,
    showTotal: z.boolean(),
    costLines: z.array(OfferCostLineSchema).min(1).max(MAX_COST_LINES),
    acceptanceLabel: z
      .string()
      .max(100)
      .transform((v) => (v.trim() === "" ? null : v.trim()))
      .nullable()
      .optional(),
    annex: z.boolean(),
    attachmentIds: z.array(idText()).max(5).default([]),
    validityDays: z.number().int().min(1).max(365).default(30),
    aiAssisted: z.boolean().default(false),
  })
  .strict()
  .superRefine((body, ctx) => {
    checkSections(body.sections, ctx, "sections");
    if (new Set(body.attachmentIds).size !== body.attachmentIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["attachmentIds"], message: "Each attachment once" });
    }
    if (new Set(body.contactIds).size !== body.contactIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contactIds"], message: "Each contact once" });
    }
    let oneOff = false;
    body.costLines.forEach((line, index) => {
      const at = (member: string) => ["costLines", index, member];
      if (line.kind === "discount") {
        if ((line.unitCents === undefined) === (line.percentBp === undefined)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: at("unitCents"),
            message: "A discount is either an amount (unitCents) or a percentage (percentBp)",
          });
        }
        if (line.percentBp !== undefined && line.quantity !== 1) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("quantity"), message: "A percentage discount has quantity 1" });
        }
      } else {
        if (line.unitCents === undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("unitCents"), message: "Required" });
        }
        if (line.percentBp !== undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("percentBp"), message: "A percentage applies to a discount only" });
        }
        if (line.kind === "one_off") oneOff = true;
      }
      if (!body.costColumns.unit && line.quantity !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: at("quantity"),
          message: "A quantity other than 1 needs the unit-price and quantity columns",
        });
      }
    });
    if (!oneOff) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["costLines"], message: "At least one cost line must be one-off" });
    }
  });

export type GenerateOfferInput = z.infer<typeof GenerateOfferSchema>;

/**
 * Where an offer came from (specs/20261115-crm-offer-wizard AC-7.3, DD-11), which decides how it is edited or revised:
 * `summary` an 018 `OF-…` offer (never editable), `sections` a contract made with a legacy template (the 018 dialog, or
 * the wizard when the language has a wizard template), `wizard` an offer made by the wizard (a draft).
 */
export const OfferOriginSchema = z.enum(["summary", "sections", "wizard"]);

/** One offer version as the list and the generate/edit/sent routes return it. */
export const OfferSchema = z.object({
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
  origin: OfferOriginSchema,
  /**
   * The version of the entity's letterhead the layout service drew the PDF with (specs/20261116-letterhead-service AC-10.2);
   * null for an offer crm-api drew itself, before the switch (AC-10.9).
   */
  letterheadVersion: z.number().int().nullable(),
});
