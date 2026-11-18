/**
 * The client address better-auth's rate limiter uses (clientAddress.ts): read with better-auth's OWN resolver over the
 * REAL auth options, so what is tested is what runs. A caller-written X-Forwarded-For never moves the client; Railway's
 * internal hops are skipped; a private-network request (no header) gets the internal address, never the shared
 * "no IP" bucket.
 */

import { describe, expect, test } from "bun:test";
import { getIP } from "@better-auth/core/utils/ip";
import { INTERNAL_CLIENT_ADDRESS, withInternalClientAddress } from "./clientAddress";

const { auth } = await import("./auth.config");
const ipOf = (headers: Record<string, string>) =>
  getIP(withInternalClientAddress(new Request("https://auth.example/auth/jwks", { headers })), auth.options);

describe("the client address for better-auth's rate limiter", () => {
  test("the auth options trust Railway's internal ranges and read X-Forwarded-For", () => {
    expect(auth.options.advanced?.ipAddress?.trustedProxies).toEqual(["100.64.0.0/10", "fd00::/8"]);
    expect(auth.options.advanced?.ipAddress?.ipAddressHeaders).toEqual(["x-forwarded-for"]);
  });

  test("the edge proxy's single entry is the client", () => {
    expect(ipOf({ "x-forwarded-for": "203.0.113.9" })).toBe("203.0.113.9");
  });

  test("a caller-written chain resolves to the address the proxy appended, not the forged one", () => {
    expect(ipOf({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })).toBe("203.0.113.9");
    // Forged internal-looking entries are skipped too: the proxy-appended address still wins.
    expect(ipOf({ "x-forwarded-for": "100.64.0.1, 203.0.113.9" })).toBe("203.0.113.9");
  });

  test("an internal hop after the client is skipped", () => {
    expect(ipOf({ "x-forwarded-for": "203.0.113.9, 100.64.12.7" })).toBe("203.0.113.9");
  });

  test("a private-network request (no header) gets the internal address, its own bucket", () => {
    expect(ipOf({})).toBe(INTERNAL_CLIENT_ADDRESS);
  });

  test("a request that already carries the header is passed through untouched", () => {
    const original = new Request("https://auth.example/auth/jwks", { headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(withInternalClientAddress(original)).toBe(original);
  });

  test("the body of a POST survives the internal address", async () => {
    const request = withInternalClientAddress(new Request("https://auth.example/auth/sign-out", { method: "POST", body: "{\"a\":1}" }));
    expect(await request.text()).toBe("{\"a\":1}");
    expect(request.headers.get("x-forwarded-for")).toBe(INTERNAL_CLIENT_ADDRESS);
  });
});
