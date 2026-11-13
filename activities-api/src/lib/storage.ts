/**
 * S3-compatible object storage for task files (ADR-0089; ADR-0016 posture). Ported from
 * crm-api/src/lib/storage.ts, minus the paths activities-api has no use for (it never reads
 * or writes bytes itself).
 *
 * activities-api never proxies a file:
 * - uploads go through a presigned POST (the browser sends the bytes straight to the EU
 *   bucket, size and type pinned in the signed policy) and are HEADed at confirm time;
 * - every read is a ~60 s presigned GET minted after the host has confirmed the caller may
 *   read the task.
 * The bucket is private; there is no other read path.
 *
 * `storage` is `null` when `ACTIVITIES_S3_*` is not configured: the file routes then answer
 * 503 `storage_unconfigured` and everything else works. Routes call the wired instance's
 * methods (never destructure them) so a test can replace it with `setStorageForTests`.
 */

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, NotFound, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";
import { ProblemError } from "./problem";
import { needsPathStyleAddressing } from "./s3Residency";

// ─── Policy ──────────────────────────────────────────────────────────────────

/** An image shown inside a description: raster formats only (never SVG, which can carry script). */
export const IMAGE_CONTENT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB

/** A file listed under a description. */
export const ATTACHMENT_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  ...IMAGE_CONTENT_TYPES,
] as const;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MiB

/** Stored and pending files of one task, together. */
export const MAX_FILES_PER_TASK = 20;

/** Seconds the presigned POST policy stays valid (the key is fixed at mint). */
export const POST_EXPIRES_SECONDS = 60;
/** Seconds a presigned GET stays valid. */
export const DOWNLOAD_URL_SECONDS = 60;

export const objectKeyOf = (activityId: string, fileId: string): string => `activities/${activityId}/${fileId}`;

// ─── Names ───────────────────────────────────────────────────────────────────

/** A safe ASCII subset of a file name, for the `filename=` fallback of a disposition. */
export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "file";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : "file";
}

/**
 * The name that is STORED and SHOWN: the client's own name minus path parts, control
 * characters and bidi overrides, whitespace collapsed, ≤ 200 chars.
 */
export function displayFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 200)
    .trim();
  return cleaned.length > 0 ? cleaned : "file";
}

/** `inline` for an image shown in the page, `attachment` for a download; RFC 5987 `filename*`. */
export function contentDisposition(fileName: string, disposition: "inline" | "attachment"): string {
  const ascii = sanitizeFileName(fileName);
  const encoded = encodeURIComponent(displayFileName(fileName)).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

export interface PresignedPostResult {
  readonly url: string;
  readonly fields: Record<string, string>;
}

export interface HeadResult {
  readonly sizeBytes: number;
  readonly contentType: string | undefined;
}

export interface Storage {
  /** `content-length-range` 1..`maxBytes` and `Content-Type` pinned inside the signed policy. */
  mintPresignedPost(objectKey: string, contentType: string, maxBytes: number): Promise<PresignedPostResult>;
  /** `null` when the object does not exist (the upload never completed). */
  headObject(objectKey: string): Promise<HeadResult | null>;
  /** Response type and disposition are pinned in the signed URL, never taken from the object. */
  mintPresignedGet(
    objectKey: string,
    options: { contentType: string; fileName: string; disposition: "inline" | "attachment" },
  ): Promise<string>;
  /** Succeeds when the object is already gone (S3 DELETE is idempotent). */
  deleteObject(objectKey: string): Promise<void>;
}

export function createStorage(deps: { client: S3Client; bucket: string }): Storage {
  const { client, bucket } = deps;
  return {
    async mintPresignedPost(objectKey, contentType, maxBytes) {
      const { url, fields } = await createPresignedPost(client, {
        Bucket: bucket,
        Key: objectKey,
        Conditions: [
          ["content-length-range", 1, maxBytes],
          ["eq", "$Content-Type", contentType],
        ],
        Fields: { "Content-Type": contentType },
        Expires: POST_EXPIRES_SECONDS,
      });
      return { url, fields };
    },

    async headObject(objectKey) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
        return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType };
      } catch (err) {
        if (err instanceof NotFound) return null;
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) return null;
        throw err;
      }
    },

    async mintPresignedGet(objectKey, options) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          ResponseContentType: options.contentType,
          ResponseContentDisposition: contentDisposition(options.fileName, options.disposition),
        }),
        { expiresIn: DOWNLOAD_URL_SECONDS },
      );
    },

    async deleteObject(objectKey) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    },
  };
}

function wired(): Storage | null {
  if (!env.ACTIVITIES_S3_ENDPOINT || !env.ACTIVITIES_S3_BUCKET) return null;
  return createStorage({
    bucket: env.ACTIVITIES_S3_BUCKET,
    client: new S3Client({
      region: env.ACTIVITIES_S3_REGION!,
      endpoint: env.ACTIVITIES_S3_ENDPOINT,
      forcePathStyle: needsPathStyleAddressing(env.ACTIVITIES_S3_ENDPOINT),
      credentials: {
        accessKeyId: env.ACTIVITIES_S3_ACCESS_KEY_ID!,
        secretAccessKey: env.ACTIVITIES_S3_SECRET_ACCESS_KEY!,
      },
    }),
  });
}

let current: Storage | null = wired();

export const storageUnconfigured = (): ProblemError =>
  new ProblemError({
    status: 503,
    code: "storage_unconfigured",
    detail: "File storage is not configured for tasks",
  });

/** The configured storage, or a 503 the client can explain ("files are not set up here"). */
export function requireStorage(): Storage {
  if (!current) throw storageUnconfigured();
  return current;
}

/** The configured storage, or null (deleting a task with no files must not need it). */
export function storageOrNull(): Storage | null {
  return current;
}

/** Tests only: swap in a fake (or `null` to simulate an unconfigured service). */
export function setStorageForTests(storage: Storage | null): void {
  current = storage;
}
