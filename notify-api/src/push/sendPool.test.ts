/**
 * The process-wide Web Push send pool (T18, specs/20261111-push-notifications, S-M2):
 * at most 16 sends in flight, a bounded FIFO queue, overflow dropped (best effort, AC-2.6).
 */

import { describe, it, expect } from "bun:test";
import { createSendPool } from "./sendPool";

/** A send that stays in flight until `release()`; records the order sends started in. */
const harness = () => {
  const started: string[] = [];
  const releases = new Map<string, () => void>();
  let inFlight = 0;
  let peak = 0;
  const send = (name: string) => () => {
    started.push(name);
    inFlight++;
    peak = Math.max(peak, inFlight);
    return new Promise<void>((resolve) => {
      releases.set(name, () => {
        inFlight--;
        resolve();
      });
    });
  };
  return { started, releases, send, peak: () => peak, inFlight: () => inFlight };
};

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("sendPool", () => {
  it("3 dispatches x 20 devices: never more than 16 in flight, all eventually done", async () => {
    const h = harness();
    const pool = createSendPool({ concurrency: 16, maxQueued: 1_000, maxQueuedPerRecipient: 100 });
    const results: Promise<string>[] = [];
    for (const user of ["a", "b", "c"]) {
      for (let i = 0; i < 20; i++) results.push(pool.run(user, h.send(`${user}${i}`)));
    }
    await tick();
    expect(h.inFlight()).toBe(16);
    while (h.releases.size > 0) {
      for (const [name, release] of [...h.releases]) {
        h.releases.delete(name);
        release();
      }
      await tick();
    }
    expect(h.peak()).toBe(16);
    expect(await Promise.all(results)).toEqual(Array(60).fill("done"));
    expect(h.started).toHaveLength(60);
  });

  it("releasing one send starts the next queued one, in FIFO order", async () => {
    const h = harness();
    const pool = createSendPool({ concurrency: 2, maxQueued: 10, maxQueuedPerRecipient: 10 });
    void pool.run("a", h.send("s1"));
    void pool.run("a", h.send("s2"));
    void pool.run("b", h.send("s3"));
    void pool.run("a", h.send("s4"));
    await tick();
    expect(h.started).toEqual(["s1", "s2"]);
    h.releases.get("s2")!();
    await tick();
    expect(h.started).toEqual(["s1", "s2", "s3"]);
    h.releases.get("s1")!();
    await tick();
    expect(h.started).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("drops the send that would be the 1 001st queued one overall", async () => {
    const h = harness();
    const pool = createSendPool({ concurrency: 1, maxQueued: 1_000, maxQueuedPerRecipient: 100 });
    void pool.run("r0", h.send("running"));
    const queued: Promise<string>[] = [];
    for (let i = 0; i < 1_000; i++) queued.push(pool.run(`r${Math.floor(i / 100)}`, h.send(`q${i}`)));
    expect(await pool.run("r-other", h.send("overflow"))).toBe("dropped");
    expect(h.started).not.toContain("overflow");
    // the queued ones are still going to run
    h.releases.get("running")!();
    await tick();
    expect(h.started).toContain("q0");
  });

  it("drops the 101st queued send of one recipient but still queues another recipient's", async () => {
    const h = harness();
    const pool = createSendPool({ concurrency: 1, maxQueued: 1_000, maxQueuedPerRecipient: 100 });
    void pool.run("blocker", h.send("running"));
    for (let i = 0; i < 100; i++) void pool.run("greedy", h.send(`g${i}`));
    expect(await pool.run("greedy", h.send("g100"))).toBe("dropped");
    const other = pool.run("polite", h.send("p0"));
    await tick();
    // other is queued, not dropped: finish everything and it runs
    while (h.releases.size > 0) {
      for (const [name, release] of [...h.releases]) {
        h.releases.delete(name);
        release();
      }
      await tick();
    }
    expect(await other).toBe("done");
    expect(h.started).toContain("p0");
    expect(h.started).not.toContain("g100");
  });

  it("a freed slot lets the same recipient queue again", async () => {
    const h = harness();
    const pool = createSendPool({ concurrency: 1, maxQueued: 10, maxQueuedPerRecipient: 1 });
    void pool.run("a", h.send("running"));
    void pool.run("a", h.send("q1"));
    expect(await pool.run("a", h.send("q2"))).toBe("dropped");
    h.releases.get("running")!();
    await tick();
    expect(h.started).toEqual(["running", "q1"]);
    void pool.run("a", h.send("q3"));
    await tick();
    h.releases.get("q1")!();
    await tick();
    expect(h.started).toEqual(["running", "q1", "q3"]);
  });

  it("never rejects: a send that throws or rejects frees its slot and answers done", async () => {
    const pool = createSendPool({ concurrency: 1, maxQueued: 5, maxQueuedPerRecipient: 5 });
    const a = pool.run("a", () => Promise.reject(new Error("x")));
    const b = pool.run("a", () => {
      throw new Error("sync");
    });
    const ran: string[] = [];
    const c = pool.run("a", async () => {
      ran.push("c");
    });
    expect(await Promise.all([a, b, c])).toEqual(["done", "done", "done"]);
    expect(ran).toEqual(["c"]);
  });
});
