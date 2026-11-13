/**
 * A task's description (ADR-0089): a TipTap/ProseMirror document, stored as JSONB and returned
 * as it was saved. activities-api never renders it; the UIs render it as React elements (no
 * HTML), so a node they do not know is simply not shown. What the server does enforce:
 *
 *   - it is a document (`type: "doc"`), at most MAX_DESCRIPTION_BYTES of JSON, no NUL anywhere
 *     (Postgres JSONB cannot hold one), nested at most MAX_DEPTH levels;
 *   - every image node names one of THIS task's stored image files by id (`attrs.fileId`),
 *     never a URL: a description cannot point a reader's browser anywhere else.
 */

import { z } from "@hono/zod-openapi";

export const MAX_DESCRIPTION_BYTES = 128 * 1024;
const MAX_DEPTH = 40;

export type Doc = { type: "doc"; content?: unknown[] | undefined } & { [key: string]: unknown };

const sizeOf = (doc: unknown): number => Buffer.byteLength(JSON.stringify(doc), "utf8");

function depthOf(node: unknown, depth = 0): number {
  if (depth > MAX_DEPTH) return depth;
  if (Array.isArray(node)) return Math.max(depth, ...node.map((child) => depthOf(child, depth + 1)));
  if (node && typeof node === "object") {
    return Math.max(depth, ...Object.values(node as Record<string, unknown>).map((child) => depthOf(child, depth + 1)));
  }
  return depth;
}

export const DescriptionSchema = z
  .object({ type: z.literal("doc"), content: z.array(z.unknown()).optional() })
  .passthrough()
  .refine((doc) => sizeOf(doc) <= MAX_DESCRIPTION_BYTES, `at most ${MAX_DESCRIPTION_BYTES} bytes`)
  .refine((doc) => !JSON.stringify(doc).includes("\\u0000"), "must not contain NUL characters")
  .refine((doc) => depthOf(doc) <= MAX_DEPTH, "is nested too deeply")
  .openapi({ description: "A TipTap/ProseMirror document; image nodes carry `attrs.fileId` of this task's image files" });

/** Every `image` node's `attrs.fileId`, in document order, without duplicates. Bounded by MAX_DEPTH. */
export function imageIdsOf(doc: unknown): string[] {
  const ids: string[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > MAX_DEPTH || !node || typeof node !== "object") return;
    const record = node as { type?: unknown; attrs?: { fileId?: unknown }; content?: unknown };
    if (record.type === "image") {
      const id = record.attrs?.fileId;
      ids.push(typeof id === "string" ? id : "");
    }
    if (Array.isArray(record.content)) for (const child of record.content) walk(child, depth + 1);
  };
  walk(doc, 0);
  return [...new Set(ids)];
}

/** True when the document holds no text and no image: stored as null. */
export function isEmptyDoc(doc: unknown): boolean {
  let found = false;
  const walk = (node: unknown, depth: number) => {
    if (found || depth > MAX_DEPTH || !node || typeof node !== "object") return;
    const record = node as { type?: unknown; text?: unknown; content?: unknown };
    if (record.type === "image" || (typeof record.text === "string" && record.text.trim() !== "")) {
      found = true;
      return;
    }
    if (Array.isArray(record.content)) for (const child of record.content) walk(child, depth + 1);
  };
  walk(doc, 0);
  return !found;
}

/**
 * Plain text as a description: one paragraph per line, an empty line an empty paragraph. The
 * migration does the same in SQL for the bodies tasks had before (20261113120000).
 */
export function textToDoc(text: string): Doc {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return {
    type: "doc",
    content: lines.map((line) => (line === "" ? { type: "paragraph" } : { type: "paragraph", content: [{ type: "text", text: line }] })),
  };
}
