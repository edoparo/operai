/**
 * The calls to `auth` forward the caller's Bearer, so none may follow a redirect (OWASP review
 * L1): a redirect would replay the token to another host. Both calls are driven through the
 * assembled app and the recorded `redirect` mode of each is checked.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { authStub, call, makeCompany, resetWorld } from "../test-support/world";

beforeEach(resetWorld);

describe("auth calls with the caller's Bearer", () => {
  it("resolving identities (listing names) refuses redirects", async () => {
    const co = makeCompany();
    // The view names the author, so the identities lookup runs (the cache is empty after the reset).
    const created = await call("POST", "/activities", { body: { type: "note", subject: "S", companyId: co.id } });
    expect(created.status).toBe(201);
    expect(authStub.identityCalls).toBeGreaterThan(0);
    expect(authStub.redirects.length).toBeGreaterThan(0);
    expect(authStub.redirects.every((mode) => mode === "error")).toBe(true);
  });

  it("the app-access check (participants) refuses redirects", async () => {
    const co = makeCompany();
    const res = await call("POST", "/activities", { body: { type: "note", subject: "S", companyId: co.id, participantIds: ["user-bob"] } });
    expect(res.status).toBe(201);
    expect(authStub.accessChecks.length).toBe(1);
    expect(authStub.redirects.length).toBeGreaterThan(0);
    expect(authStub.redirects.every((mode) => mode === "error")).toBe(true);
  });
});
