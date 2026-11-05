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

/** Top-level names reserved for tests and documentation (RFC 2606 / 6761). */
export const RESERVED_TEST_TLDS = ["test", "example", "invalid", "localhost"] as const;

/** True when `domain` is, or ends in, a reserved test TLD (`operai.test`, `a.b.example`, `localhost`). */
export function isReservedTestDomain(domain: string): boolean {
  const labels = domain.trim().toLowerCase().split(".");
  return (RESERVED_TEST_TLDS as readonly string[]).includes(labels[labels.length - 1] ?? "");
}

/** The entries of an allowed-domain list that are reserved test domains. */
export function reservedTestDomains(domains: readonly string[]): string[] {
  return domains.filter(isReservedTestDomain);
}
