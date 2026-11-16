---
'@operai/inventory-api': patch
---

Moves inventory-api to zod 4 (4.6.7) and `@hono/zod-openapi` 1.6.3, and `@scalar/hono-api-reference` to 0.12.17, closing the zod memory-exhaustion advisory (GHSA-mrhx-c7xc-m3w5, zod before 4.6.6, no 3.x fix); the Scalar bump is needed because the old one pulled a second, vulnerable zod. A body, query or path value that fails validation still answers 422 with the same `field` and `errors` members, but the message text inside is zod 4's wording. A JSON body sent with another Content-Type, or none, now answers 415 as a Problem document instead of 422. In the OpenAPI document the asset response schema now declares `additionalProperties`, and a duplicate `nullable` entry in the history change values is gone; neither changes what is accepted or returned. The `/docs` page loads Scalar through a different script.
