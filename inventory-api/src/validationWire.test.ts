/**
 * The wire shape of a failed schema parse over the ASSEMBLED app, pinned across the zod 4 /
 * @hono/zod-openapi 1.x migration (GHSA-mrhx-c7xc-m3w5): a body or query that fails its
 * schema is a 422 Problem whose top-level `field` names the first offending member and whose
 * `errors` lists every one (`validationHook`, src/lib/problem.ts); the TEXT of each message is
 * zod's and may change with the library, so only the structure is asserted. A JSON body sent
 * without a JSON Content-Type is refused by the library's media-type gate as a 415 Problem
 * before validation (it was a 422 on zod 3), and writes nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupTestAuth } from "./test-support/testAuth";
import { truncateInventoryTables } from "./test-support/dbCleanup";

const harness = setupTestAuth();
await harness.init();

const { app } = await import("./index");
const { db } = await import("./lib/db");
const { __resetAuthzCacheForTests } = await import("./auth/authz.middleware");

let token: string;

beforeAll(async () => {
  await truncateInventoryTables();
  token = await harness.signToken({ sub: "u-1", email: "u1@welld.ch", permEpoch: 1 });
  __resetAuthzCacheForTests();
  harness.setResolve(async () => ({
    sub: "u-1",
    epoch: 1,
    permissions: [
      { resource: "inventory", action: "access", conditions: null },
      { resource: "asset", action: "manage", conditions: null },
      { resource: "ledger", action: "manage", conditions: null },
    ],
    entity: "welld_ch",
    jobTitle: null,
  }));
});
afterAll(async () => {
  await truncateInventoryTables();
});

const send = (method: string, path: string, body?: string, contentType = "application/json") =>
  app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(contentType ? { "Content-Type": contentType } : {}) },
    ...(body !== undefined ? { body } : {}),
  });

interface ValidationProblem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  field: string;
  errors: { field: string; message: string }[];
}

const valid = {
  entity: "welld_ch",
  category: "laptop",
  description: "x",
  purchaseDate: "2024-01-31",
  totalPriceCents: 1000,
};

describe("a failed schema parse is a 422 Problem with field and errors", () => {
  it("POST /assets {} -> 422, every missing member listed in schema order", async () => {
    const res = await send("POST", "/assets", "{}");
    expect(res.status).toBe(422);
    const body = (await res.json()) as ValidationProblem;
    expect(Object.keys(body).sort()).toEqual(
      ["detail", "errors", "field", "instance", "status", "title", "type"].sort(),
    );
    expect(body).toMatchObject({
      type: "https://httpstatuses.com/422",
      title: "Unprocessable Entity",
      status: 422,
      instance: "/assets",
      field: "entity",
    });
    expect(body.errors.map((e) => e.field)).toEqual([
      "entity",
      "category",
      "description",
      "purchaseDate",
      "totalPriceCents",
    ]);
    expect(body.errors.every((e) => typeof e.message === "string" && e.message.length > 0)).toBe(true);
    expect(body.detail).toBe(`entity: ${body.errors[0]!.message}`);
  });

  it("a non-integer money amount names totalPriceCents (cents are integers)", async () => {
    const res = await send("POST", "/assets", JSON.stringify({ ...valid, totalPriceCents: 10.5 }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as ValidationProblem).field).toBe("totalPriceCents");
  });

  it("an impossible calendar date names purchaseDate", async () => {
    const res = await send("POST", "/assets", JSON.stringify({ ...valid, purchaseDate: "2024-02-30" }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as ValidationProblem).field).toBe("purchaseDate");
  });

  it("PATCH with an unknown key names that key, and an immutable one says so (strict object)", async () => {
    const res = await send("PATCH", "/assets/a1", JSON.stringify({ entity: "welld_it", bogus: 1 }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as ValidationProblem;
    expect(body.errors).toEqual([
      { field: "entity", message: "is immutable" },
      { field: "bogus", message: "is not an editable field" },
      // The refinement still runs over the (now empty) known fields, as it did on zod 3.
      { field: "", message: "at least one field is required" },
    ]);
    expect(body.field).toBe("entity");
  });

  it("a bad query value names the parameter; a path year that is not four digits names year", async () => {
    const list = await send("GET", "/assets?limit=0", undefined, "");
    expect(list.status).toBe(422);
    expect(((await list.json()) as ValidationProblem).field).toBe("limit");

    const year = await send("GET", "/fiscal-years/welld_ch/20x5", undefined, "");
    expect(year.status).toBe(422);
    expect(((await year.json()) as ValidationProblem).field).toBe("year");
  });
});

describe("a JSON body without a JSON Content-Type is a 415 Problem before validation", () => {
  it("text/plain body on POST /assets -> 415, nothing written", async () => {
    const res = await send("POST", "/assets", JSON.stringify(valid), "text/plain");
    expect(res.status).toBe(415);
    expect(res.headers.get("content-type")).toContain("json");
    expect(await res.json()).toMatchObject({ status: 415, title: "Unsupported Media Type", instance: "/assets" });
    expect(await db.asset.count()).toBe(0);
  });

  it("a body with no Content-Type at all -> 415 as well", async () => {
    const res = await send("POST", "/assets", JSON.stringify(valid), "");
    expect(res.status).toBe(415);
    expect(await db.asset.count()).toBe(0);
  });

  it("application/json with a charset is still JSON (the UI's fetch may add one)", async () => {
    const res = await send("POST", "/assets", "{}", "application/json; charset=utf-8");
    expect(res.status).toBe(422);
  });
});
