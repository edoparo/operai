/**
 * What may be attached to a meeting, and what of it the AI reads (docs/adr/20261117-meeting-attachments-in-the-audio-bucket-forwarded-unparsed).
 *
 * Every accepted type is listed here; the presigned POST pins the declared type and the exact size, so nothing else
 * reaches the bucket. Only the `AI_CONTENT_TYPES` are ever read back by the service, and only to forward the bytes,
 * UNPARSED, to the EU model that reads them natively (Gemini for the transcript, Claude for summaries and answers):
 * no document parser runs in our process. Office files are stored for people and never read by the service.
 */

/** A file is at most 20 MiB (the CHECK in the migration says the same). */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** Files and links per meeting, counted separately. */
export const MAX_FILES_PER_MEETING = 10;
export const MAX_LINKS_PER_MEETING = 10;
export const MAX_NAME_CHARS = 200;
export const MAX_LABEL_CHARS = 200;
export const MAX_URL_CHARS = 2000;

/** The upload policy is valid 10 minutes; the confirm must come before then. */
export const ATTACHMENT_POST_SECONDS = 10 * 60;
/** A download link lives 60 s and forces a download. */
export const ATTACHMENT_GET_SECONDS = 60;

/** The types a model reads natively. Markdown is sent as plain text. */
export const AI_CONTENT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain", "text/markdown"] as const;

/** Stored for people, never read by the service. */
export const STORED_ONLY_CONTENT_TYPES = [
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "text/csv",
] as const;

export const ATTACHMENT_CONTENT_TYPES: readonly string[] = [...AI_CONTENT_TYPES, ...STORED_ONLY_CONTENT_TYPES];

export type AiContentType = (typeof AI_CONTENT_TYPES)[number];

export const isAttachmentContentType = (value: string): boolean => ATTACHMENT_CONTENT_TYPES.includes(value);
export const isAiContentType = (value: string): value is AiContentType => (AI_CONTENT_TYPES as readonly string[]).includes(value);

/**
 * The AI context budget. One file larger than `AI_MAX_FILE_BYTES` is not sent (Claude takes images up to 5 MB, and a
 * large deck is mostly pictures); the files that fit are taken oldest first until `AI_MAX_TOTAL_BYTES`. The audio of a
 * transcription part is up to 15 MiB inline as well, so the two together stay well inside one Vertex request.
 */
export const AI_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const AI_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
