import { createMiddleware } from "hono/factory";
import { env } from "./env";
import { problem } from "./problem";

/**
 * The maintenance switch (specs/028 AC-2.5, ADR-0083). While `ACTIVITIES_MAINTENANCE=true`
 * every request except `GET /health` is refused with 503 `maintenance` BEFORE authentication
 * and before anything reads or writes the database, so the CRM -> activities-api copy runs
 * against data nobody can change. `/health` stays up so Railway does not restart the service
 * during the pause. Mounted first (after CORS, so the browser can read the answer).
 *
 * The flag is read per request from `env`, not captured at startup.
 */
export const maintenanceGate = () =>
  createMiddleware(async (c, next) => {
    if (!env.ACTIVITIES_MAINTENANCE) return next();
    if (c.req.method === "GET" && c.req.path === "/health") return next();
    return problem(
      {
        status: 503,
        code: "maintenance",
        detail: "Activities are temporarily unavailable while they are being moved. Try again shortly.",
      },
      c.req.path,
    );
  });
