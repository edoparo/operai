/**
 * POST /system/service-token — client-credentials issuance of a short-lived,
 * scoped RS256 service JWT (T4, specs/015-hardware-inventory — refs AC-2.8,
 * AC-2.9; plan.md "Service authentication for the notification push";
 * ADR-0044, which realises ADR-0040's hard stop for a fourth notify caller).
 *
 * The caller (`inventory-api`) presents `{clientId, clientSecret}`; the secret
 * is checked against that client's entry in `SERVICE_CLIENTS`
 * (`serviceClients.ts`, constant-time). On success the response is
 * `{token, expiresInSeconds: 300}`. The token:
 *
 *   sub   system:<clientId>
 *   aud   SERVICE_AUDIENCE — NEVER AUTH_AUDIENCE. The two are forced apart at
 *         startup (`lib/env.ts`) and re-asserted here per mint, so a service
 *         token is useless on every user route (`bearerJwtMiddleware` pins
 *         `aud = AUTH_AUDIENCE`) and a user JWT useless on every system route.
 *   scope the client's own entry, from a code-level allowlist
 *   iss   BETTER_AUTH_URL, as for user tokens
 *   exp   iat + 300 s; jti unique per token
 *
 * WHICH KEY SIGNS (plan risk R-4): better-auth's jwt plugin, through its
 * server-only `signJWT` endpoint — the same rotating RS256 key and `kid` that
 * `/auth/jwks` publishes and every resource server verifies against. NOT
 * `jose` + `JWT_PRIVATE_KEY`: that env pair is a separate static keypair
 * served at `/.well-known/jwks.json` that signs nothing in this service
 * (ADR-0005 correction), so tokens signed with it would fail verification
 * everywhere. `serviceToken.contract.test.ts` pins this end to end.
 *
 * FAILURE SHAPE. Unknown client and wrong secret are the SAME response, byte
 * for byte (one frozen body, one status, no client id echoed), and run the same
 * hash + constant-time compare, so neither the body nor the timing separates
 * them. Malformed bodies are a 400 (they carry no client information). With no
 * clients configured the endpoint authenticates nobody: every call is that same
 * 401.
 *
 * WHY A FACTORY. The router takes its signer as a dependency instead of
 * importing `auth.config` itself. Production wires `signWithAuth(auth)` in
 * `src/index.ts`; tests inject either a throwaway in-memory key (route logic)
 * or the real plugin (`src/auth/service-token.contract.test.ts`). This module
 * must not import `auth.config`: several sibling test files
 * `mock.module("../auth/auth.config", ...)` for the rest of the process, and
 * any module FIRST loaded after that gets the stub (no `signJWT`) — which would
 * make this route's tests pass or fail depending on file order.
 *
 * LIMITS (specs/029 US-7, ADR-0086): the credential is verified FIRST and then
 * exactly one count is consulted — a valid credential against its own calling
 * service (`system:<clientId>`, 300 per 10 min), an invalid one (malformed body,
 * unknown client, wrong secret) against its source address (20 per 10 min, one
 * counter shared with `/system/users/contact`). Both refusals are the one 429 of
 * `systemRateLimits.tooManyRequests`; nothing is minted for either. The old
 * address-keyed guard ahead of everything is gone: on the private network every
 * service is the same address, so it starved the whole suite (D-1). The pre-
 * verification key is still never the CLAIMED client id (anyone could lock a
 * service out by its guessable name); the per-service key is only ever the
 * verified one. The work for an invalid request is bounded and I/O-free: a 4 KiB
 * body cap, one JSON parse, two SHA-256 and one constant-time compare, one map
 * update — no database, no signer. Per-process (ADR-0035's named limitation).
 * No secret, token, client id or address is ever logged.
 */

import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { env } from "../lib/env";
import { readJsonBody } from "./boundedBody";
import {
  authenticateServiceClient,
  SERVICE_SUB_PREFIX,
  SERVICE_TOKEN_TTL_SECONDS,
} from "./serviceClients";
import type { SystemRateLimits } from "./systemRateLimits";

// ─── Schemas ──────────────────────────────────────────────────────────────────
// Length caps bound the work done on attacker-controlled input before any
// comparison. `.strict()`: an unexpected key is a client bug worth a 400.
const ServiceTokenRequestSchema = z
  .object({
    clientId: z.string().min(1).max(64),
    clientSecret: z.string().min(1).max(256),
  })
  .strict();

const ServiceTokenResponseSchema = z.object({
  token: z.string(),
  expiresInSeconds: z.literal(SERVICE_TOKEN_TTL_SECONDS),
});

const ProblemJsonSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string(),
  instance: z.string(),
});

const ProblemJsonWithCodeSchema = ProblemJsonSchema.extend({ code: z.string() });

const postServiceTokenRoute = createRoute({
  method: "post",
  path: "/system/service-token",
  tags: ["System"],
  summary: "Mint a short-lived scoped service JWT (client-credentials)",
  description:
    "Service-to-service only. Exchanges a per-client secret for a 5-minute RS256 JWT " +
    "(sub system:<clientId>, aud SERVICE_AUDIENCE, scope from the client entry). The token " +
    "is never accepted on a user route. Unknown client and wrong secret return the same 401.",
  request: {
    body: { content: { "application/json": { schema: ServiceTokenRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: ServiceTokenResponseSchema } },
      description: "A service JWT and its lifetime in seconds",
    },
    400: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "Malformed body",
    },
    401: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "Invalid client credentials (identical for unknown client and wrong secret)",
    },
    429: {
      content: { "application/json": { schema: ProblemJsonWithCodeSchema } },
      description: "Rate limit exceeded",
    },
  },
});

// ─── Source address ──────────────────────────────────────────────────────────

/** The platform proxy's view of the caller (rightmost XFF entry), bounded in length. */
export function callerAddress(forwardedFor: string | undefined): string {
  const last = forwardedFor?.split(",").at(-1)?.trim();
  return last ? last.slice(0, 64) : "direct";
}

// ─── Signing seam ────────────────────────────────────────────────────────────

/** The claims of a service token. `signJwt` must sign exactly these, with the suite's RS256 key and kid. */
export interface ServiceJwtPayload {
  iss: string;
  sub: string;
  aud: string;
  scope: string;
  iat: number;
  exp: number;
  jti: string;
}

export type SignServiceJwt = (payload: ServiceJwtPayload) => Promise<string>;

/** The slice of better-auth's `auth` object this needs: the jwt plugin's server-only `signJWT`. */
export interface JwtSigningAuth {
  api: {
    signJWT(input: { body: { payload: Record<string, unknown> } }): Promise<{ token: string }>;
  };
}

/** Production signer: better-auth's jwt plugin — the key and `kid` published at `/auth/jwks`. */
export const signWithAuth =
  (authLike: JwtSigningAuth): SignServiceJwt =>
  async (payload) => (await authLike.api.signJWT({ body: { payload: { ...payload } } })).token;

/**
 * The one place a service token's claims are built and signed — used by the
 * endpoint above and by the self-mint provider (`selfServiceToken.ts`,
 * ADR-0048), so the two cannot drift in audience, lifetime or claim shape.
 * `exp` (seconds) is returned so a caching caller needs no JWT decode.
 */
export async function mintServiceJwt(
  signJwt: SignServiceJwt,
  principal: { clientId: string; scopes: readonly string[]; nowMs?: number },
): Promise<{ token: string; exp: number }> {
  // Defence in depth behind lib/env.ts's startup check: never mint a token a
  // user route would accept, and never mint without an audience.
  const audience = env.SERVICE_AUDIENCE;
  if (!audience || audience === env.AUTH_AUDIENCE) {
    throw new Error("SERVICE_AUDIENCE is unset or equals AUTH_AUDIENCE; refusing to mint a service token");
  }

  const issuedAt = Math.floor((principal.nowMs ?? Date.now()) / 1000);
  const exp = issuedAt + SERVICE_TOKEN_TTL_SECONDS;
  const token = await signJwt({
    iss: env.BETTER_AUTH_URL,
    sub: `${SERVICE_SUB_PREFIX}${principal.clientId}`,
    aud: audience,
    scope: principal.scopes.join(" "),
    iat: issuedAt,
    exp,
    jti: crypto.randomUUID(),
  });
  return { token, exp };
}

// ─── Router ──────────────────────────────────────────────────────────────────

const badRequest = (c: Context, detail: string) =>
  c.json(
    { type: "https://httpstatuses.com/400", title: "Bad Request", status: 400, detail, instance: c.req.path },
    400,
  );

export function createServiceTokenRouter(deps: { signJwt: SignServiceJwt; limits: SystemRateLimits }) {
  const { limits } = deps;

  // Not `.openapi()`: that would run the body validator (an unbounded read, and a 400 answered before any
  // count). The route is registered for the API document only; the handler below owns the whole order.
  const serviceTokenRouter = new OpenAPIHono();
  serviceTokenRouter.openAPIRegistry.registerPath(postServiceTokenRoute);

  serviceTokenRouter.post("/system/service-token", async (c) => {
    // 1. Verify the credential. Nothing here does I/O, mints, or consults a count.
    let invalid: Response | null = null;
    let credentials: { clientId: string; clientSecret: string } | null = null;
    let client: ReturnType<typeof authenticateServiceClient> = null;

    const body = await readJsonBody(c.req.raw);
    if (!body.ok) {
      invalid = badRequest(c, body.detail);
    } else {
      const parsed = ServiceTokenRequestSchema.safeParse(body.value);
      if (!parsed.success) {
        // Field names and rule text only: never echo the submitted values.
        invalid = badRequest(
          c,
          parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        );
      } else {
        credentials = parsed.data;
        // Runs once on every request that has credentials to compare, whatever the counts say.
        client = authenticateServiceClient(env.SERVICE_CLIENTS, credentials.clientId, credentials.clientSecret);
      }
    }

    // 2. Exactly one count.
    if (client && credentials) {
      const caller = `${SERVICE_SUB_PREFIX}${credentials.clientId}`;
      if (!limits.serviceToken.consume(caller).allowed) {
        limits.logRefusal("allowance", "service-token", caller);
        return limits.tooManyRequests(c);
      }
      const { token } = await mintServiceJwt(deps.signJwt, {
        clientId: credentials.clientId,
        scopes: client.scopes,
      });
      c.header("Cache-Control", "no-store");
      return c.json({ token, expiresInSeconds: SERVICE_TOKEN_TTL_SECONDS }, 200);
    }

    const source = callerAddress(c.req.header("X-Forwarded-For"));
    if (!limits.invalidCredentials.consume(source).allowed) {
      limits.logRefusal("invalid", "service-token", source);
      return limits.tooManyRequests(c);
    }
    if (invalid) return invalid;

    // The reason (unknown client vs wrong secret) is deliberately not logged
    // either: the log line is the only other place it could be learned from.
    console.warn("[system/service-token] rejected credentials");
    // The one 401: constant status and body for every credential failure
    // (`instance` is the fixed request path, not caller-derived).
    return c.json(
      {
        type: "https://httpstatuses.com/401",
        title: "Unauthorized",
        status: 401,
        detail: "Invalid client credentials",
        instance: c.req.path,
      },
      401,
      { "Cache-Control": "no-store" },
    );
  });

  return serviceTokenRouter;
}
