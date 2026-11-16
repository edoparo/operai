/**
 * The 503 of the isolated PDF checks (`pdf_check_busy`, `pdf_check_unavailable`; ADR 20261115-uploaded-pdf-decoded-size-bound-before-parse)
 * is documented on every route that can answer it, and only there: the generic "authorization service" line stays accurate elsewhere.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { call, resetWorld } from "../test-support/world";

beforeEach(resetWorld);

const CHECKING: ReadonlyArray<readonly [string, string]> = [
  ["post", "/entity-profiles/{entity}/letterhead/confirm"],
  ["get", "/entity-profiles/{entity}/letterhead"],
  ["post", "/deals/{id}/attachments/{aid}/confirm"],
  ["post", "/deals/{id}/offers"],
  ["put", "/deals/{id}/offers/{offerId}"],
  ["post", "/deals/{id}/offer-draft/generate"],
];

type Doc = { paths: Record<string, Record<string, { responses: Record<string, { description?: string }> }>> };

describe("OpenAPI 503", () => {
  it("names both PDF-check codes on every route that runs the check", async () => {
    const doc = (await call("GET", "/openapi.json", { as: null })).json as Doc;
    for (const [method, path] of CHECKING) {
      const description = doc.paths[path]?.[method]?.responses["503"]?.description ?? "";
      expect(description, `${method} ${path}`).toContain("pdf_check_busy");
      expect(description, `${method} ${path}`).toContain("pdf_check_unavailable");
      expect(description, `${method} ${path}`).toContain("authorization service");
    }
  });

  it("keeps the authorization-only line on a route that never runs the check", async () => {
    const doc = (await call("GET", "/openapi.json", { as: null })).json as Doc;
    const description = doc.paths["/deals/{id}/offers"]?.["get"]?.responses["503"]?.description ?? "";
    expect(description).toBe("The authorization service is unavailable");
  });
});
