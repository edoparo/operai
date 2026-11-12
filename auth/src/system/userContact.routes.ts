/**
 * POST /system/users/contact — resolve ONE active user's contact details for a
 * service principal (specs/019-crm-notifications T2, D-1/D-2; plan.md "auth —
 * POST /system/users/contact"). notify-api calls it at send time to turn a
 * user id into the address of an email notice; callers never handle addresses.
 *
 * AUTH: a service JWT, and nothing else. `auth` verifies tokens it signed
 * itself, IN PROCESS, with `jose` against better-auth's own key set — the
 * rotating RS256 keys that `/auth/jwks` publishes (`auth.api.getJwks`), held in
 * memory and re-read only when a token names a `kid` the cache does not hold,
 * at most once per 30 s (`jwksFromAuth`), so a new key needs no restart and a
 * flood of invalid tokens costs no I/O. Checks, like notify-api's
 * `systemAuth.middleware`: RS256 pinned, issuer = BETTER_AUTH_URL, `aud` =
 * SERVICE_AUDIENCE (a user JWT carries AUTH_AUDIENCE and fails here), required
 * exp/sub/aud/iss, `sub` of the form `system:<client>`, and `users.contact` in
 * the space-delimited `scope`. EVERY failure — no header, bad signature,
 * expired, wrong aud/scope — returns the same frozen 401 body, so a caller
 * learns nothing about which check failed.
 *
 * ONE USER PER CALL (D-2): the endpoint is useless for harvesting the roster.
 * Unknown and soft-deleted users are the SAME 404, byte for byte (ADR-0012).
 *
 * LOGGING: one line per accepted call, `[system] users.contact caller=<sub>
 * found=<bool>` — never the id, email or name.
 *
 * WHY A FACTORY: like serviceToken.routes.ts, the key source is injected so
 * this module never imports `auth.config` (test files mock it).
 *
 * LIMITS (specs/029 US-7, ADR-0086), shared with `/system/service-token`: the
 * credential is verified FIRST, then exactly one count — a valid one (RS256,
 * issuer, audience, `system:<id>` sub AND the `users.contact` scope) against its
 * own calling service (the verified `sub`, 600 per 10 min); anything else,
 * including a genuine service JWT that lacks the scope, against the source
 * address (20 per 10 min, one counter shared with the token endpoint). Both
 * refusals are the one 429 of `systemRateLimits.tooManyRequests`; no user is
 * looked up for either, and over the allowance the body is not even read. The
 * work for an invalid request is bounded and I/O-free: a 4 096-character token
 * cap, the cached key set, one RS256 verify, no database.
 */

import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { errors as joseErrors, createLocalJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { db } from "../lib/db";
import { env } from "../lib/env";
import { readJsonBody } from "./boundedBody";
import { SERVICE_SUB_PREFIX } from "./serviceClients";
import { callerAddress } from "./serviceToken.routes";
import type { SystemRateLimits } from "./systemRateLimits";

export const USERS_CONTACT_SCOPE = "users.contact";

// ─── Schemas ──────────────────────────────────────────────────────────────────
const UserContactRequestSchema = z.object({ userId: z.string().min(1).max(200) }).strict();

const UserContactResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
});

const ProblemJsonSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string(),
  instance: z.string(),
});

const ProblemJsonWithCodeSchema = ProblemJsonSchema.extend({ code: z.string() });

const postUserContactRoute = createRoute({
  method: "post",
  path: "/system/users/contact",
  tags: ["System"],
  summary: "Resolve one active user's contact details (service principals only)",
  description:
    "Service-to-service only: needs a service JWT (aud SERVICE_AUDIENCE) with scope users.contact. " +
    "Returns {id, email, name} of an active user. Unknown and deleted users return the same 404.",
  request: {
    body: { content: { "application/json": { schema: UserContactRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: UserContactResponseSchema } },
      description: "The user's contact details",
    },
    400: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "Malformed body",
    },
    401: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "Missing or invalid service credential (identical for every failure)",
    },
    404: {
      content: { "application/json": { schema: ProblemJsonSchema } },
      description: "No active user with that id (identical for unknown and deleted)",
    },
    429: {
      content: { "application/json": { schema: ProblemJsonWithCodeSchema } },
      description: "Rate limit exceeded",
    },
  },
});

// ─── Key source seam ─────────────────────────────────────────────────────────

/** Returns the key resolver used to verify a service JWT; called once per request (it does no I/O itself). */
export type GetServiceJwks = () => Promise<JWTVerifyGetKey>;

/** The slice of better-auth's `auth` object this needs: the jwt plugin's `getJwks`. */
export interface JwksAuth {
  api: { getJwks(): Promise<{ keys: unknown[] }> };
}

/** Longest bearer token examined; real service tokens are a few hundred characters. */
export const MAX_TOKEN_CHARS = 4096;

/** A key set is read again for an unknown `kid` at most this often (R16). */
export const JWKS_REREAD_COOLDOWN_MS = 30_000;

/**
 * Production key source: better-auth's current key set, the one `/auth/jwks`
 * serves, CACHED. Verification of an invalid token must cost no I/O (ADR-0086):
 * the set is held in memory and re-read only when a token's `kid` matches
 * nothing in it, and a read — successful or not — starts a cooldown during which
 * no other read happens, whatever the flood. better-auth's jwt plugin has no
 * `rotationInterval` configured, so keys change only by deliberate action and a
 * new `kid` is picked up at the first token that uses it after the cooldown; a
 * valid token refused inside that window is answered 401 (R16). Concurrent
 * callers share one read.
 */
export function jwksFromAuth(
  authLike: JwksAuth,
  options: { now?: () => number; cooldownMs?: number } = {},
): GetServiceJwks {
  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? JWKS_REREAD_COOLDOWN_MS;

  let keySet: JWTVerifyGetKey | null = null;
  let lastReadAt: number | undefined;
  let inflight: Promise<void> | null = null;

  const cooledDown = () => lastReadAt === undefined || now() - lastReadAt >= cooldownMs;

  const reload = (): Promise<void> => {
    inflight ??= (async () => {
      lastReadAt = now();
      try {
        keySet = createLocalJWKSet((await authLike.api.getJwks()) as Parameters<typeof createLocalJWKSet>[0]);
      } catch (err) {
        // The error class only: nothing about keys or the database.
        console.warn("[system-jwt] key set read failed:", err instanceof Error ? err.constructor.name : "unknown");
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };

  const resolver: JWTVerifyGetKey = async (header, token) => {
    if (inflight) await inflight;
    if (keySet === null && cooledDown()) await reload();
    if (keySet === null) throw new Error("key set unavailable");
    try {
      return await keySet(header, token);
    } catch (err) {
      if (!(err instanceof joseErrors.JWKSNoMatchingKey) || !cooledDown()) throw err;
      await reload();
      return keySet(header, token);
    }
  };
  return async () => resolver;
}

// ─── Router ──────────────────────────────────────────────────────────────────

const unauthorized = (path: string) => ({
  type: "https://httpstatuses.com/401",
  title: "Unauthorized",
  status: 401,
  detail: "Valid credentials are required",
  instance: path,
});

export function createUserContactRouter(deps: { getJwks: GetServiceJwks; limits: SystemRateLimits }) {
  const { limits } = deps;

  /** The verified calling service, or `failure` (the jose error code when there is one, for the log line). */
  type Verdict = { valid: true; sub: string } | { valid: false; failure: string | null };

  async function verify(authorization: string | undefined): Promise<Verdict> {
    const audience = env.SERVICE_AUDIENCE;
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!audience || !token || token.length > MAX_TOKEN_CHARS) return { valid: false, failure: null };
    try {
      const { payload } = await jwtVerify(token, await deps.getJwks(), {
        issuer: env.BETTER_AUTH_URL,
        audience,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "sub", "aud", "iss"],
      });
      const sub = payload.sub;
      const scope = payload["scope"];
      if (
        typeof sub !== "string" ||
        !sub.startsWith(SERVICE_SUB_PREFIX) ||
        sub.length === SERVICE_SUB_PREFIX.length ||
        typeof scope !== "string" ||
        !scope.split(" ").includes(USERS_CONTACT_SCOPE)
      ) {
        return { valid: false, failure: null };
      }
      return { valid: true, sub };
    } catch (err) {
      // The jose error code only: nothing about the presented credential.
      const code = err instanceof joseErrors.JOSEError ? (err.code ?? err.constructor.name) : "JWT_VERIFY_FAILED";
      return { valid: false, failure: code };
    }
  }

  // Not `.openapi()`: its body validator would answer a 400 before any credential check or count. The route
  // is registered for the API document only; the handler below owns the whole order.
  const router = new OpenAPIHono();
  router.openAPIRegistry.registerPath(postUserContactRoute);

  router.post("/system/users/contact", async (c) => {
    // 1. Verify the credential (no I/O, no count).
    const verdict = await verify(c.req.header("Authorization"));

    // 2. Exactly one count.
    if (!verdict.valid) {
      const source = callerAddress(c.req.header("X-Forwarded-For"));
      if (!limits.invalidCredentials.consume(source).allowed) {
        limits.logRefusal("invalid", "users/contact", source);
        return limits.tooManyRequests(c);
      }
      if (verdict.failure !== null) console.warn("[system-jwt] verification failed:", verdict.failure);
      return c.json(unauthorized(c.req.path), 401, { "Cache-Control": "no-store" });
    }
    if (!limits.usersContact.consume(verdict.sub).allowed) {
      limits.logRefusal("allowance", "users/contact", verdict.sub);
      return limits.tooManyRequests(c);
    }

    // 3. The request itself (a 400 is reachable only with a valid credential, as before).
    const body = await readJsonBody(c.req.raw);
    const parsed = body.ok ? UserContactRequestSchema.safeParse(body.value) : null;
    if (!body.ok || !parsed?.success) {
      return c.json(
        {
          type: "https://httpstatuses.com/400",
          title: "Bad Request",
          status: 400,
          // Field names and rule text only: never echo the submitted values.
          detail: body.ok
            ? parsed!.error!.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
            : body.detail,
          instance: c.req.path,
        },
        400,
      );
    }

    const user = await db.user.findFirst({
      where: { id: parsed.data.userId, deletedAt: null },
      select: { id: true, email: true, name: true },
    });
    console.log(`[system] users.contact caller=${verdict.sub} found=${user !== null}`);

    c.header("Cache-Control", "no-store");
    if (!user) {
      return c.json(
        {
          type: "https://httpstatuses.com/404",
          title: "Not Found",
          status: 404,
          detail: "No active user with that id",
          instance: c.req.path,
        },
        404,
      );
    }
    return c.json({ id: user.id, email: user.email, name: user.name }, 200);
  });

  return router;
}
