/**
 * AC-5.1 / ADR 20260716-refund-api-authorization-enforcing-resource-server: an `auth` outage on /authz/resolve is a 503, never an allow.
 * Added by QE (specs/20261101-crm). The resolve fixture is restored in `finally`
 * because the test harness is shared by every file in the process.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { setupTestAuth } from "./test-support/testAuth";
import { PERSONAS, call, resetWorld } from "./test-support/world";

beforeEach(resetWorld);

const subOf = (header: string): string =>
  (JSON.parse(Buffer.from(header.split(".")[1] ?? "", "base64url").toString("utf-8")) as { sub: string }).sub;

describe("auth outage (AC-5.1)", () => {
  it("fails closed with 503 on a gated read and a write when /authz/resolve is down", async () => {
    const harness = setupTestAuth();
    try {
      harness.setResolve(async () => {
        throw new Error("auth down");
      });
      expect((await call("GET", "/companies", { as: "admin" })).status).toBe(503);
      expect((await call("POST", "/companies", { as: "admin", body: { name: "X", status: "prospect", entity: "welld_ch" } })).status).toBe(503);
    } finally {
      harness.setResolve(async (header) => {
        const sub = subOf(header);
        const persona = Object.values(PERSONAS).find((p) => p.sub === sub)!;
        return { sub, epoch: 0, permissions: persona.permissions, entity: persona.entity, jobTitle: null };
      });
    }
    expect((await call("GET", "/companies", { as: "admin" })).status).toBe(200);
  });
});
