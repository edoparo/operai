import { describe, expect, test } from "bun:test";
import { deviceLabel } from "./deviceLabel";

const UA = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  chromeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  chromeLinux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  edgeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  edgeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.46",
  edgeLinux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
  firefoxWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  firefoxLinux: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  opera:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0",
};

describe("deviceLabel", () => {
  const table: [string, string][] = [
    [UA.chromeMac, "Chrome · macOS"],
    [UA.chromeWin, "Chrome · Windows"],
    [UA.chromeLinux, "Chrome · Linux"],
    [UA.edgeMac, "Edge · macOS"],
    [UA.edgeWin, "Edge · Windows"],
    [UA.edgeLinux, "Edge · Linux"],
    [UA.firefoxMac, "Firefox · macOS"],
    [UA.firefoxWin, "Firefox · Windows"],
    [UA.firefoxLinux, "Firefox · Linux"],
    [UA.safariMac, "Safari · macOS"],
    [UA.chromeAndroid, "Chrome · Android"],
    [UA.safariIos, "Safari · iOS"],
  ];
  for (const [ua, label] of table) {
    test(label, () => expect(deviceLabel(ua)).toBe(label));
  }

  test("known browser, unknown OS drops the OS", () => {
    expect(deviceLabel("Mozilla/5.0 (PlayStation) Firefox/132.0")).toBe("Firefox");
  });

  test("unknown browsers and absent headers are 'Unknown browser'", () => {
    expect(deviceLabel(UA.opera)).toBe("Unknown browser");
    expect(deviceLabel("curl/8.4.0")).toBe("Unknown browser");
    expect(deviceLabel("")).toBe("Unknown browser");
    expect(deviceLabel(undefined)).toBe("Unknown browser");
    expect(deviceLabel(null)).toBe("Unknown browser");
  });

  test("a hostile, oversized header is bounded and labelled from fixed strings only", () => {
    const label = deviceLabel(`Firefox/1 <script>${"x".repeat(100_000)}`);
    expect(label).toBe("Firefox");
  });
});
