import { beforeEach, describe, expect, it } from "bun:test";
import { call, resetWorld } from "../test-support/world";

/**
 * @hono/zod-openapi 1.x puts a media-type gate before the validator: a JSON body sent with another Content-Type
 * (or none) is a 415 Problem document, no longer the 422 of an empty body (GHSA-mrhx-c7xc-m3w5 migration). Every
 * in-repo caller (crm-ui, activities-api, meetings-api, estimai-api) sends `application/json`.
 */

beforeEach(resetWorld);

describe("a JSON body without a JSON Content-Type", () => {
  const BODY = JSON.stringify({ name: "Acme", status: "prospect", entity: "welld_ch" });

  it.each(["text/plain", "application/x-www-form-urlencoded", ""])("is a 415 Problem document (%p)", async (contentType) => {
    const res = await call("POST", "/companies", { as: "admin", rawBody: BODY, headers: { "Content-Type": contentType } });
    expect(res.status).toBe(415);
    expect(res.json).toMatchObject({ status: 415, title: "Unsupported Media Type", instance: "/companies" });
  });

  it("a charset parameter is still JSON", async () => {
    const res = await call("POST", "/companies", { as: "admin", rawBody: BODY, headers: { "Content-Type": "application/json; charset=utf-8" } });
    expect(res.status).toBe(201);
  });

  it("an invalid body keeps its 422 with field and errors", async () => {
    const res = await call("POST", "/companies", { as: "admin", body: { name: "Acme" } });
    expect(res.status).toBe(422);
    expect(res.json.field).toBe("status");
    expect(res.json.errors.map((e: { field: string }) => e.field)).toEqual(["status", "entity"]);
  });
});
