/**
 * Push channel (T6, specs/029-push-notifications, ADR-0084).
 *
 * A THIRD delivery of a notification that `inAppChannel.send` has already persisted and
 * published: it encrypts the notification for each of the recipient's registered browsers
 * and hands it to that browser's push service (Web Push, VAPID; the service worker decides
 * whether to show it, ADR-0085). It is best effort and strictly after the fact:
 *
 *  - `dispatch` NEVER throws and is never awaited by the request that raised the
 *    notification (inApp.channel.ts), so a stalled push service cannot slow the 201.
 *  - Order: push off or origin excluded -> stop (AC-6.1, 6.4); no device -> stop (auth is
 *    not asked); recipient looked up in `auth` (ADR-0056 client): inactive -> every device
 *    of the user is deleted and nothing is sent; failed -> nothing is sent and nothing is
 *    deleted (fail closed, AC-5.2). Then one send per device, no retry (AC-2.6): 404/410
 *    from the push service delete that device (AC-2.7); any other status or error is logged
 *    and the device kept. Apple answers 201 for a subscription Safari has cancelled, so only
 *    404/410 prune.
 *  - The payload is the English title/body only (AC-2.5), exactly {v,id,title,body,originApp[,href]}
 *    (AC-6.2), serialised to at most MAX_PUSH_PAYLOAD_BYTES so the encrypted record fits the
 *    4 KB Web Push limit.
 *
 * LOGGING: a device id plus an HTTP status or an error CLASS, nothing else. Never the
 * endpoint, a key, the user id or any notification text.
 */

import { Effect } from "effect";
import { env } from "@/lib/env";
import { userContact, type UserContactClient } from "@/lib/userContact";
import type { NotificationDto } from "@/notifications/notifications.schemas";
import {
  deleteAllForUser,
  deleteById,
  listByUser,
  type PushDeviceRow,
} from "@/push/devices.repo";
import { createWebPushSender, type PushSender } from "@/push/webPushSender";

/** JSON bytes (UTF-8) of the plaintext payload; the 4 KB Web Push limit minus encryption overhead, with margin. */
export const MAX_PUSH_PAYLOAD_BYTES = 3000;

type PushPayload = {
  v: 1;
  id: string;
  title: string;
  body: string;
  originApp: string;
  href?: string;
};

const encoder = new TextEncoder();
const byteLength = (p: PushPayload): number => encoder.encode(JSON.stringify(p)).length;
const fits = (p: PushPayload): boolean => byteLength(p) <= MAX_PUSH_PAYLOAD_BYTES;

/** Longest code-point prefix of `field` (plus "…") that makes the payload fit; "" when even "…" does not. */
const shrink = (p: PushPayload, field: "title" | "body"): PushPayload => {
  if (fits(p)) return p;
  const points = Array.from(p[field]); // code points: never splits a surrogate pair
  const candidate = (n: number): PushPayload => ({ ...p, [field]: `${points.slice(0, n).join("")}…` });
  let lo = 0;
  let hi = points.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(candidate(mid))) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? candidate(best) : { ...p, [field]: "" };
};

const shrinkTextFields = (p: PushPayload): PushPayload => shrink(shrink(p, "body"), "title");

/**
 * The serialised payload. When it is too long the body is cut first, then the title, and as
 * a last resort the link is dropped (a click then opens /notify) so a notification is never
 * lost to its size.
 */
export function buildPushPayload(n: Pick<NotificationDto, "id" | "title" | "body" | "originApp" | "link">): string {
  const base: PushPayload = { v: 1, id: n.id, title: n.title, body: n.body, originApp: n.originApp };
  const withHref: PushPayload = n.link !== undefined ? { ...base, href: n.link.href } : base;
  let payload = shrinkTextFields(withHref);
  if (!fits(payload)) payload = shrinkTextFields(base);
  return JSON.stringify(payload);
}

export type PushChannelDeps = {
  enabled: boolean;
  excludedOrigins: readonly string[];
  devices: {
    listByUser(userId: string): Promise<PushDeviceRow[]>;
    deleteAllForUser(userId: string): Promise<unknown>;
    deleteById(id: string): Promise<unknown>;
  };
  contacts: UserContactClient | null;
  sender: PushSender | null;
  log: (message: string) => void;
};

export type PushNotification = Pick<NotificationDto, "id" | "title" | "body" | "originApp" | "link">;

export interface PushChannel {
  /** Never rejects. */
  dispatch(recipientId: string, notification: PushNotification): Promise<void>;
}

const errorClass = (error: unknown): string => (error instanceof Error ? error.name : "unknown error");

export function createPushChannel(deps: PushChannelDeps): PushChannel {
  const sendToDevice = async (device: PushDeviceRow, sender: PushSender, payload: string): Promise<void> => {
    try {
      const { status } = await sender.send(
        { endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth },
        payload,
      );
      if (status >= 200 && status < 300) return;
      if (status === 404 || status === 410) {
        await deps.devices.deleteById(device.id);
        return;
      }
      deps.log(`[push] device ${device.id} answered HTTP ${status} — kept, not retried`);
    } catch (error) {
      deps.log(`[push] device ${device.id} not delivered (${errorClass(error)}) — kept, not retried`);
    }
  };

  return {
    async dispatch(recipientId, notification) {
      try {
        const { sender } = deps;
        if (!deps.enabled || sender === null) return;
        if (deps.excludedOrigins.includes(notification.originApp)) return;

        const devices = await deps.devices.listByUser(recipientId);
        if (devices.length === 0) return;

        const contact = deps.contacts === null ? ({ status: "failed" } as const) : await deps.contacts.lookup(recipientId);
        if (contact.status === "inactive") {
          await deps.devices.deleteAllForUser(recipientId);
          return;
        }
        if (contact.status !== "found") return;

        const payload = buildPushPayload(notification);
        await Promise.all(devices.map((device) => sendToDevice(device, sender, payload)));
      } catch (error) {
        deps.log(`[push] dispatch failed (${errorClass(error)})`);
      }
    },
  };
}

const defaultSender = (): PushSender | null =>
  env.PUSH_ENABLED && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
    ? createWebPushSender({
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT,
      })
    : null;

/** Wired from the environment. Inert unless PUSH_ENABLED=true (env.ts guarantees the rest of the group then). */
export const pushChannel: PushChannel = createPushChannel({
  enabled: env.PUSH_ENABLED,
  excludedOrigins: env.PUSH_EXCLUDED_ORIGINS,
  devices: {
    listByUser: (userId) => Effect.runPromise(listByUser(userId)),
    deleteAllForUser: (userId) => Effect.runPromise(deleteAllForUser(userId)),
    deleteById: (id) => Effect.runPromise(deleteById(id)),
  },
  contacts: userContact,
  sender: defaultSender(),
  log: (message) => console.error(message),
});
