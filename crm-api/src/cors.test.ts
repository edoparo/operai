import { describe, expect, it } from "bun:test";
import { app } from "./index";
import { env } from "./lib/env";

/**
 * The browser preflight must allow every request header crm-ui sends to crm-api. A header missing here fails ONLY in a
 * real browser (the in-process tests never send a preflight): creating an offer draft sends `If-None-Match: *`
 * (specs/20261115-crm-offer-wizard AC-6.3), every write `If-Match`.
 */
describe("CORS preflight", () => {
  it("allows the conditional headers crm-ui sends (If-Match, If-None-Match)", async () => {
    const origin = env.ALLOWED_ORIGINS[0] ?? "";
    const res = await app.request("/deals/x/offer-draft", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,if-match,if-none-match",
      },
    });
    expect(res.status).toBeLessThan(300);
    const allowed = (res.headers.get("Access-Control-Allow-Headers") ?? "").toLowerCase().split(/\s*,\s*/);
    for (const h of ["authorization", "content-type", "if-match", "if-none-match"]) expect(allowed).toContain(h);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  });
});
