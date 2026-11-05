/**
 * serviceAuth — the only credential of crm-api's `/system` routes (specs/018
 * AC-3.3, ADR-0073; the shape of notify-api's systemAuth, ADR-0044/0049).
 *
 * `Authorization: Bearer <service JWT>` minted by auth's `POST /system/service-token`:
 * RS256 via the suite JWKS, issuer pinned, `aud` = SERVICE_AUDIENCE (never
 * AUTH_AUDIENCE, so a user JWT is not a system credential), the route's scope in
 * the space-delimited `scope` claim, and a `sub` the route names. Every failure
 * is the same 401; only the jose error code is logged, never the token. An
 * accepted call logs `[system-auth] <METHOD> <path> caller=<sub>`.
 */

import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { env } from "../lib/env";

export type ServiceAuthVariables = { serviceSub: string };

const unauthorized = (path: string) =>
  Response.json(
    { type: "https://httpstatuses.com/401", title: "Unauthorized", status: 401, detail: "Valid credentials are required", instance: path },
    { status: 401 },
  );

let jwks: JWTVerifyGetKey | undefined;
const keys = (): JWTVerifyGetKey => (jwks ??= createRemoteJWKSet(new URL(env.AUTH_JWKS_URL)));

/** Tests verify against their own key set. */
export function setServiceJwksForTests(next: JWTVerifyGetKey | undefined): void {
  jwks = next;
}

export function serviceAuth(options: { scope: string; callers: readonly string[] }) {
  return createMiddleware<{ Variables: ServiceAuthVariables }>(async (c, next) => {
    const audience = env.SERVICE_AUDIENCE;
    const header = c.req.header("Authorization");
    if (!audience || !header?.startsWith("Bearer ") || header.length === 7) return unauthorized(c.req.path);
    try {
      const { payload } = await jwtVerify(header.slice(7), keys(), {
        issuer: env.AUTH_ISSUER,
        audience,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "sub", "aud", "iss"],
      });
      const scope = payload["scope"];
      if (
        typeof payload.sub !== "string" ||
        !options.callers.includes(payload.sub) ||
        typeof scope !== "string" ||
        !scope.split(" ").includes(options.scope)
      ) {
        return unauthorized(c.req.path);
      }
      c.set("serviceSub", payload.sub);
      console.log(`[system-auth] ${c.req.method} ${c.req.path} caller=${payload.sub}`);
    } catch (error) {
      const code = error instanceof joseErrors.JOSEError ? (error.code ?? error.constructor.name) : "JWT_VERIFY_FAILED";
      console.warn("[system-auth] verification failed:", code);
      return unauthorized(c.req.path);
    }
    return next();
  });
}
