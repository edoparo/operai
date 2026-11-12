/**
 * Prisma data-access layer for push devices (T3, specs/029-push-notifications,
 * plan.md §Data model, ADR-0084).
 *
 * SECURITY: `userId` is the verified JWT `sub`, never taken from a request body.
 * Rows carry the subscription secrets (`endpoint`, `p256dh`, `auth`); this layer
 * returns them because the push channel needs them to encrypt and send, so the
 * ROUTE layer must map to a DTO that omits them and nothing here may log them.
 *
 *  - upsertByEndpoint: idempotent by endpoint. A browser subscription has one
 *    endpoint; if another account registers it (sign-in on a shared browser,
 *    AC-5.3) the row MOVES to the new owner, so one browser never belongs to two.
 *    It also enforces the 20-devices-per-user cap (S-M2): under a per-user advisory
 *    lock, in READ COMMITTED, so that of N concurrent registrations exactly the ones
 *    that fit are written and the rest answer `{ outcome: "limit" }` with nothing
 *    written. See the comment on the function for why that is complete.
 *  - listByUser:        the caller's rows, newest first (id breaks ties)
 *  - deleteByIdForUser: id AND userId in one predicate; someone else's id is
 *                       NotFoundError, identical to an unknown id (ADR-0005)
 *  - deleteAllForUser:  sign-out / user deactivation, idempotent
 *  - deleteById:        pruning an invalid subscription (404/410 from the push
 *                       service), no owner check: it is internal, never routed
 *  - countByUser:       the caller's device count (the cap itself is decided inside upsertByEndpoint)
 */

import { Effect } from "effect";
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { DatabaseError, NotFoundError } from "@/lib/errors";

export type PushDeviceRow = {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertDeviceInput = {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
};

/** created: new row; updated: same owner re-registered; moved: another owner's row taken over. */
export type UpsertOutcome = "created" | "updated" | "moved";

/** `limit`: the caller already holds MAX_DEVICES_PER_USER and this endpoint is new to them; nothing was written. */
export type UpsertResult = { device: PushDeviceRow; outcome: UpsertOutcome } | { outcome: "limit" };

export const MAX_DEVICES_PER_USER = 20;

/** First key of the two-int advisory lock; notify-api holds no other advisory lock today. */
const PUSH_DEVICE_LOCK_NAMESPACE = 2901;

/**
 * Register or refresh one subscription and enforce the cap, atomically.
 *
 * Why the cap is complete: a row is only ever ADDED to user U's count by a call whose userId
 * is U (a create, or a move to U), and every such call holds U's advisory lock across its
 * count and its write. Deletes, prunes and moves away from U only lower U's count and need no
 * lock. A hash collision between two users only serialises them.
 *
 * READ COMMITTED is pinned on purpose: each statement takes a fresh snapshot, so the count
 * taken after the lock sees the previous lock holder's committed row. Under REPEATABLE READ
 * the snapshot would date from before the wait and the race would return.
 *
 * "New to the caller" means not currently theirs: a new endpoint or one held by another
 * account (a move). At the cap, re-registering the caller's own endpoint is still allowed and
 * a move is refused with the other account's row untouched.
 */
export const upsertByEndpoint = (
  input: UpsertDeviceInput,
): Effect.Effect<UpsertResult, DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db.$transaction(
        async (tx): Promise<UpsertResult> => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PUSH_DEVICE_LOCK_NAMESPACE}::int, hashtext(${input.userId}))`;

          const existing = await tx.pushDevice.findUnique({
            where: { endpoint: input.endpoint },
            select: { userId: true },
          });
          if (existing?.userId !== input.userId) {
            const owned = await tx.pushDevice.count({ where: { userId: input.userId } });
            if (owned >= MAX_DEVICES_PER_USER) return { outcome: "limit" };
          }
          const outcome: UpsertOutcome =
            existing === null ? "created" : existing.userId === input.userId ? "updated" : "moved";

          const secrets = { p256dh: input.p256dh, auth: input.auth, label: input.label };
          const device = await tx.pushDevice.upsert({
            where: { endpoint: input.endpoint },
            create: { userId: input.userId, endpoint: input.endpoint, ...secrets },
            // A moved row is a new device for its new owner: restart its createdAt.
            update: {
              userId: input.userId,
              ...secrets,
              ...(outcome === "moved" ? { createdAt: new Date() } : {}),
            },
          });
          return { device, outcome };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      ),
    catch: (cause) => new DatabaseError({ message: "Failed to register push device", cause }),
  });

export const listByUser = (userId: string): Effect.Effect<PushDeviceRow[], DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db.pushDevice.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    catch: (cause) => new DatabaseError({ message: "Failed to list push devices", cause }),
  });

export const deleteByIdForUser = (
  id: string,
  userId: string,
): Effect.Effect<void, DatabaseError | NotFoundError> =>
  Effect.tryPromise({
    try: () => db.pushDevice.deleteMany({ where: { id, userId } }),
    catch: (cause) => new DatabaseError({ message: "Failed to delete push device", cause }),
  }).pipe(
    Effect.flatMap(({ count }) =>
      count === 0 ? Effect.fail(new NotFoundError({ message: "Push device not found" })) : Effect.void,
    ),
  );

export const deleteAllForUser = (userId: string): Effect.Effect<number, DatabaseError> =>
  Effect.tryPromise({
    try: async () => (await db.pushDevice.deleteMany({ where: { userId } })).count,
    catch: (cause) => new DatabaseError({ message: "Failed to delete push devices", cause }),
  });

/** Returns whether a row was deleted; an already-gone id is not an error. */
export const deleteById = (id: string): Effect.Effect<boolean, DatabaseError> =>
  Effect.tryPromise({
    try: async () => (await db.pushDevice.deleteMany({ where: { id } })).count > 0,
    catch: (cause) => new DatabaseError({ message: "Failed to delete push device", cause }),
  });

export const countByUser = (userId: string): Effect.Effect<number, DatabaseError> =>
  Effect.tryPromise({
    try: () => db.pushDevice.count({ where: { userId } }),
    catch: (cause) => new DatabaseError({ message: "Failed to count push devices", cause }),
  });
