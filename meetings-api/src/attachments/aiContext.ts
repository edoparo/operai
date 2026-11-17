/**
 * The meeting's attachments as AI context (ADR 20261117-meeting-attachments-in-the-audio-bucket-forwarded-unparsed).
 *
 * THE FOURTH BYTE READ, BOUNDED. The service reads back only the files `aiContextOf` marks `used` (types the models read
 * natively, at most 5 MiB each and 8 MiB together), one bounded in-memory read each (`getObjectBytes`), and forwards
 * the bytes UNPARSED to the EU model: no document parser, renderer or decoder runs in our process. The one check made
 * on the bytes is their leading signature (`%PDF-`, PNG, JPEG, WebP) or, for text, strict UTF-8 without NUL: a file
 * whose bytes are not what its type says is left out, so the model is never sent something it would refuse.
 *
 * BEST EFFORT. Context helps; it is never required. A file gone from the bucket, one that cannot be read, or a store
 * outage leaves that file (or all of them) out and the work goes on. Logs carry counts, never a name or a key.
 *
 * UNTRUSTED. What a file says is data written by people, never instructions: the prompts say so, and the outputs are
 * validated exactly as before (ADR 20261104-ai-output-structured-validated-plain-text). A link contributes its label only, escaped.
 */

import type { LlmDocument } from "../ai/languageModel";
import type { PrismaClient } from "../lib/generated/prisma/client";
import type { Storage } from "../lib/storage";
import { AI_MAX_FILE_BYTES, isAiContentType, type AiContentType } from "./policy";
import { aiContextOf } from "./derived";

/** One file as a model receives it. Markdown is sent as `text/plain`. */
export type ContextDocument = LlmDocument;

export interface MeetingContext {
  readonly documents: readonly ContextDocument[];
  /** The labels of the meeting's links (a link without a label contributes nothing). */
  readonly linkLabels: readonly string[];
}

export const EMPTY_CONTEXT: MeetingContext = { documents: [], linkLabels: [] };

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const ascii = (text: string): number[] => [...text].map((ch) => ch.charCodeAt(0));

/** Do the bytes start the way the declared type says? */
export function bytesMatchType(bytes: Uint8Array, type: AiContentType): boolean {
  switch (type) {
    case "application/pdf":
      return startsWith(bytes, ascii("%PDF-"));
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/webp":
      return startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8);
    case "text/plain":
    case "text/markdown":
      if (bytes.includes(0)) return false;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return true;
      } catch {
        return false;
      }
  }
}

const mediaTypeOf = (type: AiContentType): ContextDocument["mediaType"] => (type === "text/markdown" ? "text/plain" : type);

/** The AI context of one meeting, as of `now`. Never throws for a storage problem. */
export async function loadMeetingContext(deps: { db: PrismaClient; storage: () => Storage }, meetingId: string, now: Date): Promise<MeetingContext> {
  const rows = await deps.db.meetingAttachment.findMany({
    where: { meetingId, status: "stored" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, kind: true, name: true, contentType: true, sizeBytes: true, objectKey: true, storedAt: true, label: true },
  });
  const linkLabels = rows.flatMap((r) => (r.kind === "link" && r.label ? [r.label] : []));
  const files = rows.filter((r) => r.kind === "file");
  if (files.length === 0) return { documents: [], linkLabels };

  const ai = aiContextOf(
    files.map((r) => ({ id: r.id, contentType: r.contentType!, sizeBytes: r.sizeBytes!, storedAt: r.storedAt! })),
    now,
  );
  const documents: ContextDocument[] = [];
  let skipped = 0;
  for (const file of files) {
    const type = file.contentType!;
    if (ai.get(file.id) !== "used" || !isAiContentType(type)) continue;
    try {
      const bytes = await deps.storage().getObjectBytes(file.objectKey!, AI_MAX_FILE_BYTES);
      if (bytes === null || !bytesMatchType(bytes, type)) {
        skipped += 1;
        continue;
      }
      documents.push({ name: file.name!, mediaType: mediaTypeOf(type), bytes });
    } catch (error) {
      skipped += 1;
      console.error("[attachments] context read failed:", error instanceof Error ? error.name : "unknown error");
    }
  }
  if (skipped > 0) console.warn(`[attachments] context files=${documents.length} skipped=${skipped}`);
  return { documents, linkLabels };
}
