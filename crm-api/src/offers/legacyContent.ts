/**
 * The one door to an offer template's legacy columns (specs/20261115-crm-offer-wizard T15, plan.md § Data model).
 *
 * Those columns (`salutation`, `opening`, `sections`, `costLines`, `costColumns`) are optional in the
 * Prisma model because a wizard template has none of them; the database CHECK
 * `offer_template_format_content` guarantees a `sections` row has every one. Code that reads them goes through
 * `legacyContent(row)`, which narrows on the format, so a wizard row can never be read as a half-empty legacy
 * one: it is a 409 `template_format_mismatch` (the legacy dialog and routes do not take a wizard template).
 */

import { conflict } from "../lib/problem";
import type { CostColumns, OfferLanguage, OfferSection, OfferTemplateContent } from "./contract";

/** The fields of a template row `legacyContent` reads; a Prisma `OfferTemplate` satisfies it. */
export interface LegacyContentRow {
  readonly id: string;
  readonly name: string;
  readonly language: OfferLanguage;
  readonly format: "sections" | "wizard";
  readonly salutation: string | null;
  readonly opening: string | null;
  readonly sections: unknown;
  readonly costLines: unknown;
  readonly costColumns: unknown;
  readonly showTotal: boolean;
  readonly acceptanceLabel: string | null;
  readonly annex: boolean;
}

/** A legacy template's content with its identity: every member present. */
export interface LegacyContent extends OfferTemplateContent {
  readonly id: string;
  readonly sections: readonly OfferSection[];
  readonly costColumns: CostColumns;
}

export function legacyContent(row: LegacyContentRow): LegacyContent {
  // The CHECK makes the nulls impossible for a `sections` row; testing them keeps the narrowing honest
  // for the type system and turns a corrupted row into the same refusal, not a TypeError.
  if (
    row.format !== "sections" ||
    row.salutation === null ||
    row.opening === null ||
    row.sections === null ||
    row.costLines === null ||
    row.costColumns === null
  ) {
    throw conflict("template_format_mismatch", "This template is not a legacy (sections) template", {
      templateId: row.id,
    });
  }
  return {
    id: row.id,
    name: row.name,
    language: row.language,
    salutation: row.salutation,
    opening: row.opening,
    sections: row.sections as OfferSection[],
    costLines: row.costLines as OfferTemplateContent["costLines"],
    costColumns: row.costColumns as CostColumns,
    showTotal: row.showTotal,
    acceptanceLabel: row.acceptanceLabel,
    annex: row.annex,
  };
}
