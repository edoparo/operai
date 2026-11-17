/**
 * What is derived about a meeting's attachments, on read and never written (ADR 20260714-invitation-lifecycle-derived-expiry-state):
 * when a file stops being available (the bucket's lifecycle rule removes it 29 days after it was stored, like the
 * audio), and which files the AI reads. One function decides the second, and every AI caller and the list route use
 * it, so what the page says the AI reads is what the AI is sent.
 */

import { AUDIO_RETENTION_DAYS } from "../meetings/derived";
import { AI_MAX_FILE_BYTES, AI_MAX_TOTAL_BYTES, isAiContentType } from "./policy";

const DAY_MS = 86_400_000;
export const ATTACHMENT_RETENTION_DAYS = AUDIO_RETENTION_DAYS;

/** A link's label is given to the AI as text; its target is never fetched. */
export type AiContext = "used" | "not_supported" | "too_large" | "expired" | "label_only";

export interface StoredFileFacts {
  readonly id: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly storedAt: Date;
}

export const expiresAtOf = (storedAt: Date): Date => new Date(storedAt.getTime() + ATTACHMENT_RETENTION_DAYS * DAY_MS);
export const isExpired = (storedAt: Date, now: Date): boolean => now.getTime() >= expiresAtOf(storedAt).getTime();

/**
 * The AI context of every STORED file, keyed by id. Files are taken oldest first; a type the models do not read is
 * `not_supported`, an expired one `expired`, one past the per-file cap or past what is left of the total `too_large`.
 */
export function aiContextOf(files: readonly StoredFileFacts[], now: Date): Map<string, Exclude<AiContext, "label_only">> {
  const out = new Map<string, Exclude<AiContext, "label_only">>();
  let used = 0;
  const ordered = [...files].sort((a, b) => a.storedAt.getTime() - b.storedAt.getTime() || a.id.localeCompare(b.id));
  for (const file of ordered) {
    if (isExpired(file.storedAt, now)) out.set(file.id, "expired");
    else if (!isAiContentType(file.contentType)) out.set(file.id, "not_supported");
    else if (file.sizeBytes > AI_MAX_FILE_BYTES || used + file.sizeBytes > AI_MAX_TOTAL_BYTES) out.set(file.id, "too_large");
    else {
      used += file.sizeBytes;
      out.set(file.id, "used");
    }
  }
  return out;
}
