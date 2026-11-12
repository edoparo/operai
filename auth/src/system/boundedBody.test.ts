import { describe, expect, test } from "bun:test";
import { readBodyCapped, readJsonBody } from "./boundedBody";

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

describe("readJsonBody", () => {
  const json = (body: string, type: string | null = "application/json") =>
    readJsonBody(new Request("http://x.test/", { method: "POST", body, headers: type ? { "Content-Type": type } : {} }));

  test("parses a JSON body", async () => {
    expect(await json('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(await json('{"a":1}', "application/problem+json; charset=utf-8")).toEqual({ ok: true, value: { a: 1 } });
  });

  test("a body that does not say it is JSON yields no value (a schema then refuses it)", async () => {
    expect(await json('{"a":1}', "text/plain")).toEqual({ ok: true, value: undefined });
    expect(await json('{"a":1}', null)).toEqual({ ok: true, value: undefined });
  });

  test("malformed and oversized bodies are failures that never echo the input", async () => {
    expect(await json("{nope")).toEqual({ ok: false, detail: "body: malformed JSON" });
    expect(await json(JSON.stringify({ pad: "p".repeat(5000) }))).toEqual({ ok: false, detail: "body: too large" });
  });
});
