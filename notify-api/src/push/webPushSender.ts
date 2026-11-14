/**
 * Web Push sender (T6, specs/20261111-push-notifications, ADR 20261111-web-push-encrypted-payloads-not-fcm).
 *
 * `web-push` does the cryptography (RFC 8291 `aes128gcm` payload encryption, RFC 8292
 * VAPID); the HTTP request is OURS so that it is injectable (tests never reach a push
 * service), has a hard timeout, never follows a redirect, and is the only place a
 * subscription endpoint is contacted. Under Bun `web-push` must be imported as a
 * namespace: the default import fails (T1 spike).
 *
 * SECURITY: the endpoint is re-checked against the allowlist (SSRF, T4) even though the
 * registration route already did, so a row that predates a tightened allowlist is never
 * contacted. Errors thrown here can name the endpoint (URL parse errors, for one), so the
 * caller logs the error CLASS only.
 */

import * as webpush from "web-push";
import { isAllowedPushEndpoint } from "./pushEndpoint";

export const PUSH_TTL_SECONDS = 86_400;
export const PUSH_TIMEOUT_MS = 10_000;

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

export type PushTransportRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: Uint8Array;
  timeoutMs: number;
};

export type PushTransport = (req: PushTransportRequest) => Promise<{ status: number }>;

/** Sends one already-serialised payload to one subscription. Rejects on any failure to deliver a request. */
export interface PushSender {
  send(target: PushTarget, payload: string): Promise<{ status: number }>;
}

/** The production transport: fetch, bounded by a timeout, redirects are not followed (a 3xx is just a status). */
export const fetchTransport: PushTransport = async (req) => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    redirect: "manual",
    signal: AbortSignal.timeout(req.timeoutMs),
  });
  await res.body?.cancel().catch(() => {});
  return { status: res.status };
};

export type WebPushSenderOptions = {
  publicKey: string;
  privateKey: string;
  subject: string;
  transport?: PushTransport;
  timeoutMs?: number;
};

export function createWebPushSender(options: WebPushSenderOptions): PushSender {
  const transport = options.transport ?? fetchTransport;
  const timeoutMs = options.timeoutMs ?? PUSH_TIMEOUT_MS;
  const vapidDetails = {
    subject: options.subject,
    publicKey: options.publicKey,
    privateKey: options.privateKey,
  };

  return {
    async send(target, payload) {
      if (!isAllowedPushEndpoint(target.endpoint)) throw new Error("endpoint_not_allowed");

      const details = webpush.generateRequestDetails(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        { vapidDetails, TTL: PUSH_TTL_SECONDS, contentEncoding: "aes128gcm" },
      );

      // Content-Length is the transport's to compute from the body it sends.
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(details.headers)) {
        if (name.toLowerCase() !== "content-length") headers[name] = String(value);
      }

      return transport({
        url: details.endpoint,
        method: "POST",
        headers,
        body: new Uint8Array(details.body),
        timeoutMs,
      });
    },
  };
}
