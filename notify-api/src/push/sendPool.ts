/**
 * The process-wide Web Push send pool (T18, specs/20261111-push-notifications, S-M2, AC-2.4/2.6).
 *
 * Why: a recipient has up to 20 devices and every notification fans out to all of them. Without
 * a bound, a burst of notifications opens thousands of simultaneous requests to the push
 * services (10 s timeout each) and holds their buffers. The pool keeps at most `concurrency`
 * sends in flight across ALL dispatches, queues the rest first-in first-out, and DROPS what
 * would overflow a queue bound: a push is best effort and never retried (AC-2.6), the in-app
 * notification is already stored. notify-api runs one instance (ADR 20260713-sse-stream-auth-short-lived-ticket), so process-wide is
 * suite-wide.
 *
 * `run` never rejects; an error inside `send` is the caller's to log (the channel's sender
 * wrapper already catches and logs by class). Nothing here sees a device, an endpoint or a
 * payload: it takes closures and a recipient key used only for the per-recipient bound.
 */

export type SendPoolOptions = {
  /** Sends in flight at once. */
  concurrency: number;
  /** Sends WAITING in the queue (in-flight ones excluded), all recipients together. */
  maxQueued: number;
  /** Sends waiting for one recipient. */
  maxQueuedPerRecipient: number;
};

export interface SendPool {
  /** `done` once `send` settled (however it ended), `dropped` when a queue bound refused it. Never rejects. */
  run(recipientId: string, send: () => Promise<void>): Promise<"done" | "dropped">;
}

type Job = { recipientId: string; send: () => Promise<void>; resolve: (r: "done") => void };

export function createSendPool(options: SendPoolOptions): SendPool {
  const queue: Job[] = [];
  const perRecipient = new Map<string, number>();
  let inFlight = 0;

  const start = (job: Job): void => {
    inFlight++;
    // `async` wrapper: a synchronous throw from `send` becomes a rejection like any other.
    void (async () => job.send())()
      .catch(() => {})
      .finally(() => {
        inFlight--;
        job.resolve("done");
        pump();
      });
  };

  const pump = (): void => {
    while (inFlight < options.concurrency) {
      const job = queue.shift();
      if (job === undefined) return;
      const left = (perRecipient.get(job.recipientId) ?? 1) - 1;
      if (left <= 0) perRecipient.delete(job.recipientId);
      else perRecipient.set(job.recipientId, left);
      start(job);
    }
  };

  return {
    run(recipientId, send) {
      return new Promise((resolve) => {
        const job: Job = { recipientId, send, resolve };
        if (inFlight < options.concurrency && queue.length === 0) {
          start(job);
          return;
        }
        const waiting = perRecipient.get(recipientId) ?? 0;
        if (queue.length >= options.maxQueued || waiting >= options.maxQueuedPerRecipient) {
          resolve("dropped");
          return;
        }
        perRecipient.set(recipientId, waiting + 1);
        queue.push(job);
      });
    },
  };
}
