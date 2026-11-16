/**
 * Release audit of the stored letterheads (specs/20261115-crm-offer-wizard DD-78, security M-4).
 *
 *   bun scripts/check-letterheads.ts
 *
 * READ-ONLY: it reads each entity profile's stored letterhead from the bucket (the same bounded read the service does,
 * at most 5 MiB), runs the check the service runs before it uses one (`checkLetterhead`, the decoded-size bound
 * included) and prints one line per profile: the entity, `ok` / `REFUSED <reason>` / `UNREADABLE` / `none`, and the
 * figures the bound measured. It never prints a key, a link or bytes, and it writes nothing: no row, no object.
 *
 * Run it against PRODUCTION before the crm-api deploy that brings the bound (needs the production `DATABASE_URL` and
 * `CRM_S3_*`, read-only credentials will do). Exit 0: every stored letterhead is usable. Exit 1: at least one is
 * refused or cannot be read, and after the deploy that entity's offers would be refused with 409 `letterhead_unusable`
 * and its preview would show the failed band, so the deploy waits until the file is uploaded again in CRM Settings
 * (or the caps are revisited with the owner). Exit 2: not configured.
 */

import { db } from "../src/lib/db";
import { boundPdf } from "../src/entity-profiles/pdfBounds";
import { checkLetterhead } from "../src/entity-profiles/letterhead";
import { MAX_LETTERHEAD_BYTES, type Storage } from "../src/lib/storage";

export interface Io {
  log(line: string): void;
  error(line: string): void;
}

export interface CheckOptions {
  /** Only `getObject` is reachable: the audit cannot write or delete by construction. */
  readonly storage: Pick<Storage, "getObject">;
  readonly io: Io;
}

const pad = (entity: string) => entity.padEnd(9);

/** Returns the process exit code: 0 every stored letterhead is usable, 1 at least one is refused or unreadable. */
export async function runCheck({ storage, io }: CheckOptions): Promise<number> {
  const profiles = await db.entityProfile.findMany({ select: { entity: true, letterheadKey: true }, orderBy: { entity: "asc" } });
  if (profiles.length === 0) {
    io.log("No entity profile exists: nothing to check.");
    return 0;
  }
  const blocking: string[] = [];
  for (const { entity, letterheadKey } of profiles) {
    if (!letterheadKey) {
      io.log(`${pad(entity)} none`);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await storage.getObject(letterheadKey, MAX_LETTERHEAD_BYTES);
    } catch (error) {
      // The class only: the message of a storage error may carry the key.
      io.log(`${pad(entity)} UNREADABLE ${error instanceof Error ? error.name : "error"}`);
      blocking.push(`${entity}: the stored letterhead cannot be read`);
      continue;
    }
    const verdict = await checkLetterhead(bytes);
    const bounds = await boundPdf(bytes);
    const figures = bounds.ok
      ? `decodedBytes=${bounds.decodedBytes} nonImageBytes=${bounds.nonImageBytes} objects=${bounds.objects} streams=${bounds.streams} imagePixels=${bounds.imagePixels}`
      : "decodedBytes=- nonImageBytes=- objects=- streams=- imagePixels=-";
    if (verdict.ok) {
      io.log(`${pad(entity)} ok ${figures}`);
    } else {
      io.log(`${pad(entity)} REFUSED ${verdict.reason} ${figures}`);
      blocking.push(`${entity}: ${verdict.reason}`);
    }
  }
  if (blocking.length > 0) {
    io.error(`${blocking.length} letterhead(s) would be refused after the deploy (${blocking.join("; ")}). Upload them again in CRM Settings, then re-run this check: the deploy waits.`);
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  const { requireStorage } = await import("../src/lib/storage");
  let storage: Storage;
  try {
    storage = requireStorage();
  } catch {
    console.error("CRM_S3_* is not set: nothing was checked.");
    process.exit(2);
  }
  const code = await runCheck({ storage, io: { log: (l) => console.log(l), error: (l) => console.error(l) } });
  await db.$disconnect();
  process.exit(code);
}
