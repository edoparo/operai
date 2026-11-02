/**
 * POST /system/users/contact — resolve ONE active user's contact details for a
 * service principal (specs/019-crm-notifications T2, D-1/D-2; plan.md "auth —
 * POST /system/users/contact"). notify-api calls it at send time to turn a
 * user id into the address of an email notice; callers never handle addresses.
 *
 * AUTH: a service JWT, and nothing else. `auth` verifies tokens it signed
 * itself, IN PROCESS, with `jose` against better-auth's own key set — the
 * rotating RS256 keys that `/auth/jwks` publishes (`auth.api.getJwks`), read
 * fresh per call so a rotation needs no restart. Checks, like notify-api's
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
 * RATE LIMITING reuses the `/system/service-token` mechanism and settings
 * (network address, every attempt counted ahead of auth and validation).
 */

import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { errors as joseErrors, createLocalJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { db } from "../lib/db";
import { env } from "../lib/env";
import { createSlidingWindowRateLimiter } from "../lib/rateLimiter";
import { SERVICE_SUB_PREFIX } from "./serviceClients";
import { callerAddress } from "./serviceToken.routes";

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

/** Returns the key resolver used to verify a service JWT; called once per request. */
export type GetServiceJwks = () => Promise<JWTVerifyGetKey>;

/** The slice of better-auth's `auth` object this needs: the jwt plugin's `getJwks`. */
export interface JwksAuth {
  api: { getJwks(): Promise<{ keys: unknown[] }> };
}

/** Production key source: better-auth's current key set, the one `/auth/jwks` serves. */
export const jwksFromAuth =
  (authLike: JwksAuth): GetServiceJwks =>
  async () =>
    createLocalJWKSet((await authLike.api.getJwks()) as Parameters<typeof createLocalJWKSet>[0]);

// ─── Router ──────────────────────────────────────────────────────────────────

const unauthorized = (path: string) => ({
  type: "https://httpstatuses.com/401",
  title: "Unauthorized",
  status: 401,
  detail: "Valid credentials are required",
  instance: path,
});

export function createUserContactRouter(deps: { getJwks: GetServiceJwks }) {
  const limiter = createSlidingWindowRateLimiter({
    limit: env.SERVICE_TOKEN_RATE_LIMIT,
    windowMs: env.SERVICE_TOKEN_RATE_WINDOW_MS,
  });

  const rateLimit = createMiddleware(async (c, next) => {
    const result = limiter.consume(callerAddress(c.req.header("X-Forwarded-For")));
    if (!result.allowed) {
      c.header("Retry-After", String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
      return c.json(
        {
          type: "https://httpstatuses.com/429",
          title: "Too Many Requests",
          status: 429,
          detail: "Too many requests. Try again later.",
          instance: c.req.path,
          code: "rate_limited",
        },
        429,
      );
    }
    return next();
  });

  // Registered before the route, so a bad credential is refused before the
  // body is even parsed (a 400 must not be reachable without a credential).
  const serviceAuth = createMiddleware<{ Variables: { serviceSub: string } }>(async (c, next) => {
    const audience = env.SERVICE_AUDIENCE;
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
    if (!audience || !token) return c.json(unauthorized(c.req.path), 401, { "Cache-Control": "no-store" });

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
        return c.json(unauthorized(c.req.path), 401, { "Cache-Control": "no-store" });
      }
      c.set("serviceSub", sub);
    } catch (err) {
      // The jose error code only: nothing about the presented credential.
      const code = err instanceof joseErrors.JOSEError ? (err.code ?? err.constructor.name) : "JWT_VERIFY_FAILED";
      console.warn("[system-jwt] verification failed:", code);
      return c.json(unauthorized(c.req.path), 401, { "Cache-Control": "no-store" });
    }
    return next();
  });

  const router = new OpenAPIHono<{ Variables: { serviceSub: string } }>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            type: "https://httpstatuses.com/400",
            title: "Bad Request",
            status: 400,
            // Field names and rule text only: never echo the submitted values.
            detail: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
            instance: c.req.path,
          },
          400,
        );
      }
      return undefined;
    },
  });

  router.use("/system/users/contact", rateLimit, serviceAuth);

  router.openapi(postUserContactRoute, async (c) => {
    const { userId } = c.req.valid("json");
    const user = await db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, name: true },
    });
    console.log(`[system] users.contact caller=${c.get("serviceSub")} found=${user !== null}`);

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
