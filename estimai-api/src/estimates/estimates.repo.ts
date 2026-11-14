/**
 * Prisma data-access layer for the Estimates API.
 * (T4, specs/20260606-estimate-persistence; widened for sharing in T6,
 * specs/20260807-estimate-sharing — see plan.md "Access resolution inside
 * estimai-api" / the per-call-site table.)
 *
 * SECURITY: every function is scoped by `userId` derived from the verified JWT `sub`.
 * The userId is NEVER taken from the request body or path — only from the context
 * variable set by jwtMiddleware after RS256 signature verification.
 *
 * Ownership/access is enforced at the query level:
 *  - create:  userId is always the caller's sub (owner is always the creator, unchanged)
 *  - list:    where: OR[{userId}, {collaborators: {some: {userId}}}] — owner UNION grantee
 *  - getById: where: { id } gated by resolveAccess() — ANY relationship (owner, editor,
 *             or viewer) is sufficient to read; no relationship → 404 (AC-1.6)
 *  - update:  version-CAS + editor-collaborator predicate, ONE statement (T7,
 *             specs/20260807-estimate-sharing): updateMany({ where: { id, version, OR: [owner,
 *             editor-collaborator] }, data: { ..., version: increment(1) } }).
 *             A viewer's write can never match the OR, so `count === 0` for a
 *             viewer regardless of whether the supplied version is current —
 *             no separate access check, no TOCTOU window.
 *  - delete:  deleteMany({ where: { id, userId } }) unchanged (owner-only, AC-3.3);
 *             count===0 now branches through resolveAccess() to distinguish
 *             "no relationship" (404) from "collaborator, not owner" (403 owner_only)
 *             — the denial taxonomy in plan.md / ADR 20260807-denial-taxonomy-shared-records-403-vs-404.
 *
 * This file does NOT call `auth` for display-identity resolution — that is an
 * HTTP round trip requiring the caller's Authorization header, which lives in
 * estimates.routes.ts, not this DB-only layer. Repo functions return the raw
 * `ownerId` (a `sub`); routes.ts resolves it to a display identity via
 * `authClient.resolveIdentities` and decides `owner: null` vs `owner: {...}`
 * based on the resolved `access` level.
 *
 * sizeBytes is computed here as the UTF-8 byte length of the serialized content.
 */

import { Effect } from "effect";
import type { InputJsonValue } from "@prisma/client/runtime/client";
import { db } from "@/lib/db";
import {
  ConflictError,
  DatabaseError,
  EstimateStateError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/errors";
import { resolveAccess, type AccessLevel, type WireAccess } from "./access";
import type { EstimateContent } from "./estimates.schemas";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute the UTF-8 byte length of the JSON-serialised content.
 * Exported so the size guard in estimates.routes.ts (T5) and the import
 * endpoint (T6) can reuse it without duplicating the encoding logic.
 * Stored in `sizeBytes` so the list query never touches `content`.
 */
export const computeSizeBytes = (content: EstimateContent): number =>
  new TextEncoder().encode(JSON.stringify(content)).length;

// ─── Row shapes returned by this module (T6) ──────────────────────────────────
//
// These are NOT the wire response shapes (EstimateFull/EstimateListItem in
// estimates.schemas.ts) — they carry the raw `ownerId` instead of a resolved
// `owner: Identity | null`, because resolving display identity requires an
// outbound `auth` call that belongs in the route handler, not here.

export interface EstimateFullRow {
  readonly id: string;
  readonly name: string;
  readonly author: string;
  readonly content: EstimateContent;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly access: WireAccess;
  readonly ownerId: string;
  /** ISO timestamp while the estimate is closed (read-only); null while open. */
  readonly closedAt: string | null;
  /** `sub` of whoever closed it; null while open. Resolved to a display identity in the route. */
  readonly closedByUserId: string | null;
  /** Only computed for `access === "owner"` (AC-5.4 — collaborators never see this). */
  readonly collaboratorCount?: number;
}

export interface EstimateListRow {
  readonly id: string;
  readonly name: string;
  readonly author: string;
  readonly updatedAt: string;
  readonly access: WireAccess;
  readonly ownerId: string;
  readonly closedAt: string | null;
  /** The CRM deal this estimate is linked to (pushed by crm-api, ADR 20261108-crm-pushes-deal-links-to-estimai); null when unlinked. */
  readonly crmDealId: string | null;
}

/** Map a Prisma Estimate row (+ already-known access/owner) to EstimateFullRow. */
const toFullRow = (
  row: {
    id: string;
    name: string;
    author: string;
    content: unknown;
    createdAt: Date;
    updatedAt: Date;
    version: number;
    closedAt: Date | null;
    closedByUserId: string | null;
  },
  access: WireAccess,
  ownerId: string,
  collaboratorCount?: number,
): EstimateFullRow => ({
  id: row.id,
  name: row.name,
  author: row.author,
  content: row.content as EstimateContent,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  version: row.version,
  access,
  ownerId,
  closedAt: row.closedAt?.toISOString() ?? null,
  closedByUserId: row.closedByUserId,
  ...(collaboratorCount !== undefined ? { collaboratorCount } : {}),
});

// ─── Repository functions ─────────────────────────────────────────────────────

/**
 * Create a new estimate owned by `userId`.
 * sizeBytes is computed from the serialized content and stored alongside it.
 * The creator is always the owner (unchanged by sharing — import never
 * creates grants either, per plan.md's per-call-site table).
 */
export const createEstimate = (
  userId: string,
  name: string,
  author: string,
  content: EstimateContent,
): Effect.Effect<EstimateFullRow, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const sizeBytes = computeSizeBytes(content);
      const row = await db.estimate.create({
        data: { userId, name, author, sizeBytes, content: content as unknown as InputJsonValue },
      });
      // A brand-new estimate has zero collaborators — no query needed.
      return toFullRow(row, "owner", userId, 0);
    },
    catch: (cause) =>
      new DatabaseError({ message: "Failed to create estimate", cause }),
  });

/**
 * List every estimate `userId` can see — owned OR granted (T6, AC-2.1/2.2/2.3).
 * Returns only list-view columns — no `content` is fetched.
 *
 * `access` is derived per row: `"owner"` when the estimate's `userId` matches
 * the caller, otherwise the caller's own collaborator row's `accessLevel`
 * (guaranteed to exist for every non-owned row, because the WHERE clause only
 * matched it via that same collaborator relation).
 */
export const listEstimates = (
  userId: string,
  status?: "open" | "closed",
  whose: "mine" | "all" = "mine",
): Effect.Effect<EstimateListRow[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db.estimate.findMany({
        where: {
          // `whose=all` (specs/20261108-estimate-list-oversight) is the oversight read: the route has already
          // checked `estimate:read-all`. Rows the caller owns or collaborates on keep
          // their level; every other row is `oversight`.
          ...(whose === "all" ? {} : { OR: [{ userId }, { collaborators: { some: { userId } } }] }),
          // specs/20261108-estimate-list-oversight: absent = both (the import offer needs the whole account).
          ...(status === "open" ? { closedAt: null } : {}),
          ...(status === "closed" ? { closedAt: { not: null } } : {}),
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          author: true,
          updatedAt: true,
          closedAt: true,
          crmDealId: true,
          userId: true,
          collaborators: {
            where: { userId },
            select: { accessLevel: true },
            take: 1,
          },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        author: row.author,
        updatedAt: row.updatedAt.toISOString(),
        closedAt: row.closedAt?.toISOString() ?? null,
        crmDealId: row.crmDealId,
        ownerId: row.userId,
        access: (row.userId === userId
          ? "owner"
          : (row.collaborators[0]?.accessLevel ?? (whose === "all" ? "oversight" : "viewer"))) as WireAccess,
      }));
    },
    catch: (cause) =>
      new DatabaseError({ message: "Failed to list estimates", cause }),
  });

/**
 * Get a single estimate by id, gated on `resolveAccess` — ANY relationship
 * (owner, editor, or viewer) is sufficient to read (AC-1.6/3.1 — reads are
 * never level-gated, only writes/deletes/management are).
 *
 * Returns NotFoundError when the id does not exist OR the caller has no
 * relationship to it — the two cases are indistinguishable (AC-1.6, ADR 20260703-jwt-resource-server-remote-jwks).
 *
 * `collaboratorCount` is populated only when the caller is the owner.
 */
export const getEstimateById = (
  id: string,
  userId: string,
): Effect.Effect<EstimateFullRow, DatabaseError | NotFoundError> =>
  Effect.gen(function* () {
    const resolved = yield* resolveAccess(id, userId);
    if (resolved === null) {
      return yield* Effect.fail(new NotFoundError({ message: `Estimate ${id} not found` }));
    }

    // Two-query read (resolveAccess, then content) is safe here — GET never
    // mutates state, so there is no TOCTOU window to close (unlike the write
    // path, where the access predicate must live inside the single CAS
    // statement — T7's concern, not this one's).
    const row = yield* Effect.tryPromise({
      try: async () => {
        const found = await db.estimate.findFirst({ where: { id } });
        if (found === null) return null;
        const collaboratorCount =
          resolved.level === "owner"
            ? await db.estimateCollaborator.count({ where: { estimateId: id } })
            : undefined;
        return toFullRow(found, resolved.level, resolved.ownerId, collaboratorCount);
      },
      catch: (cause) => new DatabaseError({ message: "Failed to fetch estimate", cause }),
    });

    if (row === null) {
      // Extremely rare race: deleted between resolveAccess and this fetch.
      // Treated identically to "no relationship" — still 404, never a 500 or
      // a stale read.
      return yield* Effect.fail(new NotFoundError({ message: `Estimate ${id} not found` }));
    }

    return row;
  });

/**
 * Read an estimate with NO relationship to it, for a caller the route has
 * already verified holds `estimate:read-all` (specs/20261108-estimate-list-oversight, AC-1.4). The row
 * carries `access: "oversight"` and no `collaboratorCount`. Call it only after
 * `getEstimateById` answered NotFound: an owner or collaborator keeps their own
 * level (AC-1.5). A nonexistent id is NotFound, as everywhere.
 */
export const getEstimateAsOversight = (
  id: string,
): Effect.Effect<EstimateFullRow, DatabaseError | NotFoundError> =>
  Effect.gen(function* () {
    const found = yield* Effect.tryPromise({
      try: () => db.estimate.findFirst({ where: { id } }),
      catch: (cause) => new DatabaseError({ message: "Failed to fetch estimate", cause }),
    });
    if (found === null) {
      return yield* Effect.fail(new NotFoundError({ message: `Estimate ${id} not found` }));
    }
    return toFullRow(found, "oversight", found.userId);
  });

/**
 * Update an existing estimate in place via optimistic concurrency (T7,
 * specs/20260807-estimate-sharing, ADR 20260807-optimistic-concurrency-version-if-match-cas-amends-0004 — amends ADR 20260703-estimate-persistence-jsonb-document's last-write-wins).
 *
 * ONE STATEMENT, no TOCTOU window (plan.md "Optimistic concurrency (US-4)"):
 * the access predicate (owner OR an editor-level collaborator grant) lives
 * INSIDE the same `updateMany` WHERE clause as the version compare-and-swap.
 * A viewer never satisfies the OR, so their update always misses regardless
 * of whether `expectedVersion` is current — this is what makes the
 * CAS-predicate test's "viewer with a *correct* If-Match still gets 403, not
 * 409" true structurally, not by a separate check.
 *
 * `updatedAt` is advanced automatically by Prisma (`@updatedAt`); `version`
 * is incremented by exactly 1 in the same statement Postgres uses to
 * serialise two concurrent writers (AC-4.3) — `sizeBytes` is recomputed from
 * the new content and `lastModifiedByUserId` is stamped to the caller.
 *
 * `count === 1` (success): re-fetch the fresh row. Access on the success path
 * is always "owner" or "editor" (a viewer's row can never match the OR), so
 * it is derived cheaply by comparing the row's own `userId` (the immutable
 * owner sub) to the caller — no second `resolveAccess` round trip needed.
 *
 * `count === 0` (the CAS matched nothing): the single WHERE clause makes this
 * ambiguous by construction — id absent, no relationship, insufficient
 * level, AND a stale version all produce the same `count === 0`. Disambiguate
 * with a fresh `resolveAccess` read, evaluated BEFORE any conflict is
 * reported (plan.md's fixed evaluation order 404/403 → 409, so a stranger's
 * probe — even carrying a syntactically valid `If-Match` — can never elicit
 * a 409 that would confirm the record exists):
 *   - no relationship at all      → NotFoundError (404, AC-1.6/ADR 20260703-jwt-resource-server-remote-jwks)
 *   - a relationship, but viewer  → ForbiddenError code:"insufficient_access" (403, AC-3.1)
 *   - owner or editor, estimate closed → EstimateStateError code:"estimate_closed" (409)
 *   - owner or editor             → the version must have been stale → ConflictError (409)
 *
 * A CLOSED estimate is read-only until reopened: `closedAt: null` is part of
 * the same single WHERE clause, so a close that commits between the client's
 * read and this write can never be overwritten (no TOCTOU window). When the
 * estimate is closed the closed state is reported even if the version is also
 * stale — the close itself bumped the version, and "closed" is the reason the
 * UI must show.
 */
export const updateEstimate = (
  id: string,
  userId: string,
  expectedVersion: number,
  name: string,
  author: string,
  content: EstimateContent,
): Effect.Effect<
  EstimateFullRow,
  DatabaseError | NotFoundError | ForbiddenError | ConflictError | EstimateStateError
> =>
  Effect.gen(function* () {
    const sizeBytes = computeSizeBytes(content);

    const { count } = yield* Effect.tryPromise({
      try: () =>
        db.estimate.updateMany({
          where: {
            id,
            version: expectedVersion,
            closedAt: null,
            OR: [{ userId }, { collaborators: { some: { userId, accessLevel: "editor" } } }],
          },
          data: {
            name,
            author,
            sizeBytes,
            content: content as unknown as InputJsonValue,
            version: { increment: 1 },
            lastModifiedByUserId: userId,
          },
        }),
      catch: (cause) => new DatabaseError({ message: "Failed to update estimate", cause }),
    });

    if (count === 1) {
      const row = yield* Effect.tryPromise({
        try: () => db.estimate.findFirst({ where: { id } }),
        catch: (cause) =>
          new DatabaseError({ message: "Failed to refetch updated estimate", cause }),
      });
      if (row === null) {
        // Vanishingly unlikely race — deleted by the owner in the instant
        // between the CAS commit and this re-fetch. Treated as NotFound,
        // never a 500 or a stale/synthetic success response.
        return yield* Effect.fail(new NotFoundError({ message: `Estimate ${id} not found` }));
      }
      const access: AccessLevel = row.userId === userId ? "owner" : "editor";
      return toFullRow(row, access, row.userId);
    }

    // count === 0 — disambiguate via a fresh resolveAccess read. Access is
    // decided BEFORE the conflict is reported (see doc comment above).
    const resolved = yield* resolveAccess(id, userId);

    if (resolved === null) {
      return yield* Effect.fail(new NotFoundError({ message: `Estimate ${id} not found` }));
    }

    if (resolved.level === "viewer") {
      return yield* Effect.fail(
        new ForbiddenError({
          message: "You have view-only access to this estimate.",
          code: "insufficient_access",
        }),
      );
    }

    // Caller holds sufficient access (owner or editor) but the CAS still
    // missed — the only remaining explanation is a stale `version`.
    const conflictRow = yield* Effect.tryPromise({
      try: () => db.estimate.findFirst({ where: { id } }),
      catch: (cause) =>
        new DatabaseError({ message: "Failed to fetch estimate for conflict report", cause }),
    });

    if (conflictRow === null) {
      // Deleted between resolveAccess and this fetch — genuinely gone now.
      return yield* Effect.fail(new NotFoundError({ message: `Estimate ${id} not found` }));
    }

    if (conflictRow.closedAt !== null) {
      return yield* Effect.fail(
        new EstimateStateError({
          message: "This estimate is closed. Reopen it to make changes.",
          code: "estimate_closed",
        }),
      );
    }

    return yield* Effect.fail(
      new ConflictError({
        message: "The estimate was modified by someone else. Reload to see the latest version.",
        currentVersion: conflictRow.version,
        updatedAt: conflictRow.updatedAt.toISOString(),
        lastModifiedByUserId: conflictRow.lastModifiedByUserId,
      }),
    );
  });

/**
 * Delete an estimate by id. The delete predicate stays owner-only, unchanged
 * (AC-3.3/AC-9.1 — only the owner may delete; collaborators cascade away).
 *
 * count === 0 now branches through `resolveAccess` (T6, ADR 20260807-denial-taxonomy-shared-records-403-vs-404):
 *   - no relationship at all         → NotFoundError (404, AC-1.6)
 *   - a relationship, but not owner  → ForbiddenError code:"owner_only" (403)
 * count > 0 → success (void).
 */
export const deleteEstimate = (
  id: string,
  userId: string,
): Effect.Effect<void, DatabaseError | NotFoundError | ForbiddenError> =>
  Effect.gen(function* () {
    const deleted = yield* Effect.tryPromise({
      try: async () => {
        const { count } = await db.estimate.deleteMany({ where: { id, userId } });
        return count > 0;
      },
      catch: (cause) => new DatabaseError({ message: "Failed to delete estimate", cause }),
    });

    if (deleted) {
      return;
    }

    // count === 0 — either no relationship at all, or a collaborator (viewer
    // or editor) attempted an owner-only operation. Distinguish via
    // resolveAccess (T6, ADR 20260807-denial-taxonomy-shared-records-403-vs-404): 404 vs 403 owner_only.
    const resolved = yield* resolveAccess(id, userId);
    if (resolved === null) {
      return yield* Effect.fail(new NotFoundError({ message: `Estimate ${id} not found` }));
    }
    return yield* Effect.fail(
      new ForbiddenError({
        message: "Only the owner can delete this estimate",
        code: "owner_only",
      }),
    );
  });

/**
 * Close or reopen an estimate (the CRM "estimate ready" signal). Same
 * single-statement CAS shape as `updateEstimate`: the access predicate (owner
 * OR editor grant), the version compare-and-swap AND the expected lifecycle
 * state (`closedAt: null` to close, `closedAt: { not: null }` to reopen) all
 * live in ONE `updateMany` WHERE clause, so two concurrent closes (or a close
 * racing a PUT) can never both succeed.
 *
 * Success bumps `version` by exactly 1, stamps `lastModifiedByUserId`, and sets
 * `closedAt`/`closedByUserId` (close) or clears both (reopen). `updatedAt` is
 * written explicitly with the same instant as `closedAt`, so the change has
 * one timestamp — the one the CRM notice carries.
 *
 * `count === 0` is disambiguated in the fixed order 404 → 403 → state → version:
 *   - no relationship                → NotFoundError (404)
 *   - viewer                         → ForbiddenError "insufficient_access" (403)
 *   - already in the target state    → EstimateStateError
 *                                      ("estimate_already_closed" / "estimate_not_closed", 409)
 *   - otherwise the version is stale → ConflictError (409, same shape as PUT)
 * The state is reported before the version because it is the more useful
 * reason: someone else's close/reopen is exactly what bumped the version.
 */
export type LifecycleTransition = "close" | "reopen";

export const setEstimateClosed = (
  id: string,
  userId: string,
  expectedVersion: number,
  transition: LifecycleTransition,
): Effect.Effect<
  EstimateFullRow,
  DatabaseError | NotFoundError | ForbiddenError | ConflictError | EstimateStateError
> =>
  Effect.gen(function* () {
    const at = new Date();
    const closing = transition === "close";

    const { count } = yield* Effect.tryPromise({
      try: () =>
        db.estimate.updateMany({
          where: {
            id,
            version: expectedVersion,
            closedAt: closing ? null : { not: null },
            OR: [{ userId }, { collaborators: { some: { userId, accessLevel: "editor" } } }],
          },
          data: {
            closedAt: closing ? at : null,
            closedByUserId: closing ? userId : null,
            version: { increment: 1 },
            lastModifiedByUserId: userId,
            updatedAt: at,
          },
        }),
      catch: (cause) =>
        new DatabaseError({ message: `Failed to ${transition} estimate`, cause }),
    });

    if (count === 1) {
      const row = yield* Effect.tryPromise({
        try: () => db.estimate.findFirst({ where: { id } }),
        catch: (cause) =>
          new DatabaseError({ message: `Failed to refetch ${transition}d estimate`, cause }),
      });
      if (row === null) {
        return yield* Effect.fail(new NotFoundError({ message: `Estimate ${id} not found` }));
      }
      const access: AccessLevel = row.userId === userId ? "owner" : "editor";
      const collaboratorCount =
        access === "owner"
          ? yield* Effect.tryPromise({
              try: () => db.estimateCollaborator.count({ where: { estimateId: id } }),
              catch: (cause) =>
                new DatabaseError({ message: "Failed to count collaborators", cause }),
            })
          : undefined;
      return toFullRow(row, access, row.userId, collaboratorCount);
    }

    const resolved = yield* resolveAccess(id, userId);
    if (resolved === null) {
      return yield* Effect.fail(new NotFoundError({ message: `Estimate ${id} not found` }));
    }
    if (resolved.level === "viewer") {
      return yield* Effect.fail(
        new ForbiddenError({
          message: "You have view-only access to this estimate.",
          code: "insufficient_access",
        }),
      );
    }

    const current = yield* Effect.tryPromise({
      try: () => db.estimate.findFirst({ where: { id } }),
      catch: (cause) =>
        new DatabaseError({ message: "Failed to fetch estimate for conflict report", cause }),
    });
    if (current === null) {
      return yield* Effect.fail(new NotFoundError({ message: `Estimate ${id} not found` }));
    }

    if (closing && current.closedAt !== null) {
      return yield* Effect.fail(
        new EstimateStateError({
          message: "This estimate is already closed.",
          code: "estimate_already_closed",
        }),
      );
    }
    if (!closing && current.closedAt === null) {
      return yield* Effect.fail(
        new EstimateStateError({
          message: "This estimate is not closed.",
          code: "estimate_not_closed",
        }),
      );
    }

    return yield* Effect.fail(
      new ConflictError({
        message: "The estimate was modified by someone else. Reload to see the latest version.",
        currentVersion: current.version,
        updatedAt: current.updatedAt.toISOString(),
        lastModifiedByUserId: current.lastModifiedByUserId,
      }),
    );
  });
