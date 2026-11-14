/**
 * inApp channel (T2, specs/20260713-user-invitations, ADR 20260714-notify-api-email-channel-service-trust).
 *
 * TODAY'S notification behaviour (specs/20260713-notification-center) refactored behind the Channel
 * interface — UNCHANGED. Addresses a `sub` (recipientId): persists a
 * Notification row via notifications.repo.ts, then publishes it to every
 * open SSE stream for that sub via the EventBus (specs/20260713-notification-center T3).
 *
 * raise.routes.ts (POST /notifications, user-JWT) is the only caller. This
 * refactor moves the persist-then-publish sequence out of the route handler
 * and behind this channel, but the sequence itself, the Effect.runPromiseExit
 * failure handling, and the thrown-Error-on-failure shape (app.onError turns
 * it into a 500) are byte-for-behaviour identical to before — see
 * raise.routes.test.ts, which is unchanged and still exercises this exact
 * path end-to-end.
 *
 * T6 (specs/20261111-push-notifications) adds one step at the end of `send`: the push
 * dispatch, fire-and-forget (see the comment there).
 */

import { Effect } from "effect";
import { pushChannel } from "@/channels/push.channel";
import { eventBus } from "@/notifications/eventBus";
import {
  createNotification,
  type CreateNotificationInput,
} from "@/notifications/notifications.repo";
import type { NotificationDto } from "@/notifications/notifications.schemas";
import type { Channel } from "./channel";

export type InAppSendInput = CreateNotificationInput;

export const inAppChannel: Channel<InAppSendInput, NotificationDto> = {
  send: async (input) => {
    const exit = await Effect.runPromiseExit(createNotification(input));

    if (exit._tag === "Failure") {
      throw new Error("Unexpected database failure creating notification");
    }

    const created = exit.value;

    // Publish AFTER persistence succeeds — the DB is the source of truth
    // (specs/20260713-notification-center plan.md Risk R3/R5); a dropped publish never loses the
    // notification, only the live push.
    eventBus.publish(input.recipientId, {
      type: "notification",
      data: created,
    });

    // Web push (specs/20261111-push-notifications, ADR 20261111-web-push-encrypted-payloads-not-fcm): a best-effort third delivery AFTER the row is stored
    // and published. Deliberately not awaited, so a slow push service never delays the
    // response, and shielded so that nothing it does can fail the request (AC-2.6).
    // `pushChannel.dispatch` is looked up per call, so tests can replace it.
    try {
      void pushChannel.dispatch(input.recipientId, created).catch(() => {});
    } catch {
      // a synchronous failure of the push channel is as irrelevant as an async one
    }

    return created;
  },
};
