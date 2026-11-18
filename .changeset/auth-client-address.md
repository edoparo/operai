---
"@operai/auth": patch
---

Sign-in rate limiting reads the real client address: Railway's internal hops are trusted proxies, so a caller-written X-Forwarded-For can no longer land in the shared "no IP" bucket, and requests from Operai's own services on the private network get their own bucket instead of a warning.
