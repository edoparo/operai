/**
 * The link.href open-redirect guard (T21, specs/20261111-push-notifications, S-M1, AC-4.1/4.2/6.2).
 * A href reaches the browser through the in-app list, the SSE stream and now a Web Push payload
 * a service worker opens, so the server refuses anything that does not stay on the suite origin
 * AFTER URL normalisation.
 */

import { describe, it, expect } from "bun:test";
import { LinkSchema, RaiseNotificationSchema, isRelativeSuitePath } from "./notifications.schemas";
import { SystemNotificationRequestSchema } from "@/system/notifications.schemas";

/** Values that normalise (or parse) to a path starting with `//`, or to another host. */
const NORMALISING_VECTORS = [
  "/..//evil.io",
  "/.//evil.io",
  "/a/..//evil.io",
  "/%2e%2e//evil.io",
  "/%2E%2E//evil.io",
  "/.%2e//evil.io",
  "/a/%2e%2e//evil.io",
  "/a/./..//evil.io",
  "/a/b/../..//evil.io",
  "/\t/evil.io",
  "/\n/evil.io",
  "/\r/evil.io",
  "/..//evil.io/phish?x=1#y",
];

/** Values the guard has always refused. */
const TEXTUAL_VECTORS = [
  "",
  "//evil.io",
  "//evil.io/phish",
  "https://evil.io/phish",
  "http://evil.io",
  "javascript:alert(1)",
  "data:text/html,x",
  "evil.io/path",
  "refund/requests/1",
  "/\\evil.io",
  "/\\/evil.io",
  "\\\\evil.io",
  " /refund",
];

/** In-suite links in use today, plus ordinary shapes that must keep working. */
const VALID = [
  "/",
  "/notify",
  "/refund/requests/req_123",
  "/refund/batches/b_1",
  "/crm/deals/d_1",
  "/estimai/estimates/abc",
  "/projects/tasks",
  "/meetings/m_1?tab=summary#top",
  "/a/../b",
  "/a/./b",
  "/a//b",
  "/a/%2e%2e/b",
  "/%C3%A8/x",
  "/refund/requests/req_1?next=%2F%2Fevil.io",
  "/refund?redirect=//evil.io",
];

describe("isRelativeSuitePath", () => {
  it.each(NORMALISING_VECTORS.map((v) => [JSON.stringify(v), v] as const))(
    "rejects the normalising vector %s",
    (_name, href) => {
      expect(isRelativeSuitePath(href)).toBe(false);
    },
  );

  it.each(TEXTUAL_VECTORS.map((v) => [JSON.stringify(v), v] as const))("still rejects %s", (_name, href) => {
    expect(isRelativeSuitePath(href)).toBe(false);
  });

  it.each(VALID.map((v) => [v, v] as const))("still accepts %s", (_name, href) => {
    expect(isRelativeSuitePath(href)).toBe(true);
  });

  it("agrees with the browser: nothing it accepts resolves off the suite origin or to a // path", () => {
    for (const href of [...VALID, ...NORMALISING_VECTORS, ...TEXTUAL_VECTORS]) {
      if (!isRelativeSuitePath(href)) continue;
      const u = new URL(href, "https://suite.example");
      expect(u.origin).toBe("https://suite.example");
      expect(u.pathname.startsWith("//")).toBe(false);
    }
  });
});

describe("both request schemas use the guard (the user route and the system route)", () => {
  const base = { title: "t", body: "b", severity: "info", originApp: "refund" };
  it.each(NORMALISING_VECTORS.map((v) => [JSON.stringify(v), v] as const))("rejects %s", (_name, href) => {
    expect(LinkSchema.safeParse({ href }).success).toBe(false);
    expect(RaiseNotificationSchema.safeParse({ ...base, link: { href } }).success).toBe(false);
    expect(
      SystemNotificationRequestSchema.safeParse({ ...base, recipientId: "u1", link: { href } }).success,
    ).toBe(false);
  });

  it("accepts a valid href on both", () => {
    const link = { href: "/refund/requests/req_1", label: "Open" };
    expect(RaiseNotificationSchema.safeParse({ ...base, link }).success).toBe(true);
    expect(SystemNotificationRequestSchema.safeParse({ ...base, recipientId: "u1", link }).success).toBe(true);
  });
});
