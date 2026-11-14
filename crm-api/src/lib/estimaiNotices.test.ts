import { describe, expect, it, spyOn } from "bun:test";
import { createDealLinkNoticeClient, type DealLinkNotice } from "./estimaiNotices";
import type { ServiceTokenProvider } from "./serviceToken";

const notice: DealLinkNotice = { estimateId: "est-1", dealId: "deal-1", event: "linked", at: "2026-11-09T10:00:00.000Z" };

function tokens() {
  let n = 0;
  const invalidated: string[] = [];
  const provider: ServiceTokenProvider = {
    async getToken() {
      return `tok-${++n}`;
    },
    invalidate: (t) => void invalidated.push(t),
  };
  return { provider, invalidated };
}

describe("deal-link notice client (specs/20261108-estimate-list-oversight AC-3.4/3.5/3.8)", () => {
  it("posts exactly the four contract fields with the service token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const send = createDealLinkNoticeClient({
      baseUrl: "http://estimai.internal/",
      tokens: tokens().provider,
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch,
    });
    expect(await send({ ...notice, extra: "x" } as DealLinkNotice)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://estimai.internal/system/deal-link-notices");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(notice);
  });

  it("is a no-op without a URL or credentials", async () => {
    let hit = 0;
    const fetchImpl = (async () => (hit++, new Response(null, { status: 204 }))) as unknown as typeof fetch;
    expect(await createDealLinkNoticeClient({ baseUrl: undefined, tokens: tokens().provider, fetchImpl })(notice)).toBe(false);
    expect(await createDealLinkNoticeClient({ baseUrl: "http://x", tokens: null, fetchImpl })(notice)).toBe(false);
    expect(hit).toBe(0);
  });

  it("retries once on a 401 with a fresh token, then gives up without throwing", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const t = tokens();
    const seen: string[] = [];
    const send = createDealLinkNoticeClient({
      baseUrl: "http://x",
      tokens: t.provider,
      fetchImpl: (async (_u: string, init: RequestInit) => {
        seen.push((init.headers as Record<string, string>).Authorization!);
        return new Response(null, { status: 401 });
      }) as unknown as typeof fetch,
    });
    expect(await send(notice)).toBe(false);
    expect(seen).toEqual(["Bearer tok-1", "Bearer tok-2"]);
    expect(t.invalidated).toEqual(["tok-1"]);
    spy.mockRestore();
  });

  it("a 401 then a 2xx succeeds", async () => {
    let n = 0;
    const send = createDealLinkNoticeClient({
      baseUrl: "http://x",
      tokens: tokens().provider,
      fetchImpl: (async () => new Response(null, { status: n++ === 0 ? 401 : 204 })) as unknown as typeof fetch,
    });
    expect(await send(notice)).toBe(true);
  });

  it("swallows a 500 and a network error, logging ids and status only", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const server = createDealLinkNoticeClient({
      baseUrl: "http://x",
      tokens: tokens().provider,
      fetchImpl: (async () => new Response(null, { status: 500 })) as unknown as typeof fetch,
    });
    expect(await server(notice)).toBe(false);
    const network = createDealLinkNoticeClient({
      baseUrl: "http://x",
      tokens: tokens().provider,
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect(await network(notice)).toBe(false);
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("HTTP 500");
    expect(logged).toContain("est-1");
    expect(logged).not.toContain("tok-");
    spy.mockRestore();
  });

  it("a token that cannot be obtained is swallowed", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const send = createDealLinkNoticeClient({
      baseUrl: "http://x",
      tokens: { getToken: async () => { throw new Error("auth down"); }, invalidate() {} },
    });
    expect(await send(notice)).toBe(false);
    spy.mockRestore();
  });
});
