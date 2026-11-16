---
'@operai/projects-api': patch
---

Moves projects-api to zod 4 (4.6.7) and `@hono/zod-openapi` 1.6.3, and `@scalar/hono-api-reference` to 0.12.17 (its old version pulled a second, vulnerable zod), closing the zod memory-exhaustion advisory (GHSA-mrhx-c7xc-m3w5, zod before 4.6.6, no 3.x fix). Every validation 400 keeps its Problem document and field names, but the default messages are zod 4's wording (for example `Invalid input: expected string, received undefined` instead of `Required`). A JSON body sent with another Content-Type, or none, now answers 415 as a Problem document instead of 400. The OpenAPI document is unchanged except that the nullable `stateBeforeHold` enum now lists `null` as OpenAPI 3.0 requires, and the `/docs` page loads Scalar through a different script.
