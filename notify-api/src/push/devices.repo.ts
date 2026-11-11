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
 *  - listByUser:        the caller's rows, newest first (id breaks ties)
 *  - deleteByIdForUser: id AND userId in one predicate; someone else's id is
 *                       NotFoundError, identical to an unknown id (ADR-0005)
 *  - deleteAllForUser:  sign-out / user deactivation, idempotent
 *  - deleteById:        pruning an invalid subscription (404/410 from the push
 *                       service), no owner check: it is internal, never routed
 *  - countByUser:       feeds the 20-devices-per-user limit (enforced in the route)
 */

import { Effect } from "effect";
import { db } from "@/lib/db";
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

export const upsertByEndpoint = (
  input: UpsertDeviceInput,
): Effect.Effect<{ device: PushDeviceRow; outcome: UpsertOutcome }, DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db.$transaction(async (tx) => {
        const existing = await tx.pushDevice.findUnique({
          where: { endpoint: input.endpoint },
          select: { userId: true },
        });
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
      }),
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
