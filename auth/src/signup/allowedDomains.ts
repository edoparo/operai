/**
 * The domains whose accounts may join the waiting list or be invited
 * (specs/023, ADR-0071). Pure: no env import, so `lib/env.ts` can use the parser.
 */

/** A lower-case DNS name with at least two labels (letters, digits, hyphen). */
const DOMAIN = /^(?!-)[a-z0-9-]+(?<!-)(\.(?!-)[a-z0-9-]+(?<!-))+$/;

/** Parse `ALLOWED_SIGNUP_DOMAINS`: comma-separated, lower-case, at least one. Throws on anything malformed. */
export function parseAllowedDomains(raw: string): string[] {
  const domains = raw.split(",").map((d) => d.trim());
  if (domains.length === 0 || domains.some((d) => !DOMAIN.test(d))) {
    throw new Error(
      "must be a comma-separated list of lower-case domain names (e.g. welld.ch,welld.it)",
    );
  }
  return domains;
}

/** Exact, case-insensitive match on the part after the LAST `@`. */
export function isAllowedDomain(email: string, domains: readonly string[]): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return domain.length > 0 && domains.includes(domain);
}
