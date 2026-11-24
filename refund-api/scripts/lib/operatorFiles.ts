/**
 * Helpers shared by the operator-run scripts that read files the operator names (T6, specs/20261124-receipt-numbers-from-the-register;
 * ADR 20261124-a-one-off-release-that-needs-human-judgement-...). Moved out of `receipt-baseline-from-register.ts` (CSV, date
 * year, cell shape) and `accounting-release.ts` (the git-worktree warning), plus the file fingerprint and the exclusive writer.
 *
 * Personal data: nothing here prints or returns the content of a cell. `shapeOf` is the only way a cell is ever described.
 */

import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** A failure of an operator file that the script itself words (never a cell's text). */
export class OperatorFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorFileError";
  }
}

// ─── Git worktree ────────────────────────────────────────────────────────────

/**
 * The git worktree that contains `path` (a directory or a file `.git` at any level above it, symlinks of the directory followed), or
 * `null`. An operator file names employees: it must never be committed. It says nothing about the file's content.
 */
export function pathInsideGitWorktree(path: string): string | null {
  const absolute = resolve(path);
  let dir = dirname(absolute);
  try {
    dir = realpathSync(dir);
  } catch {
    // a directory that does not exist yet: the read or the write will fail on its own
  }
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The stderr warning for an operator file inside a git worktree, or `null`. `what` is a fixed label (`the register export`). */
export function worktreeWarning(
  path: string,
  what: string,
  why = "It holds personal data",
  advice = "keep it outside the repository",
): string | null {
  const dir = pathInsideGitWorktree(path);
  if (dir === null) return null;
  return `WARNING: ${what} ${resolve(path)} is inside a git worktree (${dir}). ${why} and must never be committed: ${advice}.`;
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/** The delimiter of the header line: the one of `,` `;` tab that occurs most outside quotes (ties and none: comma). */
function detectDelimiter(text: string): string {
  const counts = new Map<string, number>([[",", 0], [";", 0], ["\t", 0]]);
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  let best = ",";
  for (const [delimiter, count] of counts) if (count > counts.get(best)!) best = delimiter;
  return best;
}

/** RFC 4180 rows: quoted fields, `""` as a quote, CRLF or LF, a line break inside quotes. Fully blank lines are dropped. */
export function parseCsvRows(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0]!.trim() !== "") rows.push(row);
    row = [];
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (quoted) throw new OperatorFileError("the CSV ends inside a quoted field: the file is cut off or its quotes are unbalanced");
  if (fieldStarted || field !== "" || row.length > 0) endRow();
  return rows;
}

/** The year of a date cell (`2026-03-14`, `2026-03-14T10:00:00Z`, `14.03.2026`, `14/03/2026`), or `null` when it is not one of those. */
export function yearOfDate(cell: string): number | null {
  const value = cell.trim();
  const iso = /^(\d{4})-\d{1,2}-\d{1,2}(?:[T\s].*)?$/.exec(value);
  if (iso) return Number(iso[1]);
  const local = /^\d{1,2}[./]\d{1,2}[./](\d{4})(?:[T\s].*)?$/.exec(value);
  return local ? Number(local[1]) : null;
}

/** The shape of a cell, never its text: every letter becomes A, every digit 9, `@` becomes ?, cut at 24 characters. */
export function shapeOf(cell: string): string {
  const shape = cell.trim().replace(/\p{L}/gu, "A").replace(/\d/g, "9").replace(/@/g, "?");
  return shape.length > 24 ? `${shape.slice(0, 24)}…` : shape;
}

// ─── Fingerprint and exclusive write ─────────────────────────────────────────

/** `sha256:<hex>` of a file's bytes (the prefix keeps a spreadsheet from reading the value as a number). */
export function sha256Bytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function sha256File(path: string): string {
  return sha256Bytes(readFileSync(path));
}

/**
 * Writes a new file with mode 0600 and fails if the path exists (`O_EXCL`): a decided pairing file is never overwritten by a
 * proposal. Throws the system error (`EEXIST`) unchanged; the existing file is not touched.
 */
export function writeFileExclusive(path: string, content: string | Uint8Array): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    writeFileSync(fd, content);
  } finally {
    closeSync(fd);
  }
}
