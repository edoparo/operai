---
'@operai/refund-api': patch
---

Moves refund-api to zod 4 (4.6.7) and `@hono/zod-openapi` 1.6.3, and `@scalar/hono-api-reference` to 0.12.17, closing the zod memory-exhaustion advisory (GHSA-mrhx-c7xc-m3w5, zod before 4.6.6, no 3.x fix); the Scalar bump is needed because the old one pulled a second, vulnerable zod. The routers that already had a validation hook keep their Problem JSON body; the two without one (submit/withdraw and the request export) keep `{ success: false, error: { issues, name: "ZodError" } }` through a `defaultHook`, with zod 4's issue codes and messages. The OpenAPI document is unchanged except that a nullable enum (`emailStatus` on the batch list) now lists `null` among its values, as OpenAPI 3.0 requires. A JSON body sent with another Content-Type now answers 415 instead of a validation error. A datetime without seconds (`2026-01-01T00:00Z`) and an integer of 2^53 or more are no longer accepted, and the `/docs` page loads Scalar through a different script.
