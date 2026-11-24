/**
 * The name an offer PDF is downloaded under: the convention of wellD's Drive.
 *
 *   WellD_<entity>_<client>_<deal initials>_<reference>.pdf
 *   WellD_CH_STUDIOV_FMS_00092026.pdf      (offer 0009/2026)
 *   WellD_CH_STUDIOV_FMS_00272026r2.pdf    (offer 0027/2026r2, the second revision)
 *
 * The client is the company's name and the deal's code the initials of its title, both derived (owner decision
 * 2026-11-20): accents dropped, only letters and digits kept, upper case. Since 2026-11-24 (owner) a deal may carry a
 * code typed by hand (`deal.fileCode`), which replaces the initials. A part that comes out empty is left out, never
 * written as an empty segment. Computed at download, so offers issued before this rule are named
 * by it too; the PDF itself is unchanged.
 */

type Entity = "welld_ch" | "welld_it";

const ENTITY_CODE: Record<Entity, string> = { welld_ch: "CH", welld_it: "IT" };

/** Bounds, so a long company name or title cannot make an unwieldy file name. */
export const MAX_CLIENT_CODE = 30;
export const MAX_DEAL_CODE = 10;

const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "");

/** "Studio V" → "STUDIOV". */
export function clientCode(companyName: string): string {
  return plain(companyName)
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, MAX_CLIENT_CODE);
}

/** "Fleet Management System" → "FMS"; every word counts, a digit too ("Fase 2" → "F2"). */
export function dealCode(dealTitle: string): string {
  return plain(dealTitle)
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "")
    .map((word) => word[0]!.toUpperCase())
    .join("")
    .slice(0, MAX_DEAL_CODE);
}

/** "0027/2026r2" → "00272026r2"; an older "OF-2026-ABC123-1" keeps its hyphens. */
export function referenceCode(reference: string): string {
  return reference.replace(/[^A-Za-z0-9-]/g, "");
}

/** A deal's hand-set file code: 1–10 letters or digits, stored upper case (the CHECK `deal_file_code_shape`). */
export const FILE_CODE_PATTERN = /^[A-Za-z0-9]{1,10}$/;

export function offerFileName(input: {
  entity: Entity;
  companyName: string;
  dealTitle: string;
  /** The deal's own code, when set; else the initials of its title. */
  dealFileCode?: string | null;
  reference: string;
}): string {
  const deal = input.dealFileCode ? input.dealFileCode.toUpperCase() : dealCode(input.dealTitle);
  const parts = ["WellD", ENTITY_CODE[input.entity], clientCode(input.companyName), deal, referenceCode(input.reference)];
  return `${parts.filter((part) => part !== "").join("_")}.pdf`;
}
