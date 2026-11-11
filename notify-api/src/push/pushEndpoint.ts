/**
 * Push-subscription endpoint allowlist (T4, specs/029-push-notifications,
 * plan.md §API contracts `PUT /push/devices` -> 422 `endpoint_not_allowed`).
 *
 * SECURITY (SSRF): notify-api POSTs to the endpoint a client registers. Only the push
 * services of the supported browsers may be reached, over https, on the default port,
 * with no credentials in the URL. Pure and DB-free so it is table-testable.
 */

/**
 * The single place the allowlist lives. An entry is an exact host, or `*.suffix` which
 * matches any host with at least one extra label before `suffix` (never `suffix` itself,
 * never a host merely ending in the same letters).
 *
 * Safari: `web.push.apple.com` (observed in the T1 spike). Edge: `*.notify.windows.com`
 * per plan, NOT yet observed on a real Edge, confirmed or amended in T12.
 */
export const PUSH_ENDPOINT_HOSTS: readonly string[] = [
  "fcm.googleapis.com",
  "*.push.services.mozilla.com",
  "web.push.apple.com",
  "*.notify.windows.com",
];

export const MAX_PUSH_ENDPOINT_LENGTH = 2000;

// Printable ASCII only: the WHATWG URL parser silently strips tabs/newlines and maps
// "\" to "/" and Unicode dots to ".", each a way to smuggle another host past a check.
const PRINTABLE_ASCII_NO_BACKSLASH = /^[\x21-\x5b\x5d-\x7e]+$/;

function hostAllowed(hostname: string): boolean {
  return PUSH_ENDPOINT_HOSTS.some((entry) => {
    if (!entry.startsWith("*.")) return hostname === entry;
    const suffix = entry.slice(1); // ".push.services.mozilla.com"
    return hostname.length > suffix.length && hostname.endsWith(suffix);
  });
}

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (typeof endpoint !== "string") return false;
  if (endpoint.length === 0 || endpoint.length > MAX_PUSH_ENDPOINT_LENGTH) return false;
  if (!PRINTABLE_ASCII_NO_BACKSLASH.test(endpoint)) return false;

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.port !== "") return false; // an explicit default port is normalised away by URL
  return hostAllowed(url.hostname);
}
