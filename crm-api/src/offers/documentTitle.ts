/**
 * The words of an offer's document title, set per offer template and per language (the template editor's "Document title").
 * The title on page 1 is the words followed by the reference the document assigns (" – Rif. 0017/2026", " – Ref. 0017/2026"):
 * a template sets only the words before it; the reference, its label and the pending placeholder are the document's.
 *
 * A template that sets none prints the language's default ("CONTRATTO DI FORNITURA" / "SUPPLY CONTRACT", `words(language).titleText`),
 * so every template and offer that exists is unchanged. The text is copied into the snapshot at generation (`ContractSnapshot.documentTitle`),
 * so editing the template never changes an issued offer.
 *
 * Pure: no I/O.
 */

import { z } from "@hono/zod-openapi";
import { hasNoNul, NO_NUL_TEXT } from "../lib/http";
import type { OfferLanguage } from "./contract";
import { printable } from "./engine/printable";

/**
 * At most this many characters, counted after trimming. The title is one centred line of 11.5 pt bold type that also carries the
 * reference (" – Rif. 0017/2026r1", about 20 characters): with 60 the whole line is at most about 80 characters, which the page wraps
 * onto a second line at worst, and the fixed words are 22 and 15 characters long. Longer is a heading, not a title.
 */
export const DOCUMENT_TITLE_MAX = 60;

/**
 * One language's words: trimmed (and composed, NFC, so what is stored is what the document prints), blank = not set (`null`, as
 * `optionalText` reads a blank). One line, and only what the PDF can print: a character `printable` would turn into "?" (a control
 * character, a tab, a character outside WinAnsi, the engine's reserved marker and reference-token brackets) is refused, never
 * silently replaced.
 */
const WordsSchema = z
  .string()
  .refine(hasNoNul, NO_NUL_TEXT)
  .transform((value) => value.normalize("NFC").trim())
  .pipe(
    z
      .string()
      .max(DOCUMENT_TITLE_MAX, `At most ${DOCUMENT_TITLE_MAX} characters`)
      .regex(/^[^\r\n]*$/, "Must be one line")
      .refine((value) => printable(value) === value || /[\r\n]/.test(value), "Contains a character the document cannot print"),
  )
  .transform((value) => (value === "" ? null : value));

/** `{ it, en }`: each member optional; absent or `null` or blank = not set. */
export const DocumentTitleSchema = z
  .object({
    it: WordsSchema.nullable().optional(),
    en: WordsSchema.nullable().optional(),
  })
  .strict();

export type DocumentTitleInput = z.infer<typeof DocumentTitleSchema>;

/** The wire shape of a template's title: both languages, `null` where none is set. */
export const DocumentTitleViewSchema = z.object({ it: z.string().nullable(), en: z.string().nullable() });

export interface DocumentTitleColumns {
  readonly documentTitleIt: string | null;
  readonly documentTitleEn: string | null;
}

/** The stored columns of a template as the API shows them. */
export const documentTitleView = (row: DocumentTitleColumns): { it: string | null; en: string | null } => ({
  it: row.documentTitleIt,
  en: row.documentTitleEn,
});

/**
 * The columns a write sets. Absent (`undefined`): none, the row keeps what it has (a create starts with none); present: both are
 * replaced, a member that is absent or `null` clears its language.
 */
export const documentTitleData = (title: DocumentTitleInput | undefined): Partial<DocumentTitleColumns> =>
  title === undefined ? {} : { documentTitleIt: title.it ?? null, documentTitleEn: title.en ?? null };

/** The words the template sets for `language`, or `null` for the language's default. */
export const documentTitleOf = (row: DocumentTitleColumns, language: OfferLanguage): string | null =>
  language === "it" ? row.documentTitleIt : row.documentTitleEn;

/** The words of an unsaved template (the editor's try-preview) for `language`, or `null` for the default. */
export const documentTitleFrom = (title: DocumentTitleInput | undefined, language: OfferLanguage): string | null => title?.[language] ?? null;
