/**
 * The DOCUMENT's formatting (specs/20261115-crm-offer-wizard DD-21), moved out of the renderer: the PDF
 * and the wizard's preview print amounts, dates, percentages and numbers the same way (AC-3.2). Computed
 * by hand — no `Intl`, no `toLocale*`, so every copy of this file prints the same on every runtime.
 * The form's inputs use the UI library's formatters instead.
 *
 * Shared with the CRM UI: byte-identical copy (group offerEngine.format).
 */
// shared-copy:begin offerEngine.format

/** `9.2.2026` — no leading zeros on day and month; anything that is not `YYYY-MM-DD` comes back as given. */
export function shortDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return `${Number(match[3])}.${Number(match[2])}.${match[1]}`;
}

/** Whole units without cents, else two decimals; CHF `36’300.50`, EUR `36.300,50`. */
export function formatAmount(cents: number, currency: "CHF" | "EUR"): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const whole = Math.trunc(absolute / 100).toString();
  const [group, decimal] = currency === "CHF" ? ["’", "."] : [".", ","];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const fraction = absolute % 100;
  return `${sign}${grouped}${fraction === 0 ? "" : `${decimal}${String(fraction).padStart(2, "0")}`}`;
}

/** Basis points as a percentage, trailing zeros trimmed: 1000 → `10%`, 750 → `7.5%`. */
export const formatPercent = (bp: number): string => `${String(Number((bp / 100).toFixed(2)))}%`;

/**
 * A number field's canonical value (`12.5`, `-3`) as the offer's language writes it: the decimal
 * separator only (`12,5` in Italian), no grouping. Anything that is not a plain decimal comes back as given.
 */
export function formatNumber(value: string | number, language: "en" | "it"): string {
  const text = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
  return language === "it" ? text.replace(".", ",") : text;
}
// shared-copy:end offerEngine.format
