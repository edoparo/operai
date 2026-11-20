/**
 * The owner's display name as it is snapshotted on a request (from the token's `name` claim, 086b92fb) or filled by the
 * accounting release from auth (T84). The name is the person's own, so it is untrusted text that ends up in the journal
 * Description, the PDFs and the UI (OWASP review 2026-11-20, low 3):
 * - format characters (Unicode `Cf`: bidi overrides such as U+202E, zero-width spaces and joiners) are removed, so a name
 *   cannot reorder or hide what a viewer shows around it;
 * - control characters and line breaks become a space, spaces collapse, the ends are trimmed;
 * - at most {@link OWNER_NAME_MAX} code points are kept;
 * - nothing left means no name (`null`): the email is then the fallback, as for an account with no name.
 */
export const OWNER_NAME_MAX = 200;

export function normaliseOwnerName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/\p{Cf}/gu, "")
    .replace(/[\p{Cc}\u2028\u2029]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned === "") return null;
  return Array.from(cleaned).slice(0, OWNER_NAME_MAX).join("").trimEnd();
}
