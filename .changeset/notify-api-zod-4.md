---
'@operai/notify-api': patch
---

Moves notify-api to zod 4 (4.6.7) and `@hono/zod-openapi` 1.6.3, and `@scalar/hono-api-reference` to 0.12.17, closing the zod memory-exhaustion advisory (GHSA-mrhx-c7xc-m3w5, zod before 4.6.6, no 3.x fix); the Scalar bump is needed because the old one pulled a second, vulnerable zod. The OpenAPI document is unchanged. A request body or query that fails validation still answers 400 with `{ success: false, error: { issues, name: "ZodError" } }` (kept by a `defaultHook`, since zod 4 would otherwise serialise the error as `{ name, message }`), but the issues use zod 4's codes and messages. A JSON body sent with another Content-Type, or none, now answers 415 as a Problem document instead of 400. A datetime without seconds or with an offset written `+0200` is no longer accepted, and the `/docs` page loads Scalar through a different script.
