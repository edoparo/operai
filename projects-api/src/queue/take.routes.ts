/**
 * Taking a deal from the to-start queue (specs/022-projects-handoff): `POST /queue/{dealId}/project`
 * and `POST /queue/{dealId}/attach`. T4 mounts this stub so that T7, which adds the routes,
 * never edits `src/index.ts`.
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthzVariables } from "../auth/authz.middleware";
import { validationHook } from "../lib/problem";

export const takeRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({ defaultHook: validationHook });
