/**
 * webPushSender (T6, specs/20261111-push-notifications): VAPID + RFC 8291 encryption over an
 * injectable HTTP transport. Nothing here reaches a real push service.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as webpush from "web-push";
import { createWebPushSender, fetchTransport, type PushTransportRequest } from "./webPushSender";
import { createTestSubscriber } from "./webPush.testutil";

const vapid = webpush.generateVAPIDKeys();
const subject = "mailto:ops@example.com";
const endpoint = "https://fcm.googleapis.com/fcm/send/abc";

const capture = (status = 201) => {
  const calls: PushTransportRequest[] = [];
  const transport = async (req: PushTransportRequest) => {
    calls.push(req);
    return { status };
  };
  return { calls, transport };
};
const build = (transport: (r: PushTransportRequest) => Promise<{ status: number }>, timeoutMs?: number) =>
  createWebPushSender({
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
    subject,
    transport,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

describe("createWebPushSender", () => {
  it("POSTs an aes128gcm record the subscriber can decrypt, and the plaintext is not on the wire", async () => {
    const sub = createTestSubscriber();
    const { calls, transport } = capture();
    const secretTitle = "Rimborso approvato XYZZY";
    const plaintext = JSON.stringify({ v: 1, title: secretTitle });

    const res = await build(transport).send({ endpoint, p256dh: sub.p256dh, auth: sub.auth }, plaintext);

    expect(res.status).toBe(201);
    expect(calls).toHaveLength(1);
    const req = calls[0]!;
    expect(req.url).toBe(endpoint);
    expect(req.method).toBe("POST");
    expect(req.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(req.headers["TTL"]).toBe("86400");
    expect(req.headers["Authorization"]).toMatch(/^vapid t=.+, k=.+$/);
    expect(req.headers["Content-Length"]).toBeUndefined();
    expect(Buffer.from(req.body).includes(Buffer.from(secretTitle))).toBe(false);
    expect(sub.decrypt(req.body)).toBe(plaintext);
  });

  it("returns the push service's status without interpreting it", async () => {
    const sub = createTestSubscriber();
    for (const status of [404, 410, 500]) {
      const { transport } = capture(status);
      const res = await build(transport).send({ endpoint, p256dh: sub.p256dh, auth: sub.auth }, "{}");
      expect(res.status).toBe(status);
    }
  });

  it("refuses an endpoint outside the allowlist before any request is made", async () => {
    const sub = createTestSubscriber();
    const { calls, transport } = capture();
    await expect(
      build(transport).send({ endpoint: "https://fcm.googleapis.com.evil.io/x", p256dh: sub.p256dh, auth: sub.auth }, "{}"),
    ).rejects.toThrow("endpoint_not_allowed");
    expect(calls).toHaveLength(0);
  });

  it("rejects on malformed subscription keys without calling the transport", async () => {
    const { calls, transport } = capture();
    await expect(build(transport).send({ endpoint, p256dh: "AAAA", auth: "AAAA" }, "{}")).rejects.toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it("propagates a transport failure (the channel logs it)", async () => {
    const sub = createTestSubscriber();
    const sender = build(async () => {
      throw new Error("boom");
    });
    await expect(sender.send({ endpoint, p256dh: sub.p256dh, auth: sub.auth }, "{}")).rejects.toThrow("boom");
  });
});

describe("fetchTransport", () => {
  const servers: ReturnType<typeof Bun.serve>[] = [];
  const serve = (handler: (req: Request) => Response | Promise<Response>) => {
    const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
    servers.push(s);
    return `http://127.0.0.1:${s.port}/`;
  };
  const req = (url: string, timeoutMs = 2000): PushTransportRequest => ({
    url,
    method: "POST",
    headers: { TTL: "86400" },
    body: new Uint8Array([1, 2, 3]),
    timeoutMs,
  });
  afterEach(() => {
    for (const s of servers.splice(0)) s.stop(true);
  });

  it("returns the status and sends the body and headers it was given", async () => {
    let seen: { ttl: string | null; len: number } | undefined;
    const url = serve(async (r) => {
      seen = { ttl: r.headers.get("ttl"), len: (await r.arrayBuffer()).byteLength };
      return new Response(null, { status: 201 });
    });
    expect((await fetchTransport(req(url))).status).toBe(201);
    expect(seen).toEqual({ ttl: "86400", len: 3 });
  });

  it("does not follow a redirect: the 3xx is the answer", async () => {
    let followed = false;
    const target = serve(() => {
      followed = true;
      return new Response(null, { status: 201 });
    });
    const url = serve(() => new Response(null, { status: 302, headers: { Location: target } }));
    expect((await fetchTransport(req(url))).status).toBe(302);
    expect(followed).toBe(false);
  });

  it("aborts a stalled push service at the timeout", async () => {
    const url = serve(() => new Promise<Response>(() => {}));
    const started = Date.now();
    await expect(fetchTransport(req(url, 150))).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
