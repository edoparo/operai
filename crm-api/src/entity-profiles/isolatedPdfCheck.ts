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
 * started with an EMPTY environment: it holds no database URL, no key and no credential. The file reaches it on stdin; one JSON line
 * comes back on stdout.
 *
 * Limits (`ISOLATED_PDF_CHECK`):
 *  - `timeoutMs` 5 s of wall clock from the spawn (a letterhead takes 40 to 200 ms in all, Bun's start-up included): SIGKILL.
 *  - `maxRssBytes` 512 MiB, polled every 100 ms from outside (`/proc/<pid>/status` on Linux, `ps` on macOS), SIGKILL; the child also
 *    runs with `--smol`. Bun/JSC has no flag that caps a heap, and `ulimit -v` breaks JSC (it reserves address space), so this is a
 *    watchdog, not a wall: an allocation that outruns one poll interval is not stopped by it (residual R-1 in the ADR).
 *  - at most `maxConcurrent` 2 children at once and `maxQueued` 6 waiting; beyond that the caller gets 503 `pdf_check_busy`.
 * A kill (timeout, memory) is a DETERMINISTIC refusal of that file: `too_complex`, the same verdict the walk gives for a count, and
 * letterheadUse remembers it. A child that dies any other way (cannot start, crashes, prints nothing) is not a finding about the
 * file: 503 `pdf_check_unavailable`, remembered by nobody.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ProblemError } from "../lib/problem";
import type { LetterheadVerdict } from "./letterhead";
import type { BoundsVerdict } from "./pdfBounds";

export const ISOLATED_PDF_CHECK = {
  timeoutMs: 5_000,
  maxRssBytes: 512 * 1024 * 1024,
  maxConcurrent: 2,
  maxQueued: 6,
  pollMs: 100,
  /** What the child may print: one verdict line is far under it; more means it is not our worker. */
  maxOutputBytes: 4_096,
  /** Attachment verdicts kept (by digest of the bytes): a deal PDF is checked at confirm and again at every generation. */
  maxRememberedBounds: 128,
} as const;

export type IsolatedLimits = { readonly [K in keyof typeof ISOLATED_PDF_CHECK]: number };

/** Tests only: another limit set, or another worker (one that loops or allocates). The routes never pass any. */
export interface IsolatedOptions {
  readonly limits?: Partial<IsolatedLimits>;
  readonly worker?: string;
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

// ─── Concurrency ────────────────────────────────────────────────────────────

let running = 0;
const waiting: Array<() => void> = [];

async function acquire(limits: IsolatedLimits): Promise<void> {
  if (running < limits.maxConcurrent) {
    running++;
    return;
  }
  if (waiting.length >= limits.maxQueued) throw new PdfCheckBusyError();
  await new Promise<void>((resolve) => waiting.push(resolve)); // the slot is handed over: `running` stays counted
}

function release(): void {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

// ─── The child ──────────────────────────────────────────────────────────────

const live = new Set<ReturnType<typeof Bun.spawn>>();
process.once("exit", () => {
  for (const child of live) child.kill("SIGKILL");
});

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

async function runChild(mode: "letterhead" | "bound", bytes: Uint8Array, limits: IsolatedLimits, worker: string): Promise<Outcome> {
  await acquire(limits);
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let overrun: "timeout" | "memory" | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  try {
    try {
      // An empty environment: the child needs nothing the service holds. `--smol` trades speed for a smaller heap.
      child = Bun.spawn([process.execPath, "--smol", worker, mode], { stdin: bytes, stdout: "pipe", stderr: "ignore", env: {}, killSignal: "SIGKILL" });
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
    release();
  }
}

const withLimits = (options?: IsolatedOptions): IsolatedLimits => ({ ...ISOLATED_PDF_CHECK, ...options?.limits });

const LETTERHEAD_REASONS = new Set(["not_pdf", "page_count", "not_a4", "unembeddable", "too_complex", "decoded_too_large", "image_too_large", "unbounded_stream"]);

/** `checkLetterhead` in a child process. A kill is `too_complex` (a finding about the file); a child that cannot answer is a 503. */
export async function checkLetterheadIsolated(bytes: Uint8Array, options?: IsolatedOptions): Promise<LetterheadVerdict> {
  const outcome = await runChild("letterhead", bytes, withLimits(options), options?.worker ?? WORKER);
  if (outcome.kind === "overrun") {
    console.warn(`[pdf-check] letterhead killed: ${outcome.why}`);
    return { ok: false, reason: "too_complex" };
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

const bounds = new Map<string, BoundsVerdict>();
const boundsInflight = new Map<string, Promise<BoundsVerdict>>();

/** Tests only. */
export function resetIsolatedPdfCheckForTests(): void {
  bounds.clear();
  boundsInflight.clear();
}

/**
 * `boundPdf` in a child process, for a deal PDF attachment. The verdict is remembered by the SHA-256 of the bytes (the same file is
 * checked at confirm and at every generation that appends it, and the check must not double that cost); a kill is the refusal
 * `too_complex`, which the callers already map to 422 `attachment_unreadable`.
 */
export async function boundPdfIsolated(bytes: Uint8Array, options?: IsolatedOptions): Promise<BoundsVerdict> {
  const limits = withLimits(options);
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const known = bounds.get(digest);
  if (known) return known;
  const running = boundsInflight.get(digest);
  if (running) return running;
  const started = (async (): Promise<BoundsVerdict> => {
    const outcome = await runChild("bound", bytes, limits, options?.worker ?? WORKER);
    let verdict: BoundsVerdict;
    if (outcome.kind === "overrun") {
      console.warn(`[pdf-check] attachment killed: ${outcome.why}`);
      verdict = { ok: false, reason: "too_complex" };
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
    bounds.set(digest, verdict);
    while (bounds.size > limits.maxRememberedBounds) bounds.delete(bounds.keys().next().value as string);
    return verdict;
  })();
  boundsInflight.set(digest, started);
  const clear = () => void (boundsInflight.get(digest) === started && boundsInflight.delete(digest));
  started.then(clear, clear);
  return started;
}
