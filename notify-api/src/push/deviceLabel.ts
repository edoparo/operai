/**
 * Human label for a registered device, derived from the User-Agent header (T4,
 * specs/20261111-push-notifications, AC-3.1 / AC-6.3): "Chrome · macOS". The UA is
 * attacker-controlled text, so it is only ever matched, never echoed: the output is
 * built from the fixed strings below.
 */

const MAX_UA_LENGTH = 512;
export const UNKNOWN_DEVICE_LABEL = "Unknown browser";

// Order matters: Edge and Firefox UAs also contain "Chrome"/"Safari"; Chrome's contains "Safari".
// Browsers built on Chromium but not supported for push labels (Opera, ...) are unknown.
function browserOf(ua: string): string | null {
  if (/\bOPR\/|\bOPT\/|\bVivaldi\/|\bSamsungBrowser\//.test(ua)) return null;
  if (/\b(Edg|EdgA|EdgiOS|Edge)\//.test(ua)) return "Edge";
  if (/\b(Firefox|FxiOS)\//.test(ua)) return "Firefox";
  if (/\b(Chrome|CriOS)\//.test(ua)) return "Chrome";
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return "Safari";
  return null;
}

// Android and iOS UAs also say "Linux"/"Mac OS X", so they come first.
function osOf(ua: string): string | null {
  if (/\bAndroid\b/.test(ua)) return "Android";
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return "iOS";
  if (/\bWindows\b/.test(ua)) return "Windows";
  if (/\bMacintosh\b|\bMac OS X\b/.test(ua)) return "macOS";
  if (/\bCrOS\b/.test(ua)) return "ChromeOS";
  if (/\bLinux\b|\bX11\b/.test(ua)) return "Linux";
  return null;
}

export function deviceLabel(userAgent: string | null | undefined): string {
  if (typeof userAgent !== "string" || userAgent === "") return UNKNOWN_DEVICE_LABEL;
  const ua = userAgent.slice(0, MAX_UA_LENGTH);
  const browser = browserOf(ua);
  if (browser === null) return UNKNOWN_DEVICE_LABEL;
  const os = osOf(ua);
  return os === null ? browser : `${browser} · ${os}`;
}
