/**
 * The to-start queue (specs/022-projects-handoff): the won deals no project has taken yet.
 * T4 mounts this stub so that T6, which adds `GET /queue`, never edits `src/index.ts`.
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthzVariables } from "../auth/authz.middleware";
import { validationHook } from "../lib/problem";

export const queueRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({ defaultHook: validationHook });
