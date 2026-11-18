import { OpenAPIHono } from "@hono/zod-openapi";
import { auth } from "./auth.config";
import { withInternalClientAddress } from "./clientAddress";

export const authRouter = new OpenAPIHono();

// Delegate all /auth/** traffic to Better Auth's built-in handler.
// Better Auth resolves: sign-in, sign-up, OAuth callbacks, session
// management, token issuance, and /.well-known/jwks.json (internal).
// A request from the private network (no X-Forwarded-For) gets its own client address, so the rate limiter never
// lumps it with public traffic (clientAddress.ts).
authRouter.on(["GET", "POST", "DELETE"], "/**", (c) => {
  return auth.handler(withInternalClientAddress(c.req.raw));
});
