/**
 * What the offer renderers share: the stored shape of the first (018) offer snapshot, the scope labels and the text
 * formatters (specs/20261101-crm-sales-flow AC-4.1).
 *
 * The 018 summary renderer that lived here (`renderOfferPdf`, with its page writer) was removed in the eval follow-up of
 * specs/20261115-crm-offer-wizard: nothing called it since `renderContractPdf` (specs/20261102-crm-offer-document T2, "legacy 018
 * renderer kept only if still referenced"), and every route renders a `ContractSnapshot`. A stored 018 snapshot is still READ
 * (`OfferSnapshot`, `offerOrigin` says "summary"); it is never drawn again.
 *
 * Helvetica is WinAnsi-encoded: a character outside it is replaced by "?" (`winAnsi`), recorded as a known limit in plan.md § Risks.
 */

import type { Scope } from "./scope";

export type OfferLanguage = "en" | "it";

/** Everything the document prints; stored as the offer's `snapshot`. */
export interface OfferSnapshot {
  readonly language: OfferLanguage;
  readonly number: number;
  /** Offer reference printed on the document, e.g. "CRM-2026-ACME-3". */
  readonly reference: string;
  readonly issuedOn: string; // YYYY-MM-DD
  readonly validUntil: string; // YYYY-MM-DD
  readonly issuer: {
    readonly legalName: string;
    readonly addressLines: readonly string[];
    readonly vatNumber: string | null;
    readonly iban: string | null;
  };
  readonly client: {
    readonly name: string;
    readonly addressLines: readonly string[];
    readonly contact: string | null;
  };
  readonly title: string;
  readonly scope: Scope;
  readonly priceCents: number;
  readonly currency: "CHF" | "EUR";
  readonly terms: string | null;
  readonly preparedBy: string | null;
}

const TEXT = {
  en: { unassigned: "Other", noEpic: "General" },
  it: { unassigned: "Altro", noEpic: "Generale" },
} as const;

/** Labels the scope builder needs, per language. */
export const scopeLabels = (language: OfferLanguage) => ({
  unassignedLabel: TEXT[language].unassigned,
  noEpicLabel: TEXT[language].noEpic,
});

// ─── Formatting ──────────────────────────────────────────────────────────────

/** CHF 85'000.50 / EUR 85.000,50 — integer minor units, never a float in between. */
export function formatPrice(cents: number, currency: "CHF" | "EUR"): string {
  const whole = Math.trunc(cents / 100).toString();
  const fraction = String(cents % 100).padStart(2, "0");
  const [group, decimal] = currency === "CHF" ? ["'", "."] : [".", ","];
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, group)}${decimal}${fraction}`;
}

export const formatManDays = (tenths: number, language: OfferLanguage): string => {
  const text = (tenths / 10).toFixed(1);
  return language === "it" ? text.replace(".", ",") : text;
};

const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** Replaces what Helvetica (WinAnsi) cannot draw, so rendering never throws. */
export function winAnsi(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0)!;
    if (char === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(char)) {
      out += char;
    } else if (char === "\t") {
      out += " ";
    } else {
      out += "?";
    }
  }
  return out;
}
