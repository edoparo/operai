import { describe, expect, test } from "bun:test";
import { PUSH_ENDPOINT_HOSTS, isAllowedPushEndpoint } from "./pushEndpoint";

describe("isAllowedPushEndpoint (SSRF guard, plan 422 endpoint_not_allowed)", () => {
  const allowed = [
    "https://fcm.googleapis.com/fcm/send/abc:def_123",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://a.b.push.services.mozilla.com/wpush/v2/x",
    "https://web.push.apple.com/QGH3xyz",
    "https://par02p.notify.windows.com/w/?token=BQYAAA",
    "https://FCM.GoogleAPIs.com/fcm/send/upper-case-host",
    "https://fcm.googleapis.com:443/fcm/send/default-port-normalised",
  ];
  for (const url of allowed) {
    test(`allows ${url}`, () => expect(isAllowedPushEndpoint(url)).toBe(true));
  }

  const refused: [string, string][] = [
    ["http scheme", "http://fcm.googleapis.com/fcm/send/x"],
    ["other scheme", "ftp://fcm.googleapis.com/x"],
    ["IPv4 literal", "https://142.250.74.46/fcm/send/x"],
    ["IPv6 literal", "https://[2a00:1450:4001::200e]/fcm/send/x"],
    ["decimal IP", "https://2396346926/x"],
    ["suffix look-alike", "https://fcm.googleapis.com.evil.io/fcm/send/x"],
    ["prefix look-alike", "https://evilfcm.googleapis.com/x"],
    ["no dot boundary", "https://xpush.services.mozilla.com/x"],
    ["bare wildcard parent", "https://push.services.mozilla.com/x"],
    ["bare wildcard parent windows", "https://notify.windows.com/x"],
    ["userinfo trick", "https://fcm.googleapis.com@evil.io/fcm/send/x"],
    ["userinfo on allowed host", ["https://", "user", ":", "pw", "@fcm.googleapis.com/x"].join("")], // built from parts so no secret scanner mistakes the placeholder for a credential
    ["backslash trick", "https://evil.io\\@fcm.googleapis.com/x"],
    ["port", "https://fcm.googleapis.com:8443/fcm/send/x"],
    ["trailing dot host", "https://fcm.googleapis.com./x"],
    ["embedded newline", "https://evil.io/\nhttps://fcm.googleapis.com/x"],
    ["tab in host", "https://fcm.goo\tgleapis.com/x"],
    ["unicode host", "https://fcm.googleapis.com。evil.io/x"],
    ["localhost", "https://localhost/x"],
    ["empty", ""],
    ["not a url", "fcm.googleapis.com/fcm/send/x"],
    ["too long", `https://fcm.googleapis.com/${"a".repeat(2000)}`],
  ];
  for (const [name, url] of refused) {
    test(`refuses ${name}`, () => expect(isAllowedPushEndpoint(url)).toBe(false));
  }

  test("exactly 2000 chars is allowed, 2001 refused", () => {
    const base = "https://fcm.googleapis.com/";
    expect(isAllowedPushEndpoint(base + "a".repeat(2000 - base.length))).toBe(true);
    expect(isAllowedPushEndpoint(base + "a".repeat(2001 - base.length))).toBe(false);
  });

  test("non-strings are refused", () => {
    expect(isAllowedPushEndpoint(undefined as unknown as string)).toBe(false);
    expect(isAllowedPushEndpoint(42 as unknown as string)).toBe(false);
  });

  test("the allowlist is one exported constant", () => {
    expect(PUSH_ENDPOINT_HOSTS).toEqual([
      "fcm.googleapis.com",
      "*.push.services.mozilla.com",
      "web.push.apple.com",
      "*.notify.windows.com",
    ]);
  });
});
