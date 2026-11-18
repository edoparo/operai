/**
 * Who a request to better-auth comes from, for its rate limiter (better-auth's `advanced.ipAddress`).
 *
 * PUBLIC traffic always crosses Railway's edge proxy, which adds `X-Forwarded-For` (appending to any value the caller
 * sent). better-auth reads that header with `trustedProxies` = Railway's internal ranges, so the client is the
 * rightmost address that is not an internal hop.
 *
 * PRIVATE traffic (another Operai service on `*.railway.internal`, e.g. a resource server fetching `/auth/jwks` on
 * start) never crosses the edge and carries no `X-Forwarded-For` at all. better-auth then finds no address, logs a
 * warning, and charges it to a single shared per-path bucket, which a public caller sending a crafted header chain
 * could fill, blocking every service's JWKS fetch with 429s. `withInternalClientAddress` gives such a request the
 * loopback address instead: the suite's own services share one bucket of their own, apart from the public. A public
 * request cannot reach it: the edge always adds the header, and the caller cannot remove what the proxy appends.
 */

/** Railway's internal hops: carrier-grade NAT and IPv6 unique-local addresses. No public client is ever in them. */
export const RAILWAY_INTERNAL_RANGES = ["100.64.0.0/10", "fd00::/8"];

/** The address given to a request that did not come through the edge proxy. */
export const INTERNAL_CLIENT_ADDRESS = "127.0.0.1";

export function withInternalClientAddress(request: Request): Request {
  if (request.headers.has("x-forwarded-for")) return request;
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-for", INTERNAL_CLIENT_ADDRESS);
  return new Request(request, { headers });
}
