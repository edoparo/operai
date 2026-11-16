/**
 * Runs the checks of an uploaded PDF in a CHILD PROCESS with a wall-clock timeout and a memory ceiling, killed on overrun
 * (specs/20261115-crm-offer-wizard, security round 10, ADR 20261115-uploaded-pdf-decoded-size-bound-before-parse, amendment of 2026-11-16).
 *
 * Why: the bounds of `pdfBounds.ts` and `formGraph.ts` are STATIC (a count of bytes, objects, steps). Four rounds in a row (M-10,
 * M-11, L-10/L-11, M-12) found a loop over something the file supplies that the count did not see, and each one was a hold of the
 * Bun event loop of crm-api, for every caller of the service, for as long as 95 seconds. A static bound is only as good as the
 * completeness of the sweep; this module makes the failure mode bounded whatever the sweep missed: the check runs somewhere
 * the event loop of the service is not, and a check that overruns is killed and refused.
 *
 * What runs here: `checkLetterhead` (decoded-size bound, pdf-lib load, A4, the form-graph walk and the embed probe) and `boundPdf`
 * on a deal PDF attachment (at confirm and before the annex load). The child (`pdfCheckWorker.ts`) imports only those pure checks and is
 * started with an EMPTY environment and no dotenv: `--no-env-file` (Bun autoloads the dotenv file of the working directory into a
 * child whatever `env: {}` says, security L-12) and a working directory of its own that holds nothing. So the service hands it no
 * database URL, no key and no credential. That is a choice about what is handed over, NOT a confidentiality boundary: on Linux a child
 * of the same uid can still read `/proc/<ppid>/environ` and the parent's memory; only a different uid would close that (ADR, R-6).
 * The file reaches it on stdin; one JSON line comes back on stdout.
 *
 * Limits (`ISOLATED_PDF_CHECK`):
 *  - `timeoutMs` 5 s of wall clock from the spawn (a letterhead takes 40 to 200 ms in all, Bun's start-up included): SIGKILL.
 *  - `maxRssBytes` 512 MiB, polled from outside (`/proc/<pid>/status` on Linux every 20 ms, a file read; `ps` on macOS every 100 ms,
 *    a spawn), SIGKILL. The child also runs with `--smol`, which makes the collector more eager and so lowers heap growth: it does
 *    NOT cap it. Bun/JSC has no flag that caps a heap, and `ulimit -v` breaks JSC (it reserves address space), so this is a
 *    watchdog, not a wall: an allocation that outruns one poll interval is not stopped by it (residual R-1 in the ADR).
 *  - at most `maxConcurrent` 2 children at once and `maxQueued` 6 waiting, of which one user (`owner`, the JWT `sub`) may hold
 *    `maxQueuedPerOwner` 2; beyond that the caller gets 503 `pdf_check_busy` (security L-13). A caller that READS the bytes takes
 *    its slot first (`acquireCheckSlot`), so a refusal for busy holds no bytes.
 *  - the child ends itself at `timeoutMs + hardDeadlineGraceMs` whatever the parent does: a watchdog thread inside it
 *    (`selfDeadline.ts`) kills the process even while its only thread is in a loop, so it does not outlive a parent that was killed
 *    without a chance to act (SIGKILL, the OOM killer; security L-15). On SIGTERM and SIGINT the parent kills its live children itself.
 * A kill (timeout, memory) is a refusal of that file: `too_complex`, the same verdict the walk gives for a count. A MEMORY kill is
 * remembered for the life of the process (the file's own doing); a TIMEOUT kill is remembered for `timeoutVerdictTtlMs` only,
 * because a starved host looks the same (security L-14). A child that dies any other way (cannot start, crashes, prints nothing) is
 * not a finding about the file: 503 `pdf_check_unavailable`, remembered by nobody.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProblemError } from "../lib/problem";
import type { LetterheadVerdict } from "./letterhead";
import type { BoundsVerdict } from "./pdfBounds";

/** Linux reads the resident set from a file, so it is polled often; macOS spawns `ps` per poll, so it is not (security I-22). */
export function pollIntervalFor(platform: string): number {
  return platform === "linux" ? 20 : 100;
}

export const ISOLATED_PDF_CHECK = {
  timeoutMs: 5_000,
  maxRssBytes: 512 * 1024 * 1024,
  maxConcurrent: 2,
  maxQueued: 6,
  /** Of the queued, what one user may hold: one authenticated user cannot fill the queue for everybody (security L-13). */
  maxQueuedPerOwner: 2,
  /** How often the child's resident set is read: `pollIntervalFor` the platform. */
  pollMs: pollIntervalFor(process.platform),
  /** What the child may print: one verdict line is far under it; more means it is not our worker. */
  maxOutputBytes: 4_096,
  /** Attachment verdicts kept (by digest of the bytes): a deal PDF is checked at confirm and again at every generation. */
  maxRememberedBounds: 128,
  /** How long a verdict that came from a TIMEOUT kill is remembered: a starved host looks the same, so it is not for good (security L-14). */
  timeoutVerdictTtlMs: 60_000,
  /** What the child is given beyond `timeoutMs` before it ends itself (security L-15). */
  hardDeadlineGraceMs: 2_000,
} as const;

export type IsolatedLimits = { readonly [K in keyof typeof ISOLATED_PDF_CHECK]: number };

/** One of the `maxConcurrent` places to run a check in. Held from before the bytes are read until the check is over. */
export interface CheckSlot {
  /** Gives the place back (to the next waiting, or to nobody). Giving it back twice gives it back once. */
  release(): void;
}

/** Tests only: another limit set, or another worker (one that loops or allocates). The routes pass `owner` and `slot` only. */
export interface IsolatedOptions {
  readonly limits?: Partial<IsolatedLimits>;
  readonly worker?: string;
  /** Who asks (the JWT `sub`): counted against `maxQueuedPerOwner`. Absent for a check no single user starts. */
  readonly owner?: string;
  /** A slot the caller already holds (it read the bytes under it): the check runs in it and does not take another. */
  readonly slot?: CheckSlot;
  /** Tests only: the child's own deadline, instead of `timeoutMs + hardDeadlineGraceMs`. */
  readonly hardDeadlineMs?: number;
}

const WORKER = fileURLToPath(new URL("./pdfCheckWorker.ts", import.meta.url));

/** 503 `pdf_check_busy`: the checks are all taken and the queue is full. Nothing was decided about the file. */
export class PdfCheckBusyError extends ProblemError {
  constructor() {
    super({ status: 503, code: "pdf_check_busy", detail: "Too many files are being checked right now. Try again in a moment." });
  }
}

/** 503 `pdf_check_unavailable`: the check could not run (the child did not start or died). Nothing was decided about the file. */
export class PdfCheckUnavailableError extends ProblemError {
  constructor() {
    super({ status: 503, code: "pdf_check_unavailable", detail: "The file could not be checked. Try again in a moment." });
  }
}

type Outcome = { readonly kind: "verdict"; readonly value: unknown } | { readonly kind: "overrun"; readonly why: "timeout" | "memory" };

const withLimits = (options?: IsolatedOptions): IsolatedLimits => ({ ...ISOLATED_PDF_CHECK, ...options?.limits });

// ─── Concurrency ────────────────────────────────────────────────────────────

interface Waiter {
  readonly owner: string | undefined;
  readonly grant: () => void;
}

let running = 0;
const waiting: Waiter[] = [];

function handOver(): void {
  const next = waiting.shift();
  if (next) next.grant(); // the place is handed over: `running` stays counted
  else running--;
}

function makeSlot(): CheckSlot {
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      handOver();
    },
  };
}

/**
 * Takes a place to run a check, waiting in the queue when all are taken; 503 `pdf_check_busy` when the queue is full or `owner`
 * already holds its share of it. A caller that reads a user's bytes calls this BEFORE reading them and passes the slot to the check
 * (`options.slot`), so a refusal for busy has read nothing (security L-13). A verdict that is already remembered needs no slot.
 */
export async function acquireCheckSlot(owner?: string, options?: IsolatedOptions): Promise<CheckSlot> {
  const limits = withLimits(options);
  if (running < limits.maxConcurrent) {
    running++;
    return makeSlot();
  }
  if (waiting.length >= limits.maxQueued) throw new PdfCheckBusyError();
  if (owner !== undefined && waiting.filter((w) => w.owner === owner).length >= limits.maxQueuedPerOwner) throw new PdfCheckBusyError();
  return new Promise<CheckSlot>((resolve) => waiting.push({ owner, grant: () => resolve(makeSlot()) }));
}

// ─── The child ──────────────────────────────────────────────────────────────

const live = new Set<ReturnType<typeof Bun.spawn>>();

/** Tests only: the processes of the children running now. */
export function liveChildPids(): number[] {
  return [...live].map((child) => child.pid);
}

// A working directory of the children's own: it holds no dotenv, no bunfig and nothing of the service (security L-12). Made on first use.
let childCwd: string | undefined;
function emptyDirectory(): string {
  childCwd ??= mkdtempSync(join(tmpdir(), "crm-pdfcheck-"));
  return childCwd;
}

/** The children die with the service, whichever way it ends that gives it a chance to act. */
function shutdownChildren(): void {
  for (const child of live) child.kill("SIGKILL");
  if (childCwd) {
    try {
      rmSync(childCwd, { recursive: true, force: true });
    } catch {
      // a directory in the temp folder that could not be removed is not worth a failure while ending
    }
    childCwd = undefined;
  }
}

// `exit` does not run on a signal (SIGTERM is what the platform sends to stop a deploy), so a looping child would outlive the
// service. A handler takes the default away, so after killing the children it asks for the default: the same signal again, which ends
// the process by it exactly as before (security L-15). A death nobody can act on (SIGKILL, the OOM killer) is covered by the child's
// own deadline.
process.once("exit", shutdownChildren);
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    shutdownChildren();
    process.kill(process.pid, signal);
  });
}

let rssUnreadableLogged = false;

/** The resident set of `pid` in bytes, read from outside the process; null when this platform gives no way to read it. */
async function rssOf(pid: number): Promise<number | null> {
  try {
    if (process.platform === "linux") {
      const match = /VmRSS:\s+(\d+)\s*kB/.exec(await readFile(`/proc/${pid}/status`, "utf8"));
      return match ? Number(match[1]) * 1024 : null;
    }
    if (process.platform === "darwin") {
      const ps = Bun.spawn(["/bin/ps", "-o", "rss=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore", env: {} });
      const kb = Number.parseInt((await new Response(ps.stdout).text()).trim(), 10);
      return Number.isFinite(kb) ? kb * 1024 : null;
    }
  } catch {
    // the child is gone, or the platform refuses: no reading
  }
  return null;
}

/** At most `max` bytes of `stream`, to its end; null when it ran past `max` (the caller kills the child). */
async function readCapped(stream: ReadableStream<Uint8Array>, max: number, onTooMuch: () => void): Promise<string | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > max) {
      onTooMuch();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function runChild(mode: "letterhead" | "bound", bytes: Uint8Array, limits: IsolatedLimits, worker: string, options?: IsolatedOptions): Promise<Outcome> {
  const slot = options?.slot ?? (await acquireCheckSlot(options?.owner, options));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let overrun: "timeout" | "memory" | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  try {
    try {
      // The child is handed nothing the service holds: an empty environment, no dotenv (`--no-env-file`: Bun loads the dotenv file of
      // its working directory whatever `env` says, security L-12) and a working directory of its own that is empty. `--smol` makes the
      // collector more eager, lowering heap growth; it does not cap it. The last argument is the child's own deadline (L-15).
      const hardDeadlineMs = options?.hardDeadlineMs ?? limits.timeoutMs + limits.hardDeadlineGraceMs;
      child = Bun.spawn([process.execPath, "--smol", "--no-env-file", worker, mode, String(hardDeadlineMs)], {
        stdin: bytes,
        stdout: "pipe",
        stderr: "ignore",
        env: {},
        cwd: emptyDirectory(),
        killSignal: "SIGKILL",
      });
    } catch (error) {
      console.error("[pdf-check] cannot start the child:", error instanceof Error ? error.message : error);
      throw new PdfCheckUnavailableError();
    }
    const started = child;
    live.add(started);
    const kill = (why: "timeout" | "memory") => {
      if (overrun === null) overrun = why;
      started.kill("SIGKILL");
    };
    timer = setTimeout(() => kill("timeout"), limits.timeoutMs);
    let polling = false;
    poll = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const rss = await rssOf(started.pid);
        if (rss === null) {
          if (!rssUnreadableLogged && started.exitCode === null) {
            rssUnreadableLogged = true;
            console.warn("[pdf-check] the memory of the child cannot be read on this platform: only the timeout bounds it");
          }
        } else if (rss > limits.maxRssBytes) kill("memory");
      } finally {
        polling = false;
      }
    }, limits.pollMs);

    const text = await readCapped(started.stdout as ReadableStream<Uint8Array>, limits.maxOutputBytes, () => started.kill("SIGKILL"));
    const code = await started.exited;
    if (overrun !== null) return { kind: "overrun", why: overrun };
    if (code === 0 && text !== null) {
      try {
        return { kind: "verdict", value: JSON.parse(text) };
      } catch {
        // falls through: not our worker's answer
      }
    }
    console.error(`[pdf-check] the child ended without a verdict (exit ${code}${started.signalCode ? `, ${started.signalCode}` : ""})`);
    throw new PdfCheckUnavailableError();
  } finally {
    if (timer) clearTimeout(timer);
    if (poll) clearInterval(poll);
    if (child) {
      child.kill("SIGKILL"); // no-op once it has exited
      live.delete(child);
    }
    if (!options?.slot) slot.release(); // a slot the caller holds is the caller's to give back
  }
}

const LETTERHEAD_REASONS = new Set(["not_pdf", "page_count", "not_a4", "unembeddable", "too_complex", "decoded_too_large", "image_too_large", "unbounded_stream"]);

/**
 * `checkLetterhead` in a child process. A kill is `too_complex` (a finding about the file); one for TIME carries `fromTimeout`,
 * which tells the caller's memo to keep it briefly (L-14). A child that cannot answer is a 503.
 */
export async function checkLetterheadIsolated(bytes: Uint8Array, options?: IsolatedOptions): Promise<LetterheadVerdict> {
  const outcome = await runChild("letterhead", bytes, withLimits(options), options?.worker ?? WORKER, options);
  if (outcome.kind === "overrun") {
    console.warn(`[pdf-check] letterhead killed: ${outcome.why}`);
    return outcome.why === "timeout" ? { ok: false, reason: "too_complex", fromTimeout: true } : { ok: false, reason: "too_complex" };
  }
  const v = outcome.value as { ok?: unknown; reason?: unknown; fromException?: unknown } | null;
  if (v && v.ok === true) return { ok: true };
  if (v && v.ok === false && typeof v.reason === "string" && LETTERHEAD_REASONS.has(v.reason)) {
    const reason = v.reason as Extract<LetterheadVerdict, { ok: false }>["reason"];
    return v.fromException === true ? { ok: false, reason, fromException: true } : { ok: false, reason };
  }
  console.error("[pdf-check] the child answered with something that is not a verdict");
  throw new PdfCheckUnavailableError();
}

// ─── Attachments ────────────────────────────────────────────────────────────

/** A remembered verdict; `until` (ms since the epoch) is set for one that a starved host could have made (a timeout kill). */
interface Remembered {
  readonly verdict: BoundsVerdict;
  readonly until?: number;
}

const bounds = new Map<string, Remembered>();
const boundsInflight = new Map<string, Promise<BoundsVerdict>>();

/** Tests only. */
export function resetIsolatedPdfCheckForTests(): void {
  bounds.clear();
  boundsInflight.clear();
}

function recall(digest: string): BoundsVerdict | undefined {
  const known = bounds.get(digest);
  if (!known) return undefined;
  if (known.until !== undefined && Date.now() >= known.until) {
    bounds.delete(digest);
    return undefined;
  }
  return known.verdict;
}

/**
 * `boundPdf` in a child process, for a deal PDF attachment. The verdict is remembered by the SHA-256 of the bytes (the same file is
 * checked at confirm and at every generation that appends it, and the check must not double that cost); a kill is the refusal
 * `too_complex`, which the callers already map to 422 `attachment_unreadable`. A memory kill is remembered for good, a timeout
 * kill for `timeoutVerdictTtlMs` (the same file is not run for 5 s on every generation, and a starved host does not condemn it
 * for the life of the process, security L-14). A memo hit takes no slot: the caller that read the bytes under a slot gives it back.
 */
export async function boundPdfIsolated(bytes: Uint8Array, options?: IsolatedOptions): Promise<BoundsVerdict> {
  const limits = withLimits(options);
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const known = recall(digest);
  if (known) return known;
  const running = boundsInflight.get(digest);
  if (running) return running;
  const started = (async (): Promise<BoundsVerdict> => {
    const outcome = await runChild("bound", bytes, limits, options?.worker ?? WORKER, options);
    let verdict: BoundsVerdict;
    let until: number | undefined;
    if (outcome.kind === "overrun") {
      console.warn(`[pdf-check] attachment killed: ${outcome.why}`);
      verdict = { ok: false, reason: "too_complex" };
      if (outcome.why === "timeout") until = Date.now() + limits.timeoutVerdictTtlMs;
    } else {
      const v = outcome.value as { ok?: unknown; reason?: unknown } | null;
      if (v && v.ok === true) verdict = v as BoundsVerdict;
      else if (v && v.ok === false && typeof v.reason === "string" && LETTERHEAD_REASONS.has(v.reason)) verdict = v as BoundsVerdict;
      else {
        console.error("[pdf-check] the child answered with something that is not a verdict");
        throw new PdfCheckUnavailableError();
      }
    }
    bounds.delete(digest);
    bounds.set(digest, until === undefined ? { verdict } : { verdict, until });
    while (bounds.size > limits.maxRememberedBounds) bounds.delete(bounds.keys().next().value as string);
    return verdict;
  })();
  boundsInflight.set(digest, started);
  const clear = () => void (boundsInflight.get(digest) === started && boundsInflight.delete(digest));
  started.then(clear, clear);
  return started;
}
