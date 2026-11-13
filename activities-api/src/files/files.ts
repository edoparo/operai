/**
 * A task's files (ADR-0089): what the view shows of them, which images a description may
 * name, the clean-up of images a description no longer shows, and deleting a task together
 * with its files.
 *
 * The one ordering rule: the bucket object is deleted BEFORE its row (ADR-0063). A row whose
 * object could not be deleted stays, so the next clean-up or delete tries again; an object is
 * never left without a row that leads back to it.
 */

import { z } from "@hono/zod-openapi";
import { db } from "../lib/db";
import type { Prisma } from "../lib/generated/prisma/client";
import { PersonRefSchema } from "../lib/http";
import { ProblemError, unprocessable } from "../lib/problem";
import { requireStorage, storageOrNull } from "../lib/storage";

/** A pending upload older than this is abandoned: never shown, removed by the next clean-up. */
export const PENDING_ABANDONED_MS = 60 * 60 * 1000;
/** An image never shown in the description for this long is removed by the next clean-up. */
export const UNUSED_IMAGE_MS = 24 * 60 * 60 * 1000;

export const FILE_KINDS = ["image", "attachment"] as const;

export const FileSchema = z.object({
  id: z.string(),
  kind: z.enum(FILE_KINDS),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  uploadedBy: PersonRefSchema,
  createdAt: z.string(),
});

/** The stored files of a task, oldest first: what the view lists. */
export const storedFiles = {
  where: { status: "stored" },
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  select: { id: true, kind: true, fileName: true, contentType: true, sizeBytes: true, uploadedByUserId: true, createdAt: true },
} satisfies Prisma.Activity$filesArgs;

export type StoredFileRow = Prisma.ActivityFileGetPayload<{ select: (typeof storedFiles)["select"] }>;

export function toFileView(row: StoredFileRow, person: (id: string) => z.infer<typeof PersonRefSchema>) {
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedBy: person(row.uploadedByUserId),
    createdAt: row.createdAt.toISOString(),
  };
}

/** 422 when the description names an image that is not one of this task's stored images. */
export async function assertImagesOf(activityId: string | null, imageIds: readonly string[]): Promise<void> {
  if (imageIds.length === 0) return;
  const found =
    activityId === null
      ? []
      : await db.activityFile.findMany({
          where: { activityId, id: { in: [...imageIds] }, kind: "image", status: "stored" },
          select: { id: true },
        });
  if (found.length !== imageIds.length) {
    throw unprocessable("The description shows an image this task does not have", { field: "description" }, "image_not_found");
  }
}

/** 503: the bucket refused a delete. Nothing in the database was changed. */
export const storageUnavailable = (): ProblemError =>
  new ProblemError({
    status: 503,
    code: "storage_unavailable",
    detail: "The files could not be deleted right now. Nothing was changed. Try again in a moment.",
  });

type CleanupRow = { id: string; objectKey: string };

/** Deletes each object, then its row; a failure leaves that row for the next attempt. Never throws. */
async function removeQuietly(rows: readonly CleanupRow[]): Promise<void> {
  const storage = storageOrNull();
  if (!storage || rows.length === 0) return;
  for (const row of rows) {
    try {
      await storage.deleteObject(row.objectKey);
      await db.activityFile.deleteMany({ where: { id: row.id } });
    } catch (error) {
      console.warn("[files] clean-up left a file for later", { fileId: row.id, name: (error as Error)?.name });
    }
  }
}

/**
 * After a description is saved: removes the images it no longer shows (those the previous one
 * showed), images never shown for UNUSED_IMAGE_MS, and abandoned pending uploads. An image
 * uploaded a moment ago and not yet placed in the text is kept: another editor may be about to
 * save it. Best effort, after the commit: the description stands whatever happens here.
 */
export async function cleanUpAfterDescription(activityId: string, previousIds: readonly string[], currentIds: readonly string[]): Promise<void> {
  const now = Date.now();
  const keep = new Set(currentIds);
  const was = new Set(previousIds);
  const candidates = await db.activityFile.findMany({
    where: { activityId, OR: [{ kind: "image" }, { status: "pending" }] },
    select: { id: true, objectKey: true, kind: true, status: true, createdAt: true },
  });
  const stale = candidates.filter((file) => {
    const age = now - file.createdAt.getTime();
    if (file.status === "pending") return age > PENDING_ABANDONED_MS;
    if (keep.has(file.id)) return false;
    return was.has(file.id) || age > UNUSED_IMAGE_MS;
  });
  await removeQuietly(stale);
}

/**
 * Deletes tasks with their files: every object first (any failure is a 503 and nothing is
 * deleted), then the file rows and the activities in one transaction. `where` must select the
 * activities to delete; its condition is re-applied inside the transaction, so a row that
 * stopped matching in between (a task completed a moment ago) is kept, files and all.
 */
export async function deleteActivitiesWithFiles(where: Prisma.ActivityWhereInput): Promise<number> {
  const files = await db.activityFile.findMany({ where: { activity: where }, select: { id: true, objectKey: true } });
  if (files.length > 0) {
    const storage = storageOrNull() ?? requireStorage();
    try {
      for (const file of files) await storage.deleteObject(file.objectKey);
    } catch {
      throw storageUnavailable();
    }
  }
  return db.$transaction(async (tx) => {
    const ids = (await tx.activity.findMany({ where, select: { id: true } })).map((row) => row.id);
    if (ids.length === 0) return 0;
    // A file added while the objects were being deleted has an object nobody deleted: refuse
    // rather than drop its row and leave the object without one.
    const handled = new Set(files.map((file) => file.id));
    const rows = await tx.activityFile.findMany({ where: { activityId: { in: ids } }, select: { id: true } });
    if (rows.some((row) => !handled.has(row.id))) {
      throw new ProblemError({ status: 409, code: "files_changed", detail: "A file was added in the meantime. Try again." });
    }
    await tx.activityFile.deleteMany({ where: { activityId: { in: ids } } });
    const { count } = await tx.activity.deleteMany({ where: { id: { in: ids } } });
    return count;
  });
}
