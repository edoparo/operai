/** Country names for the client block (specs/020 AC-1.2): the offer's language, never the UI's. */

import type { OfferLanguage } from "./contract";

const NAMES: Record<OfferLanguage, Record<string, string>> = {
  en: {
    CH: "Switzerland",
    IT: "Italy",
    DE: "Germany",
    FR: "France",
    AT: "Austria",
    LI: "Liechtenstein",
    GB: "United Kingdom",
    US: "United States",
    ES: "Spain",
    NL: "Netherlands",
    BE: "Belgium",
    LU: "Luxembourg",
  },
  it: {
    CH: "Svizzera",
    IT: "Italia",
    DE: "Germania",
    FR: "Francia",
    AT: "Austria",
    LI: "Liechtenstein",
    GB: "Regno Unito",
    US: "Stati Uniti",
    ES: "Spagna",
    NL: "Paesi Bassi",
    BE: "Belgio",
    LU: "Lussemburgo",
  },
};

/** The country's name in `language`; any other code through ICU, else the code itself. */
export function countryName(code: string, language: OfferLanguage): string {
  const upper = code.toUpperCase();
  const known = NAMES[language][upper];
  if (known) return known;
  try {
    return new Intl.DisplayNames([language], { type: "region" }).of(upper) ?? upper;
  } catch {
    return upper;
  }
}
