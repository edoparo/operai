---
'@operai/shell': patch
---

The notification bell no longer goes silent after notify-api restarts. When the stream's ticket could not be minted during a reconnect (network failure, 408, 429, 5xx), the connection used to stop for good until the page remounted; it now retries with the reconnect backoff, and a refused mint (signed out, 4xx) still stops. The connection is one explicit state (idle, minting, open, waiting) with a generation bumped on close, so a mint answered after sign-out never opens a stream. The JWT cache is single-flight: concurrent calls share one `/auth/token` request, concurrent 401s share one refresh, and a token answered after `clearJwtCache()` is never cached.
