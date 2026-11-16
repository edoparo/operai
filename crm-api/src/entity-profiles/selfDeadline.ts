/**
 * A hard deadline a child process gives itself (specs/20261115-crm-offer-wizard, security L-15, ADR 20261115-uploaded-pdf-decoded-size-bound-before-parse).
 *
 * The parent kills a child that overruns, but a parent that is itself killed without a chance to act (SIGKILL, the OOM killer, a
 * supervisor that restarts it in place) leaves a child that is in a synchronous loop running for ever: a timer on the child's own
 * thread cannot fire while that thread loops. This starts a second THREAD whose only job is one timer; it fires whatever the first
 * thread is doing and ends the whole process with SIGKILL. A `timeout -s KILL` wrapper would do the same from outside, but it would
 * put a second process between the parent and the worker (killing the wrapper orphans the worker, the memory poll would read the
 * wrapper's), `timeout` does not exist on macOS, and it cannot be proven from here to exist in the production image.
 *
 * The deadline is later than the parent's own timeout (`hardDeadlineGraceMs`), so in the ordinary case the parent is first and this
 * never fires.
 */

/** Starts the watchdog thread; a non-positive or missing `ms` starts nothing (the worker run by hand). */
export function armSelfDeadline(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return;
  try {
    const watchdog = new Worker(new URL("./selfDeadlineThread.ts", import.meta.url).href);
    watchdog.postMessage(ms);
    watchdog.unref();
  } catch {
    // no thread: the parent's timeout still bounds the child while the parent lives
  }
}
