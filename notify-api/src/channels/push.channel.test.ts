/**
 * Push channel (T6, specs/029-push-notifications, ADR-0084). The repository, the
 * recipient lookup and the sender are injected; the encryption test wires the REAL
 * sender to a fake HTTP transport and decrypts what would have gone on the wire.
 */

import { describe, it, expect } from "bun:test";
import * as webpush from "web-push";
import type { PushDeviceRow } from "@/push/devices.repo";
import type { PushSender, PushTarget, PushTransportRequest } from "@/push/webPushSender";
import { createWebPushSender } from "@/push/webPushSender";
import { createTestSubscriber, type TestSubscriber } from "@/push/webPush.testutil";
import type { ContactLookupResult } from "@/lib/userContact";
import type { NotificationDto } from "@/notifications/notifications.schemas";
import { MAX_PUSH_PAYLOAD_BYTES, buildPushPayload, createPushChannel, type PushChannelDeps } from "./push.channel";

const USER = "user-1";
const ENDPOINT_A = "https://fcm.googleapis.com/fcm/send/secret-endpoint-a";
const ENDPOINT_B = "https://web.push.apple.com/secret-endpoint-b";

const notification = (over: Partial<NotificationDto> = {}): NotificationDto => ({
  id: "ckn0tification00000000001",
  title: "Rimborso approvato",
  body: "La tua richiesta è stata approvata.",
  severity: "success",
  originApp: "refund",
  link: { href: "/refund/requests/req_1", label: "Apri" },
  it: { title: "Rimborso approvato (it)", body: "Corpo italiano" },
  toastWorthy: false,
  readAt: null,
  createdAt: new Date().toISOString(),
  ...over,
});

const row = (id: string, endpoint: string, sub: TestSubscriber): PushDeviceRow => ({
  id,
  userId: USER,
  endpoint,
  p256dh: sub.p256dh,
  auth: sub.auth,
  label: "Chrome · macOS",
  createdAt: new Date(),
  updatedAt: new Date(),
});

type Harness = {
  deps: PushChannelDeps;
  sent: { target: PushTarget; payload: string }[];
  deleted: string[];
  deletedAll: string[];
  lookups: string[];
  listed: string[];
  logs: string[];
};

const harness = (
  over: {
    devices?: PushDeviceRow[];
    contact?: ContactLookupResult | "null";
    respond?: (target: PushTarget) => Promise<{ status: number }>;
    enabled?: boolean;
    excluded?: string[];
    sender?: PushSender | null;
    listFails?: boolean;
  } = {},
): Harness => {
  const h: Harness = { sent: [], deleted: [], deletedAll: [], lookups: [], listed: [], logs: [], deps: undefined! };
  const respond = over.respond ?? (async () => ({ status: 201 }));
  h.deps = {
    enabled: over.enabled ?? true,
    excludedOrigins: over.excluded ?? [],
    devices: {
      listByUser: async (u) => {
        h.listed.push(u);
        if (over.listFails) throw new Error(`db down for ${ENDPOINT_A}`);
        return over.devices ?? [];
      },
      deleteAllForUser: async (u) => {
        h.deletedAll.push(u);
      },
      deleteById: async (id) => {
        h.deleted.push(id);
      },
    },
    contacts:
      over.contact === "null"
        ? null
        : {
            lookup: async (u) => {
              h.lookups.push(u);
              return over.contact === undefined || over.contact === "null"
                ? { status: "found", email: "a@b.c", name: "A" }
                : over.contact;
            },
          },
    sender:
      over.sender !== undefined
        ? over.sender
        : {
            send: async (target, payload) => {
              h.sent.push({ target, payload });
              return respond(target);
            },
          },
    log: (m) => h.logs.push(m),
  };
  return h;
};

describe("pushChannel.dispatch — gating", () => {
  it("does nothing at all when push is disabled (AC-6.1)", async () => {
    const sub = createTestSubscriber();
    const h = harness({ enabled: false, devices: [row("d1", ENDPOINT_A, sub)] });
    await createPushChannel(h.deps).dispatch(USER, notification());
    expect(h.listed).toEqual([]);
    expect(h.lookups).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it("does nothing when the sender is not configured", async () => {
    const sub = createTestSubscriber();
    const h = harness({ sender: null, devices: [row("d1", ENDPOINT_A, sub)] });
    await createPushChannel(h.deps).dispatch(USER, notification());
    expect(h.listed).toEqual([]);
  });

  it("skips an excluded origin and pushes any other (AC-6.4)", async () => {
    const sub = createTestSubscriber();
    const h = harness({ excluded: ["meetings"], devices: [row("d1", ENDPOINT_A, sub)] });
    const ch = createPushChannel(h.deps);
    await ch.dispatch(USER, notification({ originApp: "meetings" }));
    expect(h.sent).toHaveLength(0);
    expect(h.listed).toEqual([]);
    await ch.dispatch(USER, notification({ originApp: "crm" }));
    expect(h.sent).toHaveLength(1);
  });

  it("a recipient with no device is never looked up in auth", async () => {
    const h = harness({ devices: [] });
    await createPushChannel(h.deps).dispatch(USER, notification());
    expect(h.lookups).toEqual([]);
    expect(h.sent).toEqual([]);
  });
});

describe("pushChannel.dispatch — recipient activity (AC-5.2)", () => {
  it("inactive: sends nothing and deletes every device of the user", async () => {
    const sub = createTestSubscriber();
    const h = harness({ contact: { status: "inactive" }, devices: [row("d1", ENDPOINT_A, sub)] });
    await createPushChannel(h.deps).dispatch(USER, notification());
    expect(h.sent).toEqual([]);
    expect(h.deletedAll).toEqual([USER]);
  });

  it("lookup failed: fails closed (no send) and keeps the devices", async () => {
    const sub = createTestSubscriber();
    const h = harness({ contact: { status: "failed" }, devices: [row("d1", ENDPOINT_A, sub)] });
    await createPushChannel(h.deps).dispatch(USER, notification());
    expect(h.sent).toEqual([]);
    expect(h.deletedAll).toEqual([]);
    expect(h.deleted).toEqual([]);
  });

  it("no lookup client configured: fails closed", async () => {
    const sub = createTestSubscriber();
    const h = harness({ contact: "null", devices: [row("d1", ENDPOINT_A, sub)] });
    await createPushChannel(h.deps).dispatch(USER, notification());
    expect(h.sent).toEqual([]);
    expect(h.deletedAll).toEqual([]);
  });
});

describe("pushChannel.dispatch — sending", () => {
  it("one send per device, each with the English payload and the device's own keys (AC-2.1, 2.4, 2.5)", async () => {
    const a = createTestSubscriber();
    const b = createTestSubscriber();
    const h = harness({ devices: [row("d1", ENDPOINT_A, a), row("d2", ENDPOINT_B, b)] });
    await createPushChannel(h.deps).dispatch(USER, notification());
    expect(h.sent.map((s) => s.target.endpoint).sort()).toEqual([ENDPOINT_A, ENDPOINT_B].sort());
    const toA = h.sent.find((s) => s.target.endpoint === ENDPOINT_A)!;
    expect(toA.target).toEqual({ endpoint: ENDPOINT_A, p256dh: a.p256dh, auth: a.auth });
    const parsed = JSON.parse(toA.payload);
    expect(parsed.title).toBe("Rimborso approvato");
    expect(parsed.body).toBe("La tua richiesta è stata approvata.");
  });

  it("payload keys are exactly v,id,title,body,originApp,href (AC-6.2); href omitted without a link", async () => {
    const sub = createTestSubscriber();
    const h = harness({ devices: [row("d1", ENDPOINT_A, sub)] });
    const ch = createPushChannel(h.deps);
    await ch.dispatch(USER, notification());
    await ch.dispatch(USER, notification({ link: undefined }));
    const [withLink, without] = h.sent.map((s) => JSON.parse(s.payload));
    expect(Object.keys(withLink).sort()).toEqual(["body", "href", "id", "originApp", "title", "v"]);
    expect(withLink).toMatchObject({ v: 1, id: "ckn0tification00000000001", originApp: "refund", href: "/refund/requests/req_1" });
    expect(Object.keys(without).sort()).toEqual(["body", "id", "originApp", "title", "v"]);
  });

  it("a toast-worthy and a non-toast notification are both dispatched (AC-2.2)", async () => {
    const sub = createTestSubscriber();
    const h = harness({ devices: [row("d1", ENDPOINT_A, sub)] });
    const ch = createPushChannel(h.deps);
    await ch.dispatch(USER, notification({ toastWorthy: true }));
    await ch.dispatch(USER, notification({ toastWorthy: false }));
    expect(h.sent).toHaveLength(2);
  });

  it("404 and 410 prune exactly that device; 500 and a thrown error keep it (AC-2.6, 2.7)", async () => {
    const subs = [1, 2, 3, 4, 5].map(() => createTestSubscriber());
    const endpoints = subs.map((_, i) => `https://fcm.googleapis.com/fcm/send/e${i}`);
    const statusBy = new Map<string, number | "throw">([
      [endpoints[0]!, 404],
      [endpoints[1]!, 410],
      [endpoints[2]!, 500],
      [endpoints[3]!, "throw"],
      [endpoints[4]!, 201],
    ]);
    const h = harness({
      devices: subs.map((s, i) => row(`d${i}`, endpoints[i]!, s)),
      respond: async (t) => {
        const v = statusBy.get(t.endpoint)!;
        if (v === "throw") throw new Error(`socket hang up ${t.endpoint}`);
        return { status: v };
      },
    });
    await createPushChannel(h.deps).dispatch(USER, notification());
    expect(h.sent).toHaveLength(5); // a failing device never stops the others
    expect(h.deleted.sort()).toEqual(["d0", "d1"]);
  });

  it("201 from Apple for a dead subscription is not a prune signal (only 404/410 are)", async () => {
    const sub = createTestSubscriber();
    const h = harness({ devices: [row("d1", ENDPOINT_B, sub)] });
    await createPushChannel(h.deps).dispatch(USER, notification());
    expect(h.deleted).toEqual([]);
  });

  it("logs contain no endpoint, key or notification text, only device id and status / error class", async () => {
    const a = createTestSubscriber();
    const b = createTestSubscriber();
    const h = harness({
      devices: [row("dev-500", ENDPOINT_A, a), row("dev-throw", ENDPOINT_B, b)],
      respond: async (t) => {
        if (t.endpoint === ENDPOINT_B) throw new Error(`failed for ${t.endpoint} ${t.p256dh}`);
        return { status: 500 };
      },
    });
    await createPushChannel(h.deps).dispatch(USER, notification({ title: "SECRET-TITLE", body: "SECRET-BODY" }));
    expect(h.logs.length).toBeGreaterThan(0);
    const all = h.logs.join("\n");
    expect(all).toContain("dev-500");
    expect(all).toContain("500");
    for (const forbidden of [ENDPOINT_A, ENDPOINT_B, "secret-endpoint", a.p256dh, a.auth, b.p256dh, b.auth, "SECRET-TITLE", "SECRET-BODY", USER]) {
      expect(all).not.toContain(forbidden);
    }
  });

  it("never throws: a repository failure is logged by class and swallowed (AC-2.6)", async () => {
    const h = harness({ listFails: true });
    await createPushChannel(h.deps).dispatch(USER, notification());
    expect(h.logs.join("\n")).not.toContain(ENDPOINT_A);
    expect(h.logs.length).toBe(1);
  });

  it("a failed prune is logged and does not stop the other devices", async () => {
    const a = createTestSubscriber();
    const b = createTestSubscriber();
    const h = harness({
      devices: [row("d1", ENDPOINT_A, a), row("d2", ENDPOINT_B, b)],
      respond: async (t) => ({ status: t.endpoint === ENDPOINT_A ? 410 : 201 }),
    });
    h.deps.devices.deleteById = async () => {
      throw new Error("db");
    };
    await createPushChannel(h.deps).dispatch(USER, notification());
    expect(h.sent).toHaveLength(2);
  });
});

describe("pushChannel with the real sender (AC-2.1, 6.3)", () => {
  it("what reaches the HTTP layer is an aes128gcm record that decrypts to the English payload, with no plaintext on the wire", async () => {
    const vapid = webpush.generateVAPIDKeys();
    const sub = createTestSubscriber();
    const wire: PushTransportRequest[] = [];
    const sender = createWebPushSender({
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
      subject: "mailto:ops@example.com",
      transport: async (req) => {
        wire.push(req);
        return { status: 201 };
      },
    });
    const h = harness({ devices: [row("d1", ENDPOINT_A, sub)], sender });
    await createPushChannel(h.deps).dispatch(USER, notification({ title: "Titolo riservato 4711" }));

    expect(wire).toHaveLength(1);
    const req = wire[0]!;
    expect(req.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(Buffer.from(req.body).includes(Buffer.from("Titolo riservato 4711"))).toBe(false);
    expect(Buffer.from(req.body).includes(Buffer.from("refund"))).toBe(false);
    const decrypted = JSON.parse(sub.decrypt(req.body));
    expect(decrypted.title).toBe("Titolo riservato 4711");
    expect(Object.keys(decrypted).sort()).toEqual(["body", "href", "id", "originApp", "title", "v"]);
  });
});

describe("buildPushPayload — the 3 000-byte budget (R4)", () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;

  it("leaves a short notification untouched", () => {
    const n = notification();
    const parsed = JSON.parse(buildPushPayload(n));
    expect(parsed.body).toBe(n.body);
  });

  it("truncates a long multi-byte body with an ellipsis so the JSON fits, as valid JSON", () => {
    // 3- and 4-byte characters (2000 ASCII chars already fit the budget)
    for (const unit of ["€", "😀"]) {
      const json = buildPushPayload(notification({ body: unit.repeat(2000) }));
      expect(bytes(json)).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
      const parsed = JSON.parse(json);
      expect(parsed.body.endsWith("…")).toBe(true);
      expect(parsed.body.length).toBeGreaterThan(100);
      expect(parsed.body).not.toContain("�");
      expect(parsed.title).toBe("Rimborso approvato");
    }
  });

  it("a link that alone exceeds the budget is dropped (a click then opens /notify); the text is kept", () => {
    const json = buildPushPayload(notification({ body: "short body", link: { href: `/${"é".repeat(1999)}` } }));
    expect(bytes(json)).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    const parsed = JSON.parse(json);
    expect(parsed.href).toBeUndefined();
    expect(parsed.title).toBe("Rimborso approvato");
    expect(parsed.body).toBe("short body");
  });

  it("with the longest title (800 bytes) and a long link, the body gives way first", () => {
    const json = buildPushPayload(
      notification({ title: "😀".repeat(200), body: "€".repeat(2000), link: { href: `/${"a".repeat(1999)}` } }),
    );
    expect(bytes(json)).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    const parsed = JSON.parse(json);
    expect(parsed.title).toBe("😀".repeat(200));
    expect(parsed.href).toBe(`/${"a".repeat(1999)}`);
    expect(parsed.body.endsWith("…")).toBe(true);
  });

  it("an escape-heavy body (quotes, control characters) is measured after JSON escaping", () => {
    const json = buildPushPayload(notification({ body: '"\n\\'.repeat(700) }));
    expect(bytes(json)).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});
