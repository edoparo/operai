/**
 * Wire-level helpers shared by the estimate routers (estimates.routes.ts and
 * lifecycle.routes.ts): RFC 7807 Problem bodies + their OpenAPI schemas, the
 * `If-Match` parser, and the repo-row → wire-shape mapping with live,
 * fail-soft display identities (ADR 20260807-live-identity-resolution-by-id-fail-soft).
 *
 * Moved out of estimates.routes.ts verbatim (behaviour unchanged) when the
 * close/reopen routes needed the same pieces: importing estimates.routes.ts
 * itself would also pull in its router and real jwtMiddleware.
 */

import { z } from "@hono/zod-openapi";
import { resolveIdentities, type Identity as ResolvedIdentity } from "@/lib/authClient";
import type { EstimateStateError } from "@/lib/errors";
import { IdentitySchema, type Identity } from "./estimates.schemas";
import type { EstimateFullRow, EstimateListRow } from "./estimates.repo";

// ─── Problem JSON helpers ─────────────────────────────────────────────────────

export const problemNotFound = (path: string, detail: string) => ({
  type: "https://httpstatuses.com/404",
  title: "Not Found",
  status: 404 as const,
  detail,
  instance: path,
});

export const problemBadRequest = (path: string, detail: string) => ({
  type: "https://httpstatuses.com/400",
  title: "Bad Request",
  status: 400 as const,
  detail,
  instance: path,
});

export const problemPayloadTooLarge = (path: string, actualBytes: number, limitBytes: number) => ({
  type: "https://httpstatuses.com/413",
  title: "Payload Too Large",
  status: 413 as const,
  detail: `Estimate content is ${(actualBytes / 1024 / 1024).toFixed(1)} MB; the maximum is ${(limitBytes / 1024 / 1024).toFixed(1)} MB. Nothing was saved.`,
  instance: path,
});

// T6 (specs/20260807-estimate-sharing) — the 403 half of the denial taxonomy
// (ADR 20260807-denial-taxonomy-shared-records-403-vs-404): a relationship to the record exists but the caller's level is
// insufficient for the attempted operation. `code` is the stable
// machine-readable discriminant the plan's API contracts specify
// (e.g. "owner_only").
export const problemForbidden = (path: string, detail: string, code: string) => ({
  type: "https://httpstatuses.com/403",
  title: "Forbidden",
  status: 403 as const,
  detail,
  code,
  instance: path,
});

// T7 (specs/20260807-estimate-sharing, ADR 20260807-optimistic-concurrency-version-if-match-cas-amends-0004) — `If-Match` is REQUIRED on PUT
// (and on close/reopen). Absent or malformed → 428, checked BEFORE the size
// guard and BEFORE any DB access (plan.md's fixed evaluation order: 401 → 400
// → 428 → 413 → 404/403 → 409), so a request that never carried a usable
// precondition is rejected before it can influence, or be influenced by, the
// CAS at all.
const PRECONDITION_REQUIRED_DETAIL =
  "This save needs an If-Match precondition. Reload the estimate.";

export const problemPreconditionRequired = (path: string) => ({
  type: "https://httpstatuses.com/428",
  title: "Precondition Required",
  status: 428 as const,
  detail: PRECONDITION_REQUIRED_DETAIL,
  code: "precondition_required",
  instance: path,
});

// T7 — the 409 half of optimistic concurrency (plan.md "Optimistic
// concurrency (US-4)"). `currentVersion`/`updatedAt` are DB facts;
// `lastModifiedBy` is a best-effort display identity (never blocks the 409 —
// resolveIdentities fails soft) and NEVER carries estimate content.
export const problemConflict = (
  path: string,
  currentVersion: number,
  updatedAt: string,
  lastModifiedBy: Identity,
) => ({
  type: "https://httpstatuses.com/409",
  title: "Conflict",
  status: 409 as const,
  detail: "The estimate was modified by someone else. Reload to see the latest version.",
  code: "estimate_version_conflict",
  currentVersion,
  updatedAt,
  lastModifiedBy,
  instance: path,
});

// Close/reopen lifecycle — a 409 whose `code` names the lifecycle state that
// refused the write (`estimate_closed`, `estimate_already_closed`,
// `estimate_not_closed`), distinct from the version conflict above so a
// client can tell "someone closed it" from "someone edited it".
export const problemEstimateState = (path: string, err: EstimateStateError) => ({
  type: "https://httpstatuses.com/409",
  title: "Conflict",
  status: 409 as const,
  detail: err.message,
  code: err.code,
  instance: path,
});

// specs/20261108-estimate-list-oversight (ADR 20261108-estimai-oversight-permission-amends-0036) — oversight. `oversight_required`: `whose=all` without
// `estimate:read-all`. `oversight_read_only`: a write on an estimate the caller
// may read only through that permission. `authz_unavailable`: `auth` could not
// answer on a path that needs it — fail closed, never "allow".
export const problemOversightRequired = (path: string) => ({
  type: "https://httpstatuses.com/403",
  title: "Forbidden",
  status: 403 as const,
  detail: "Listing every estimate needs the read-all permission.",
  code: "oversight_required",
  instance: path,
});

export const problemOversightReadOnly = (path: string) => ({
  type: "https://httpstatuses.com/403",
  title: "Forbidden",
  status: 403 as const,
  detail: "You can read this estimate but not change it.",
  code: "oversight_read_only",
  instance: path,
});

export const problemAuthzUnavailable = (path: string) => ({
  type: "https://httpstatuses.com/503",
  title: "Service Unavailable",
  status: 503 as const,
  detail: "The authorization service is unavailable. Try again shortly.",
  code: "authz_unavailable",
  instance: path,
});

export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string(),
  instance: z.string(),
});

export const ProblemWithCodeSchema = ProblemSchema.extend({
  code: z.string(),
});

export const ConflictProblemSchema = ProblemWithCodeSchema.extend({
  currentVersion: z.number().int(),
  updatedAt: z.string().datetime(),
  lastModifiedBy: IdentitySchema,
});

/**
 * Parses the `If-Match` request header into the expected `version` integer.
 *
 * The wire contract (plan.md) is `If-Match: "<version>"` — a quoted integer,
 * mirroring the `ETag: "<version>"` this same handler emits on success. Any
 * other shape (absent, empty, non-numeric, zero/negative, a wildcard `*`) is
 * MALFORMED and returns `null` — T7's contract draws no distinction between
 * "missing" and "malformed", both map to the same 428 (plan.md/tasks.md:
 * "If-Match is REQUIRED, not optional... absent/malformed → 428").
 */
export const parseIfMatch = (raw: string | undefined | null): number | null => {
  if (!raw) return null;
  const match = /^"(\d+)"$/.exec(raw.trim());
  if (!match?.[1]) return null;
  const version = Number(match[1]);
  return Number.isInteger(version) && version >= 1 ? version : null;
};

// ─── Display identity helpers (T6, specs/20260807-estimate-sharing) ──────────────
//
// Repo functions return raw `sub`s — never a resolved identity (that requires
// an outbound `auth` call using the CALLER'S OWN Bearer token, which only
// exists in the route handler). Resolution goes through
// authClient.resolveIdentities (fails SOFT — never throws, degrades to
// "unknown" — ADR 20260807-live-identity-resolution-by-id-fail-soft) and the `id` field is stripped before it reaches the
// wire: the response Identity shape is {status, name} only, never a raw sub.

export type IdentityResolver = typeof resolveIdentities;

export const toWireIdentity = (resolved: ResolvedIdentity): Identity => ({
  status: resolved.status,
  name: resolved.name,
});

export const UNKNOWN_IDENTITY: Identity = { status: "unknown", name: null };

/** Resolves a single `auth` user id to a display Identity (fail soft). */
export const resolveIdentityFor = async (
  authHeader: string,
  subjectId: string,
  resolver: IdentityResolver = resolveIdentities,
): Promise<Identity> => {
  const identities = await resolver(authHeader, [subjectId]);
  const found = identities.get(subjectId);
  return found ? toWireIdentity(found) : UNKNOWN_IDENTITY;
};

/**
 * Resolves the identities an EstimateFull needs — the owner (only when the
 * caller is NOT the owner: your own row never needs a third-party lookup) and
 * whoever closed it (whenever it is closed) — in ONE batch call, or none.
 */
export const resolveFullIdentities = async (
  authHeader: string,
  row: EstimateFullRow,
  resolver: IdentityResolver = resolveIdentities,
): Promise<{ owner: Identity | null; closedBy: Identity | null }> => {
  const ids = new Set<string>();
  if (row.access !== "owner") ids.add(row.ownerId);
  if (row.closedAt !== null && row.closedByUserId !== null) ids.add(row.closedByUserId);
  if (ids.size === 0) return { owner: null, closedBy: null };

  const identities = await resolver(authHeader, Array.from(ids));
  const pick = (id: string): Identity => {
    const found = identities.get(id);
    return found ? toWireIdentity(found) : UNKNOWN_IDENTITY;
  };
  return {
    owner: row.access === "owner" ? null : pick(row.ownerId),
    closedBy:
      row.closedAt === null
        ? null
        : row.closedByUserId === null
          ? UNKNOWN_IDENTITY
          : pick(row.closedByUserId),
  };
};

/** Maps a repo EstimateListRow (raw ownerId) to the wire EstimateListItem. */
export const toWireListItem = (
  row: EstimateListRow,
  identities: Map<string, ResolvedIdentity>,
) => ({
  id: row.id,
  name: row.name,
  author: row.author,
  updatedAt: row.updatedAt,
  access: row.access,
  owner:
    row.access === "owner"
      ? null
      : toWireIdentity(identities.get(row.ownerId) ?? { id: row.ownerId, ...UNKNOWN_IDENTITY }),
  closedAt: row.closedAt,
  crmDealId: row.crmDealId,
});

/** Maps a repo EstimateFullRow (raw ids) to the wire EstimateFull. */
export const toWireFull = (
  row: EstimateFullRow,
  owner: Identity | null,
  closedBy: Identity | null,
) => ({
  id: row.id,
  name: row.name,
  author: row.author,
  content: row.content,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  version: row.version,
  access: row.access,
  owner,
  ...(row.collaboratorCount !== undefined ? { collaboratorCount: row.collaboratorCount } : {}),
  closedAt: row.closedAt,
  closedBy,
});
