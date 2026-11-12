import { describe, expect, test } from "bun:test";
import { readBodyCapped } from "./boundedBody";

const req = (body: string | null, headers: Record<string, string> = {}) =>
  new Request("http://x.test/", { method: "POST", body, headers });

describe("readBodyCapped", () => {
  test("returns the text of a body within the cap, including an empty one", async () => {
    expect(await readBodyCapped(req('{"a":1}'))).toEqual({ ok: true, text: '{"a":1}' });
    expect(await readBodyCapped(req(null))).toEqual({ ok: true, text: "" });
    expect(await readBodyCapped(req("x".repeat(100)), 100)).toEqual({ ok: true, text: "x".repeat(100) });
  });

  test("refuses a declared length over the cap without reading", async () => {
    let pulled = false;
    const stream = new ReadableStream(
      {
        pull() {
          pulled = true;
        },
      },
      { highWaterMark: 0 }, // nothing is pulled until someone reads
    );
    const r = new Request("http://x.test/", {
      method: "POST",
      body: stream,
      headers: { "content-length": "5000" },
      duplex: "half",
    });
    expect(await readBodyCapped(r, 4096)).toEqual({ ok: false });
    expect(pulled).toBe(false);
  });

  test("an undeclared (chunked) body is cut at the first byte past the cap", async () => {
    let produced = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1024;
        controller.enqueue(new Uint8Array(1024));
        if (produced > 1_000_000) controller.close();
      },
    });
    const r = new Request("http://x.test/", {
      method: "POST",
      body: stream,
      duplex: "half",
    });
    expect(await readBodyCapped(r, 4096)).toEqual({ ok: false });
    expect(produced).toBeLessThan(64 * 1024);
  });

  test("multi-byte text decodes intact", async () => {
    expect(await readBodyCapped(req('{"n":"àèì€"}'))).toEqual({ ok: true, text: '{"n":"àèì€"}' });
  });
});
