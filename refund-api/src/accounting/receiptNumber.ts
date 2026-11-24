/**
 * Pure, DB-free receipt-number rules (T3, specs/20261118-refund-accounting-export;
 * AC-4.2, AC-4.8; plan "Receipt number rules"; ADR 20261118-receipt-numbers-
 * come-from-a-row-locked-per-employee-and-year-counter-...).
 *
 * A receipt number is `<prefix><YY>/<seq>`: the employee's prefix (two initials, or the
 * two or three letters of a receipt code, T3 of specs/20261124), the two-digit year of the EXPENSE DATE, and the per-(employee, year) sequence
 * padded to three digits (`MC26/014`). The sequence itself comes from the
 * locked counter row (numbering.repo, T8); this module only decides the
 * initials and the text.
 *
 * Initials are computed from the owner's name at NUMBERING time and stored
 * inside the issued number, so a later change of name or email changes no
 * number. Two employees can share initials: the number is unique only together
 * with its owner, which is why it always travels with the employee's name.
 */

/** Combining marks left behind by NFD normalisation ("É" -> "E" + U+0301). */
const COMBINING_MARKS = /\p{M}/gu;
const LATIN_LETTER = /[A-Za-z]/;

/** Strips diacritics: "Élise Würth" -> "Elise Wurth". Letters without a decomposition ("ß", "Ø") stay as they are. */
function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "");
}

/** The first A-Z letter of a word, upper-cased, or `null` when it has none. */
function firstLetter(word: string): string | null {
  const match = LATIN_LETTER.exec(word);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Initials from a display name: the first A-Z letter of the FIRST word and of
 * the LAST word (diacritics stripped, whitespace-separated). `null` when the
 * name is empty, has one word, or gives fewer than two letters, which sends
 * the caller to the email (AC-4.8). "Matteo Codogno" -> "MC", "Anna Maria
 * Rossi" -> "AR", "Cher" -> `null`.
 */
function initialsFromName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const words = stripDiacritics(name).trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 2) return null;
  const first = firstLetter(words[0]!);
  const last = firstLetter(words[words.length - 1]!);
  return first !== null && last !== null ? first + last : null;
}

/**
 * Initials from the part of an email address before the `@` (AC-4.8):
 * - when at least two dot-separated parts contain a letter, the first letter of
 *   each of the first two such parts ("matteo.codogno" -> "MC", "m.c" -> "MC");
 * - otherwise the first two letters ("mcodogno" -> "MC");
 * - padded with `X` when fewer than two letters exist ("x" -> "XX", "123" -> "XX").
 */
function initialsFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  const localPart = stripDiacritics(at >= 0 ? email.slice(0, at) : email);
  const partsWithLetters = localPart.split(".").filter((part) => LATIN_LETTER.test(part));
  const letters =
    partsWithLetters.length >= 2
      ? [firstLetter(partsWithLetters[0]!)!, firstLetter(partsWithLetters[1]!)!]
      : [...localPart.matchAll(/[A-Za-z]/g)].slice(0, 2).map((m) => m[0].toUpperCase());
  return letters.join("").padEnd(2, "X");
}

/**
 * The two-letter initials of an employee (AC-4.2, AC-4.8): from the name when
 * it gives two letters, else from the email's local part, else `X`-padded.
 * Always exactly two characters A-Z.
 */
export function initials(name: string | null | undefined, email: string): string {
  return initialsFromName(name) ?? initialsFromEmail(email);
}

/** A receipt prefix as stored in a number and as a receipt code: two or three letters A-Z (AC-4.2). */
const PREFIX_PATTERN = /^[A-Z]{2,3}$/;

/** A receipt code (AC-4.2 of 20261124): two or three letters A-Z, already upper-cased. Use `normaliseReceiptCode` on raw input. */
export const RECEIPT_CODE_PATTERN = PREFIX_PATTERN;

/** A number as printed or as written in the accountant's register: prefix, two-digit year, `/`, one to five digits. */
const RECEIPT_NUMBER_PATTERN = /^([A-Za-z]{2,3})(\d{2})\/(\d{1,5})$/;

/**
 * `MC26/014`, `LCX26/040`: prefix (two initials, or a three-letter receipt code) + two-digit year + `/` + the sequence padded to
 * three digits. 1000 and above print in full (`MC26/1000`), never truncated.
 *
 * @param prefix two or three letters A-Z: the employee's receipt code, else the derived initials
 * @param year the year of the line's EXPENSE DATE (not of the approval)
 * @param seq the number from the counter, 1 or greater
 */
export function formatReceiptNumber(prefix: string, year: number, seq: number): string {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new RangeError(`prefix must be two or three letters A-Z, got "${prefix}"`);
  }
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError(`year must be a four-digit integer, got ${String(year)}`);
  }
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new RangeError(`seq must be an integer of 1 or more, got ${String(seq)}`);
  }
  const yy = String(year % 100).padStart(2, "0");
  return `${prefix}${yy}/${String(seq).padStart(3, "0")}`;
}

export interface ParsedReceiptNumber {
  readonly prefix: string;
  /** The two-digit year as a number: `AB26/005` -> 26. */
  readonly yy: number;
  /** The sequence as a number: `AB26/005` -> 5; 0 is a well-formed paper number. */
  readonly seq: number;
  /** The number as normalised (trimmed, upper-cased): the text a paper number is stored as. */
  readonly text: string;
}

/**
 * Reads a receipt number written by hand or by the system: trimmed and upper-cased first, then `^[A-Z]{2,3}\d{2}/\d{1,5}$`.
 * `null` when the text is not of that shape (`AA99/9A`, `ABCD26/001`, `A26/001`, a non-string). The sequence is not
 * range-checked here: `AB26/000` parses, and the caller decides what a zero means.
 */
export function parseReceiptNumber(text: unknown): ParsedReceiptNumber | null {
  if (typeof text !== "string") return null;
  // The shape is checked on the trimmed text BEFORE upper-casing, like a receipt code: `ß26/001` would otherwise become `SS26/001`.
  const trimmed = text.trim();
  const match = RECEIPT_NUMBER_PATTERN.exec(trimmed);
  if (!match) return null;
  return { prefix: match[1]!.toUpperCase(), yy: Number(match[2]), seq: Number(match[3]), text: trimmed.toUpperCase() };
}

export type NormalisedReceiptCode =
  | { readonly kind: "clear" }
  | { readonly kind: "code"; readonly code: string }
  | { readonly kind: "invalid" };

/**
 * What an operator typed as a receipt code (AC-4.2): `null`, `""` or only blanks clears the code; two or three letters
 * `a-z`/`A-Z` (after trimming) are the code, upper-cased; anything else is invalid. The shape is checked on the trimmed input
 * BEFORE upper-casing, so `ß` (which upper-cases to `SS`), `ÀB`, `A B`, `A1`, `A` and `ABCD` are all refused rather than turned
 * into a valid-looking code. Any non-string value other than `null` is invalid.
 */
export function normaliseReceiptCode(input: unknown): NormalisedReceiptCode {
  if (input === null) return { kind: "clear" };
  if (typeof input !== "string") return { kind: "invalid" };
  const trimmed = input.trim();
  if (trimmed === "") return { kind: "clear" };
  if (!/^[A-Za-z]{2,3}$/.test(trimmed)) return { kind: "invalid" };
  return { kind: "code", code: trimmed.toUpperCase() };
}
