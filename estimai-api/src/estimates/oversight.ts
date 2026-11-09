/**
 * Oversight — read-only access to every estimate for a holder of the
 * `estimate:read-all` permission (specs/024, ADR-0075; amends ADR-0036).
 *
 * estimai-api still resolves record access locally (`access.ts`: owner or a
 * collaborator row). This module is the ONE exception: it asks `auth GET
 * /authz/resolve`, with the caller's own JWT, whether the caller holds the
 * permission. It is consulted only when the caller asks for it (`whose=all`)
 * or has no relationship to the record — never on the owner/collaborator path,
 * so those keep working when `auth` is down (AC-1.7).
 *
 * Cached per `(sub, perm_epoch)` with a 30 s backstop, like crm-api's
 * authz middleware: a grant change bumps the epoch, so revocation is immediate
 * (AC-1.6). A token whose epoch cannot be read is never cached.
 *
 * Fail closed: `holdsReadAll` throws {@link OversightUnavailableError} when
 * `auth` cannot answer. Read paths turn that into 503; the write guard
 * ({@link isOversightReadOnly}) turns it into "no" (the write is refused
 * either way, and a stranger learns nothing).
 */

import { decodeJwt } from "jose";
import { db } from "@/lib/db";
import { fetchResolvedPermissions } from "@/lib/authClient";

export const READ_ALL_RESOURCE = "estimate";
export const READ_ALL_ACTION = "read-all";

export class OversightUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Authorization service is unavailable");
    this.name = "OversightUnavailableError";
    this.cause = cause;
  }
}

const CACHE_TTL_MS = 30_000;
const CACHE_SWEEP_THRESHOLD = 1_000;

const cache = new Map<string, { holds: boolean; expiresAt: number }>();

/** Test-only escape hatch — clears the module-scope cache between test cases. */
export function __resetOversightCacheForTests(): void {
  cache.clear();
}

/** The `perm_epoch` claim of an already-verified token, or null when unreadable. */
const epochOf = (authorizationHeader: string): number | null => {
  try {
    const claim = decodeJwt(authorizationHeader.replace(/^Bearer /, "")).perm_epoch;
    return typeof claim === "number" ? claim : null;
  } catch {
    return null;
  }
};

/**
 * Does the caller hold `estimate:read-all`? `sub` is the verified `userId`;
 * `authorizationHeader` the caller's own header, forwarded to `auth`.
 */
export async function holdsReadAll(sub: string, authorizationHeader: string): Promise<boolean> {
  const epoch = epochOf(authorizationHeader);
  // NUL cannot occur in a user id or a number, so keys cannot collide.
  const key = epoch === null ? null : `${sub}\0${epoch}`;
  const now = Date.now();

  if (key !== null) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.holds;
  }

  let holds: boolean;
  try {
    const permissions = await fetchResolvedPermissions(authorizationHeader);
    // The catalog declares no conditions for read-all (ADR-0075), so any grant is the grant.
    holds = permissions.some((p) => p.resource === READ_ALL_RESOURCE && p.action === READ_ALL_ACTION);
  } catch (err) {
    console.error(
      "[oversight] auth GET /authz/resolve failed — failing closed:",
      err instanceof Error ? err.message : err,
    );
    throw new OversightUnavailableError(err);
  }

  if (key !== null) {
    // Expired entries are otherwise only overwritten — sweep once the map is large.
    if (cache.size >= CACHE_SWEEP_THRESHOLD) {
      for (const [k, entry] of cache) if (entry.expiresAt <= now) cache.delete(k);
    }
    cache.set(key, { holds, expiresAt: now + CACHE_TTL_MS });
  }
  return holds;
}

/**
 * The write guard: a write route found NO relationship to `estimateId`. Is the
 * caller a permission holder looking at a real estimate — i.e. someone who may
 * read it but not change it (403 `oversight_read_only`, AC-1.4)? Otherwise the
 * route keeps answering 404. Never throws: an `auth` failure, a missing
 * permission and a nonexistent estimate are all "no".
 */
export async function isOversightReadOnly(
  sub: string,
  authorizationHeader: string,
  estimateId: string,
): Promise<boolean> {
  try {
    if (!(await holdsReadAll(sub, authorizationHeader))) return false;
    return (await db.estimate.count({ where: { id: estimateId } })) > 0;
  } catch {
    return false;
  }
}
