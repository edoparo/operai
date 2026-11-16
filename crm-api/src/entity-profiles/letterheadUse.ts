/**
 * A stored letterhead is handed to a parser only after it passed `checkLetterhead` in this process
 * (specs/20261115-crm-offer-wizard DD-76, security M-4; ADR 20261102-crm-api-reads-attachment-bytes-for-offer-annexes' bounded read).
 *
 * Every path that uses a stored letterhead goes through here: the link route (`assertLetterheadUsable`, which keeps
 * no bytes) and both generate routes through `prepareOffer` / the wizard's generate (`usableLetterhead`, which returns
 * the checked bytes). A stored file that fails the check is 409 `letterhead_unusable` `{ entity, reason }`, with a body
 * that depends on the entity and the reason only.
 *
 * The verdict is remembered per object key for the life of the process. That is sound because a stored key is
 * immutable: confirm writes the bytes it checked under a fresh key that was never given an upload policy (DD-75), and
 * the keys stored before that change were upload keys whose 60 s POST policy expired long ago. A refusal is
 * remembered too; a read that failed (storage down, object missing) is not a verdict and is never remembered, and
 * neither is a refusal that an exception made (pdf-lib failing to load or embed): only a finding about the file is.
 */

import { MAX_LETTERHEAD_BYTES, type Storage } from "../lib/storage";
import { ProblemError } from "../lib/problem";
import { checkLetterheadIsolated } from "./isolatedPdfCheck";
import type { LetterheadVerdict } from "./letterhead";

/** The verdicts kept at once: a letterhead is two entities' worth of files, plus the ones replaced since the start. */
export const LETTERHEAD_MEMO_LIMIT = 64;

type Reason = Extract<LetterheadVerdict, { ok: false }>["reason"];

/** 409 `letterhead_unusable`: the entity's stored letterhead can no longer be used; it has to be uploaded again. */
export class LetterheadUnusableError extends ProblemError {
  constructor(entity: string, reason: Reason) {
    super({
      status: 409,
      code: "letterhead_unusable",
      detail: "The stored letterhead of this entity can no longer be used. Upload it again in CRM Settings.",
      extras: { entity, reason },
    });
  }
}

const memo = new Map<string, LetterheadVerdict>();
const inflight = new Map<string, Promise<{ verdict: LetterheadVerdict; bytes: Uint8Array }>>();

function remember(key: string, verdict: LetterheadVerdict): void {
  memo.delete(key);
  memo.set(key, verdict);
  while (memo.size > LETTERHEAD_MEMO_LIMIT) memo.delete(memo.keys().next().value as string);
}

/** Confirm checked these bytes and stored them under `key`: the first use needs no second check. */
export function rememberUsableLetterhead(key: string): void {
  remember(key, { ok: true });
}

/** Tests only. */
export function resetLetterheadMemoForTests(): void {
  memo.clear();
  inflight.clear();
}

/** Reads and checks `key` once, however many requests ask at the same time. A failed read rejects and remembers nothing. */
function readAndCheck(storage: Storage, key: string): Promise<{ verdict: LetterheadVerdict; bytes: Uint8Array }> {
  const running = inflight.get(key);
  if (running) return running;
  const started = (async () => {
    const bytes = await storage.getObject(key, MAX_LETTERHEAD_BYTES);
    const verdict = await checkLetterheadIsolated(bytes);
    // A refusal an exception made is this request's answer, never the file's: remembered, it would condemn a good letterhead
    // until the process restarts or the entity uploads it again (security I-11).
    if (verdict.ok || !verdict.fromException) remember(key, verdict);
    return { verdict, bytes };
  })();
  inflight.set(key, started);
  const clear = () => void (inflight.get(key) === started && inflight.delete(key));
  started.then(clear, clear);
  return started;
}

function refuse(entity: string, verdict: Extract<LetterheadVerdict, { ok: false }>): never {
  // The entity and the reason only: never the key, a link or the bytes.
  console.warn(`[letterhead] unusable entity=${entity} reason=${verdict.reason}`);
  throw new LetterheadUnusableError(entity, verdict.reason);
}

/** The bytes of the entity's stored letterhead, checked (once per key per process), or 409 `letterhead_unusable`. */
export async function usableLetterhead(storage: Storage, entity: string, key: string): Promise<Uint8Array> {
  const known = memo.get(key);
  if (known && !known.ok) return refuse(entity, known);
  if (known) return storage.getObject(key, MAX_LETTERHEAD_BYTES);
  const { verdict, bytes } = await readAndCheck(storage, key);
  return verdict.ok ? bytes : refuse(entity, verdict);
}

/** For the link route: checks (once per key per process) without keeping the bytes; 409 `letterhead_unusable` when it fails. */
export async function assertLetterheadUsable(storage: Storage, entity: string, key: string): Promise<void> {
  const known = memo.get(key) ?? (await readAndCheck(storage, key)).verdict;
  if (!known.ok) refuse(entity, known);
}
