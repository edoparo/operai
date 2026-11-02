/**
 * The dialog prefill of an offer (specs/020 AC-3.1, D-9, D-13, D-14): a template
 * with its placeholders replaced and its default cost lines resolved against the
 * deal and the ready estimate. Pure and DB-free; the route loads the inputs.
 *
 * Placeholders are replaced HERE, not at render time, so the salesperson edits
 * the final text and the snapshot holds plain text. Replacement is a single
 * pass: a value that itself contains "{epics}" (a deal title, say) is never
 * expanded again. Nothing but the names below is interpreted.
 */

import type { EstimateDocument } from "../lib/estimai";
import type { CostColumns, CostKind, OfferLanguage, OfferSection, OfferTemplateContent } from "./contract";
import { countryName } from "./countries";
import { MAX_QUANTITY } from "./offerSchemas";
import { scopeLabels } from "./pdf";
import { buildScope, releaseManDays, roundHalfUp, totalManDays } from "./scope";
import { buildTimeline, timelineTable } from "./timeline";

export interface DraftCostLine {
  readonly description: string;
  readonly kind: CostKind;
  /** Unit amount in cents; null only for a percentage discount. */
  readonly unitCents: number | null;
  readonly percentBp: number | null;
  readonly quantity: number;
}

/** The body of `GET /deals/{id}/offers/draft`: what the generate dialog starts from. */
export interface OfferDraft {
  readonly templateId: string;
  readonly templateName: string;
  readonly language: OfferLanguage;
  readonly currency: "CHF" | "EUR";
  readonly salutation: string;
  readonly clientLines: readonly string[];
  readonly opening: string;
  readonly sections: readonly OfferSection[];
  readonly costColumns: CostColumns;
  readonly showTotal: boolean;
  readonly costLines: readonly DraftCostLine[];
  readonly acceptanceLabel: string | null;
  readonly annex: boolean;
  readonly validityDays: number;
  readonly aiAssisted: boolean;
  /** The estimate's total expected man-days, rounded half up (the AI-assisted figure when asked). */
  readonly manDays: number;
}

export interface DraftInput {
  readonly template: OfferTemplateContent & { readonly id: string };
  readonly deal: { readonly title: string; readonly amountCents: number; readonly currency: "CHF" | "EUR" };
  readonly company: {
    readonly name: string;
    readonly legalName: string | null;
    readonly street: string | null;
    readonly postalCode: string | null;
    readonly city: string | null;
    readonly country: string | null;
  };
  readonly issuerLegalName: string;
  readonly estimate: EstimateDocument;
  readonly aiAssisted: boolean;
  readonly validityDays: number;
}

export const DEFAULT_VALIDITY_DAYS = 30;

/** Replaces `{name}` for the names in `values`; every other brace is left alone. */
export function fillPlaceholders(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\{([A-Za-z]+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? values[name]! : match,
  );
}

/** The client block (AC-1.2): legal name, street, "postal city", country in the offer's language. */
export function clientLinesOf(company: DraftInput["company"], language: OfferLanguage): string[] {
  const postalCity = [company.postalCode, company.city]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return [
    company.legalName?.trim() || company.name,
    company.street?.trim() ?? "",
    postalCity,
    company.country ? countryName(company.country, language) : "",
  ].filter((line) => line !== "");
}

/**
 * The deal amount split across the releases by expected man-days, in whole
 * currency units: every line but the last is rounded half up to a multiple of
 * 100 cents (never past what is left), the last takes the remainder. All zero
 * when the estimate has no man-days (D-13).
 */
export function splitByManDays(totalCents: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((total, weight) => total + weight, 0);
  if (weights.length === 0 || !(sum > 0)) return weights.map(() => 0);
  let remaining = totalCents;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return remaining;
    const units = roundHalfUp((totalCents * (weight / sum)) / 100);
    const cents = Math.min(units * 100, remaining);
    remaining -= cents;
    return cents;
  });
}

export function buildDraft(input: DraftInput): OfferDraft {
  const { template, deal, company, estimate, aiAssisted } = input;
  const language = template.language;
  const labels = scopeLabels(language);
  const scopeOptions = { aiAssisted: false, ...labels };

  const scope = buildScope(estimate, scopeOptions);
  const epics = [...new Set(estimate.content.acts.map((act) => act.epic?.trim() ?? "").filter(Boolean))];
  const manDays = roundHalfUp(totalManDays(estimate, aiAssisted));

  const values: Record<string, string> = {
    deal: deal.title,
    issuer: input.issuerLegalName,
    client: company.legalName?.trim() || company.name,
    currency: deal.currency,
    epics: epics.map((epic, index) => `${index + 1}. ${epic}`).join("\n"),
    phases: scope.releases
      .map((release) => `- ${release.name}: ${release.epics.map((epic) => epic.epic).join(", ")}`)
      .join("\n"),
    timeline: timelineTable(buildTimeline(estimate), language),
    manDays: String(manDays),
    validityDays: String(input.validityDays),
  };
  const fill = (text: string) => fillPlaceholders(text, values);

  const costLines: DraftCostLine[] = [];
  for (const line of template.costLines) {
    const amount = line.amount;
    const quantity =
      line.quantity === "manDays" ? Math.min(Math.max(manDays, 1), MAX_QUANTITY) : line.quantity;
    if (amount === "perRelease") {
      const releases = releaseManDays(estimate, scopeOptions);
      if (releases.length === 0) {
        // A ready estimate with no activities: one line for the whole amount.
        costLines.push({
          description: fillPlaceholders(line.description, { ...values, release: deal.title }),
          kind: line.kind,
          unitCents: deal.amountCents,
          percentBp: null,
          quantity: 1,
        });
        continue;
      }
      const split = splitByManDays(deal.amountCents, releases.map((release) => release.manDays));
      releases.forEach((release, index) => {
        costLines.push({
          description: fillPlaceholders(line.description, { ...values, release: release.name }),
          kind: line.kind,
          unitCents: split[index]!,
          percentBp: null,
          quantity: 1,
        });
      });
      continue;
    }
    costLines.push({
      description: fill(line.description),
      kind: line.kind,
      unitCents: amount === "deal" ? deal.amountCents : "cents" in amount ? amount.cents : null,
      percentBp: typeof amount === "object" && "percentBp" in amount ? amount.percentBp : null,
      quantity,
    });
  }

  return {
    templateId: template.id,
    templateName: template.name,
    language,
    currency: deal.currency,
    salutation: fill(template.salutation),
    clientLines: clientLinesOf(company, language),
    opening: fill(template.opening),
    sections: template.sections.map((section) => ({
      heading: fill(section.heading),
      body: fill(section.body),
      costs: section.costs,
    })),
    costColumns: template.costColumns,
    showTotal: template.showTotal,
    costLines,
    acceptanceLabel: template.acceptanceLabel === null ? null : fill(template.acceptanceLabel),
    annex: template.annex,
    validityDays: input.validityDays,
    aiAssisted,
    manDays,
  };
}
