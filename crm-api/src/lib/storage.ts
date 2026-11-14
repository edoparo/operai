/**
 * S3-compatible object storage for offers and attachments (specs/20261101-crm-sales-flow US-4;
 * ADR 20260716-eu-object-storage-refund-attachments posture). Ported from inventory-api/src/lib/storage.ts, plus one
 * write path inventory has no use for: `putObject` of an offer PDF that crm-api
 * itself authors (the same category as refund-api's batch PDF, ADR 20260719-refund-batch-pdf-generation-pdf-lib).
 *
 * crm-api never proxies a file a client asked for:
 * - attachments go up through a presigned POST (the browser uploads straight
 *   to the EU bucket) and are HEADed at confirm time;
 * - every read is a ~60 s presigned GET minted after the authorization check.
 * The bucket is private; there is no other read path.
 *
 * `storage` is `null` when `CRM_S3_*` is not configured: the routes then answer
 * 503 `storage_unconfigured` (env.ts). Routes call the wired instance's methods
 * (never destructure them) so a test can replace it with `setStorageForTests`.
 */

import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  NotFound,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";
import { ProblemError } from "./problem";
import { needsPathStyleAddressing } from "./s3Residency";

// ─── Policy (AC-4.3) ─────────────────────────────────────────────────────────

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MiB
/** A letterhead is one A4 page (specs/20261102-crm-offer-document AC-2.1). */
export const MAX_LETTERHEAD_BYTES = 5 * 1024 * 1024; // 5 MiB
/** The most the offer generator reads from the bucket in one go (ADR 20261102-crm-api-reads-attachment-bytes-for-offer-annexes). */
export const MAX_OFFER_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MiB
export const ATTACHMENT_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
] as const;
export type AttachmentContentType = (typeof ATTACHMENT_CONTENT_TYPES)[number];

export const isAttachmentContentType = (value: string): value is AttachmentContentType =>
  (ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(value);

/** Seconds the presigned POST policy stays valid (the key is fixed at mint). */
export const POST_EXPIRES_SECONDS = 60;
/** Seconds a presigned GET stays valid. */
export const DOWNLOAD_URL_SECONDS = 60;

// ─── Names ───────────────────────────────────────────────────────────────────

/** The copy of a client file name embedded in an object KEY: a safe subset only. */
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
 * The name that is STORED and SHOWN: the client's own name minus path parts,
 * control characters and bidi overrides, whitespace collapsed, ≤ 200 chars.
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

/** `attachment` disposition: ASCII fallback plus RFC 5987 `filename*`. */
export function contentDisposition(fileName: string): string {
  const ascii = sanitizeFileName(fileName);
  const encoded = encodeURIComponent(displayFileName(fileName)).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
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
  /**
   * `content-length-range` 1..`maxBytes` (20 MiB unless given) and `Content-Type`
   * pinned, inside the signed policy.
   */
  mintPresignedPost(
    objectKey: string,
    contentType: AttachmentContentType,
    maxBytes?: number,
  ): Promise<PresignedPostResult>;
  /** `null` when the object does not exist (the upload never completed). */
  headObject(objectKey: string): Promise<HeadResult | null>;
  /** Response type and disposition are pinned in the signed URL, never taken from the object. */
  mintPresignedGet(objectKey: string, options: { contentType: string; fileName: string }): Promise<string>;
  /**
   * Reads an object's bytes into memory (ADR 20261102-crm-api-reads-attachment-bytes-for-offer-annexes). Callers bound the size from
   * the database BEFORE calling; `maxBytes` is a second, hard stop on what is read.
   */
  getObject(objectKey: string, maxBytes: number): Promise<Uint8Array>;
  /** Server-authored bytes only (the offer PDF). */
  putObject(objectKey: string, body: Uint8Array, contentType: string): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
}

export function createStorage(deps: { client: S3Client; bucket: string }): Storage {
  const { client, bucket } = deps;
  return {
    async mintPresignedPost(objectKey, contentType, maxBytes = MAX_ATTACHMENT_BYTES) {
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
          ResponseContentDisposition: contentDisposition(options.fileName),
        }),
        { expiresIn: DOWNLOAD_URL_SECONDS },
      );
    },

    async getObject(objectKey, maxBytes) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
      if ((result.ContentLength ?? 0) > maxBytes) {
        throw new Error(`object ${objectKey} is larger than ${maxBytes} bytes`);
      }
      const bytes = await result.Body!.transformToByteArray();
      if (bytes.byteLength > maxBytes) throw new Error(`object ${objectKey} is larger than ${maxBytes} bytes`);
      return bytes;
    },

    async putObject(objectKey, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: body, ContentType: contentType }));
    },

    async deleteObject(objectKey) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    },
  };
}

function wired(): Storage | null {
  if (!env.CRM_S3_ENDPOINT || !env.CRM_S3_BUCKET) return null;
  return createStorage({
    bucket: env.CRM_S3_BUCKET,
    client: new S3Client({
      region: env.CRM_S3_REGION!,
      endpoint: env.CRM_S3_ENDPOINT,
      forcePathStyle: needsPathStyleAddressing(env.CRM_S3_ENDPOINT),
      credentials: {
        accessKeyId: env.CRM_S3_ACCESS_KEY_ID!,
        secretAccessKey: env.CRM_S3_SECRET_ACCESS_KEY!,
      },
    }),
  });
}

let current: Storage | null = wired();

/** The configured storage, or a 503 the client can explain ("files are not set up here"). */
export function requireStorage(): Storage {
  if (!current) {
    throw new ProblemError({
      status: 503,
      code: "storage_unconfigured",
      detail: "File storage is not configured for the CRM",
    });
  }
  return current;
}

/** Tests only: swap in a fake (or `null` to simulate an unconfigured service). */
export function setStorageForTests(storage: Storage | null): void {
  current = storage;
}
