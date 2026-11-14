/**
 * POST /system/notifications with `email: true` (specs/20261101-crm-notifications,
 * ADR 20261101-notify-api-resolves-email-notice-address-from-auth): the `crm` origin binding, the second-scope gate (403 before any
 * row), and the `emailStatus` outcomes. The address lookup and the email
 * channel are injected stubs; the notification row is the real thing (compose
 * Postgres, same setup as notifications.routes.test.ts).
 */

import { describe, it, expect, afterEach, mock } from "bun:test";
import { Hono } from "hono";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import { env } from "@/lib/env";
import { createSystemAuthMiddleware } from "./systemAuth.middleware";

const SERVICE_AUD = "operai-system-notifications-email-test";
const KID = "notifications-email-kid";
const keyPair = await generateKeyPair("RS256");
const localJwks = createLocalJWKSet({
  keys: [{ ...(await exportJWK(keyPair.publicKey)), kid: KID, alg: "RS256", use: "sig" }],
});
const token = (scope: string, sub = "system:crm-api") =>
  new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(env.AUTH_ISSUER)
    .setAudience(SERVICE_AUD)
    .setSubject(sub)
    .setExpirationTime("5m")
    .sign(keyPair.privateKey);

import { config as dotenvConfig } from "dotenv";
dotenvConfig({
  path: new URL("../../.env", import.meta.url).pathname,
  override: true,
});

const { PrismaClient } = await import("@/lib/generated/prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const testDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env["DATABASE_URL"]! }),
});
mock.module("@/lib/db", () => ({ db: testDb }));

const { createSystemNotificationsRouter } = await import("./notifications.routes");
type Deps = NonNullable<Parameters<typeof createSystemNotificationsRouter>[1]>;
type Lookup = Awaited<ReturnType<NonNullable<Deps["contacts"]>["lookup"]>>;

const RECIPIENT_ID = "email-notice-test-recipient";
const APP_BASE_URL = "https://operai.example.test";

const sent: { to: string; template: string; subject: string; html: string }[] = [];
let lookups: string[] = [];
let channelResult: { status: "sent" } | { status: "failed"; error: string } = { status: "sent" };

const buildApp = (lookup: Lookup | null, overrides: Partial<Deps> = {}) => {
  const deps: Deps = {
    contacts:
      lookup === null
        ? null
        : {
            lookup: async (id) => {
              lookups.push(id);
              return lookup;
            },
          },
    appBaseUrl: APP_BASE_URL,
    channel: {
      send: async (input) => {
        sent.push(input);
        return channelResult.status === "sent"
          ? { deliveryId: "d1", status: "sent" }
          : { deliveryId: "d1", status: "failed", error: channelResult.error };
      },
    },
    ...overrides,
  };
  const app = new Hono();
  app.route(
    "/",
    createSystemNotificationsRouter(
      createSystemAuthMiddleware({ scope: "notifications.push", jwks: localJwks, audience: SERVICE_AUD }),
      deps,
    ),
  );
  return app;
};

const post = async (app: Hono, scope: string, body: Record<string, unknown>, sub?: string) =>
  app.request("/system/notifications", {
    method: "POST",
    headers: { Authorization: `Bearer ${await token(scope, sub)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const validBody = (overrides: Record<string, unknown> = {}) => ({
  recipientId: RECIPIENT_ID,
  originApp: "crm",
  severity: "info",
  title: "Estimate requested",
  body: "Acme asked for an estimate.",
  link: { href: "/crm/deals/d_1" },
  email: true,
  ...overrides,
});

const BOTH = "notifications.push emails.send";
const rowCount = () => testDb.notification.count({ where: { recipientId: RECIPIENT_ID } });
const statusOf = async (res: Response) => ((await res.json()) as { emailStatus?: string }).emailStatus;

afterEach(async () => {
  sent.length = 0;
  lookups = [];
  channelResult = { status: "sent" };
  await testDb.notification.deleteMany({ where: { recipientId: RECIPIENT_ID } });
});

describe("crm origin", () => {
  it("system:crm-api may raise a crm notification; with no email asked there is no emailStatus", async () => {
    const res = await post(buildApp({ status: "inactive" }), "notifications.push", validBody({ email: undefined }));
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created["originApp"]).toBe("crm");
    expect("emailStatus" in created).toBe(false);
    expect(lookups).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("system:crm-api may not raise another tool's origin (403)", async () => {
    const res = await post(buildApp({ status: "inactive" }), BOTH, validBody({ originApp: "refund" }));
    expect(res.status).toBe(403);
    expect(await rowCount()).toBe(0);
  });

  it("another service may not raise crm (403)", async () => {
    const res = await post(buildApp({ status: "inactive" }), BOTH, validBody(), "system:inventory-api");
    expect(res.status).toBe(403);
    expect(await rowCount()).toBe(0);
  });
});

describe("projects origin (specs/20261110-activities T24)", () => {
  it("system:activities-api with both scopes: 201, emailStatus, footer 'Sent by Operai Projects'", async () => {
    const res = await post(
      buildApp({ status: "found", email: "a@b.test", name: "A" }),
      BOTH,
      validBody({ originApp: "projects", link: { href: "/projects/p_1" } }),
      "system:activities-api",
    );
    expect(res.status).toBe(201);
    expect(await statusOf(res)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.html).toContain("Sent by Operai Projects");
    expect(sent[0]?.html).toContain(`href="${APP_BASE_URL}/projects/p_1"`);
  });

  it("system:crm-api may not raise projects (403): no row, no lookup, no mail", async () => {
    const res = await post(buildApp({ status: "inactive" }), BOTH, validBody({ originApp: "projects" }));
    expect(res.status).toBe(403);
    expect(await rowCount()).toBe(0);
    expect(lookups).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe("email: true", () => {
  it("403 without emails.send: no row, no lookup, no mail", async () => {
    const res = await post(
      buildApp({ status: "found", email: "a@b.test", name: "A" }),
      "notifications.push",
      validBody(),
    );
    expect(res.status).toBe(403);
    expect(await rowCount()).toBe(0);
    expect(lookups).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("sent: the row is written, the address comes from the lookup, the template is notification_notice", async () => {
    const res = await post(buildApp({ status: "found", email: "a@b.test", name: "A" }), BOTH, validBody());
    expect(res.status).toBe(201);
    expect(await statusOf(res)).toBe("sent");
    expect(await rowCount()).toBe(1);
    expect(lookups).toEqual([RECIPIENT_ID]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("a@b.test");
    expect(sent[0]?.template).toBe("notification_notice");
    expect(sent[0]?.subject).toBe("Estimate requested");
    expect(sent[0]?.html).toContain(`href="${APP_BASE_URL}/crm/deals/d_1"`);
  });

  it("the address and name are never part of the response", async () => {
    const res = await post(buildApp({ status: "found", email: "a@b.test", name: "Ada" }), BOTH, validBody());
    const text = await res.text();
    expect(text).not.toContain("a@b.test");
    expect(text).not.toContain("Ada");
  });

  it("skipped when auth says the user is inactive (404): row kept, nothing sent", async () => {
    const res = await post(buildApp({ status: "inactive" }), BOTH, validBody());
    expect(res.status).toBe(201);
    expect(await statusOf(res)).toBe("skipped");
    expect(await rowCount()).toBe(1);
    expect(sent).toEqual([]);
  });

  it("failed when auth cannot be reached: still 201, row kept", async () => {
    const res = await post(buildApp({ status: "failed" }), BOTH, validBody());
    expect(res.status).toBe(201);
    expect(await statusOf(res)).toBe("failed");
    expect(await rowCount()).toBe(1);
    expect(sent).toEqual([]);
  });

  it("failed when the email channel reports a failure: still 201", async () => {
    channelResult = { status: "failed", error: "resend down" };
    const res = await post(buildApp({ status: "found", email: "a@b.test", name: "A" }), BOTH, validBody());
    expect(res.status).toBe(201);
    expect(await statusOf(res)).toBe("failed");
    expect(await rowCount()).toBe(1);
  });

  it("failed, not a 5xx, when the channel throws", async () => {
    const app = buildApp(
      { status: "found", email: "a@b.test", name: "A" },
      {
        channel: {
          send: async () => {
            throw new Error("db down");
          },
        },
      },
    );
    const res = await post(app, BOTH, validBody());
    expect(res.status).toBe(201);
    expect(await statusOf(res)).toBe("failed");
  });

  it("skipped when the email group is not configured (no lookup client)", async () => {
    const res = await post(buildApp(null), BOTH, validBody());
    expect(res.status).toBe(201);
    expect(await statusOf(res)).toBe("skipped");
    expect(await rowCount()).toBe(1);
  });

  it("skipped when APP_BASE_URL is not configured", async () => {
    const res = await post(
      buildApp({ status: "found", email: "a@b.test", name: "A" }, { appBaseUrl: undefined }),
      BOTH,
      validBody(),
    );
    expect(await statusOf(res)).toBe("skipped");
    expect(sent).toEqual([]);
  });

  it("email: false behaves like no email: no emailStatus", async () => {
    const res = await post(buildApp({ status: "inactive" }), "notifications.push", validBody({ email: false }));
    expect(res.status).toBe(201);
    expect("emailStatus" in ((await res.json()) as object)).toBe(false);
  });

  it("400 for a non-boolean email", async () => {
    const res = await post(buildApp({ status: "inactive" }), BOTH, validBody({ email: "yes" }));
    expect(res.status).toBe(400);
  });
});
