/**
 * Contact lookup client (specs/019-crm-notifications, ADR-0056): the 200 / 404 /
 * 401-retry / failure mapping, with auth stubbed. Nothing sensitive is logged.
 */

import { describe, it, expect, spyOn } from "bun:test";
import { createUserContactClient } from "./userContact";
import type { ServiceTokenProvider } from "./serviceToken";

const makeTokens = () => {
  let n = 0;
  const invalidated: string[] = [];
  const tokens: ServiceTokenProvider = {
    getToken: async () => `tok-${++n}`,
    invalidate: (t) => {
      invalidated.push(t);
    },
  };
  return { tokens, invalidated };
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const setup = (responses: (Response | Error)[]) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next ?? json(500, {});
  }) as unknown as typeof fetch;
  const { tokens, invalidated } = makeTokens();
  const client = createUserContactClient({ baseUrl: "https://auth.test", tokens, fetchImpl });
  return { client, calls, invalidated };
};

describe("userContact.lookup", () => {
  it("200 -> found, posting { userId } with the bearer token and no redirects", async () => {
    const { client, calls } = setup([json(200, { id: "u1", email: "a@b.test", name: "Ada" })]);
    expect(await client.lookup("u1")).toEqual({ status: "found", email: "a@b.test", name: "Ada" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://auth.test/system/users/contact");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe(JSON.stringify({ userId: "u1" }));
    expect((calls[0]?.init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-1");
    expect(calls[0]?.init.redirect).toBe("error");
  });

  it("404 -> inactive (not a failure)", async () => {
    const { client } = setup([json(404, { title: "Not Found" })]);
    expect(await client.lookup("u1")).toEqual({ status: "inactive" });
  });

  it("401 -> drops the cached token and retries once with a fresh one", async () => {
    const { client, calls, invalidated } = setup([
      json(401, {}),
      json(200, { id: "u1", email: "a@b.test", name: "Ada" }),
    ]);
    expect((await client.lookup("u1")).status).toBe("found");
    expect(invalidated).toEqual(["tok-1"]);
    expect(calls).toHaveLength(2);
    expect((calls[1]?.init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-2");
  });

  it("a second 401 is a failure, not a loop", async () => {
    const { client, calls } = setup([json(401, {}), json(401, {})]);
    expect(await client.lookup("u1")).toEqual({ status: "failed" });
    expect(calls).toHaveLength(2);
  });

  it("other statuses, an unexpected body and network errors -> failed, never thrown", async () => {
    for (const r of [json(500, {}), json(429, {}), json(200, { id: "u1" }), new Error("boom")]) {
      const { client } = setup([r]);
      expect(await client.lookup("u1")).toEqual({ status: "failed" });
    }
  });

  it("logs no address, name, token or user id", async () => {
    const err = spyOn(console, "error").mockImplementation(() => {});
    const { client } = setup([json(200, { id: "secret-user-id", email: "" })]);
    await client.lookup("secret-user-id");
    const { client: c2 } = setup([new Error("tok-1 a@b.test")]);
    await c2.lookup("secret-user-id");
    const logged = err.mock.calls.flat().join(" ");
    err.mockRestore();
    expect(logged).not.toContain("secret-user-id");
    expect(logged).not.toContain("a@b.test");
    expect(logged).not.toContain("tok-1");
  });
});
