/**
 * The command line and the service credential, shared by the perf scripts (`render-perf.ts`, `worst-case.ts`).
 *
 * Two ways to get a credential (exactly one):
 *
 *  1. DEPLOYED (T40). `--auth-url <auth base URL>` with LETTERHEAD_PERF_CLIENT_ID and LETTERHEAD_PERF_CLIENT_SECRET in
 *     the environment: the script exchanges them at `POST /system/service-token` (as crm-api's serviceToken.ts does)
 *     for a token with the scope `letterhead:render`, and renews it before it expires. The secret is read from the
 *     environment only, is never an argument and is never printed.
 *  2. LOCAL. `--local-auth`: the script serves a JWKS of a key it generates on `--jwks-port` and mints its own tokens.
 *     Start the service with AUTH_ISSUER, AUTH_JWKS_URL (pointing at this script's port) and SERVICE_AUDIENCE equal to
 *     `--issuer` and `--audience`. A fake issuer is fine: the service only checks signature, `iss`, `aud`, `scope`, `sub`.
 *     Each run makes a new key. The service fetches the key set again for an unknown `kid` at most every 30 s, so a
 *     second run within 30 s of the first is refused with 401: wait and run again.
 */
// --- arguments ---------------------------------------------------------------------------------------------

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
export function fail(message: string): never {
  console.error(`render-perf: ${message}`);
  process.exit(1);
}

// --- the credential ------------------------------------------------------------------------------------------

const b64url = (data: ArrayBuffer | Uint8Array | string): string =>
  Buffer.from(typeof data === "string" ? data : new Uint8Array(data as ArrayBuffer)).toString("base64url");

export type TokenSource = { token(): Promise<string>; stop(): void };

async function localAuth(): Promise<TokenSource> {
  const issuer = arg("issuer") ?? fail("--local-auth needs --issuer (the service's AUTH_ISSUER)");
  const audience = arg("audience") ?? fail("--local-auth needs --audience (the service's SERVICE_AUDIENCE)");
  const port = Number(arg("jwks-port", "18089"));
  const kid = "perf-" + crypto.randomUUID().slice(0, 8);
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid, alg: "RS256", use: "sig" };
  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch(request) {
      if (new URL(request.url).pathname === "/auth/jwks") return Response.json({ keys: [jwk] });
      return new Response("not found", { status: 404 });
    },
  });
  console.log(`local auth: JWKS on :${port}/auth/jwks, kid ${kid}, iss ${issuer}, aud ${audience}`);
  return {
    async token() {
      const now = Math.floor(Date.now() / 1000);
      const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
      const claims = b64url(
        JSON.stringify({ iss: issuer, aud: audience, sub: "system:letterhead-perf", scope: "letterhead:render", iat: now, exp: now + 600 }),
      );
      const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, Buffer.from(`${header}.${claims}`));
      return `${header}.${claims}.${b64url(signature)}`;
    },
    stop: () => server.stop(true),
  };
}

function deployedAuth(authUrl: string): TokenSource {
  const clientId = process.env.LETTERHEAD_PERF_CLIENT_ID;
  const clientSecret = process.env.LETTERHEAD_PERF_CLIENT_SECRET;
  if (!clientId || !clientSecret) fail("--auth-url needs LETTERHEAD_PERF_CLIENT_ID and LETTERHEAD_PERF_CLIENT_SECRET in the environment");
  let cached: { token: string; usableUntil: number } | null = null;
  return {
    async token() {
      if (cached && cached.usableUntil > Date.now()) return cached.token;
      const res = await fetch(`${authUrl.replace(/\/+$/, "")}/system/service-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret }),
        redirect: "error", // the body holds the secret: never replay it to another host
        signal: AbortSignal.timeout(5000),
      });
      // Only the status is reported: a failure body could echo what was sent.
      if (!res.ok) fail(`auth /system/service-token answered HTTP ${res.status}`);
      const body = (await res.json()) as { token?: unknown; expiresInSeconds?: unknown };
      if (typeof body.token !== "string" || typeof body.expiresInSeconds !== "number") fail("auth /system/service-token answered an unexpected body");
      cached = { token: body.token, usableUntil: Date.now() + body.expiresInSeconds * 1000 - 60_000 };
      return body.token;
    },
    stop() {},
  };
}

/** The credential the command line asks for. */
export async function tokenSourceFromArgs(): Promise<TokenSource> {
  const authUrl = arg("auth-url");
  if (!flag("local-auth") === !authUrl) fail("give exactly one of --local-auth and --auth-url");
  return flag("local-auth") ? await localAuth() : deployedAuth(authUrl as string);
}

