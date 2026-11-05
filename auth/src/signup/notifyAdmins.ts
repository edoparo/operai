/**
 * Tell every effective admin that someone asked to join (specs/023 AC-4.1, AC-4.3;
 * ADR-0072). Recipients are `getEffectiveAdminUserIds` (direct role or via a
 * department, active users only). Each goes to notify-api's
 * `POST /system/notifications` with `email: true`; notify-api resolves the
 * address, so `auth` sends none.
 *
 * Best effort and never throws: the caller starts it WITHOUT awaiting, so the
 * person's redirect never waits on notify-api, and a failure only leaves a log
 * line. The log carries the request id and the recipient id, never the
 * requester's email or name (data residency; same posture as `logSessionDenied`).
 */

import { ADMIN_ROLE_NAME, getEffectiveAdminUserIds } from "../admin/lastAdminGuard";
import { db } from "../lib/db";
import { pushSystemNotification } from "../lib/notify";

export const ACCESS_REQUESTS_LINK = "/admin/users/access-requests";

export interface AccessRequestNotice {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

const TITLE_PREFIX = "Access request from ";
const TITLE_MAX = 200;

function logNotifyFailed(fields: { accessRequestId: string; recipientId?: string; error: string }): void {
  console.log(
    JSON.stringify({
      event: "auth.access_request_notify_failed",
      accessRequestId: fields.accessRequestId,
      ...(fields.recipientId ? { recipientId: fields.recipientId } : {}),
      error: fields.error,
      timestamp: new Date().toISOString(),
    }),
  );
}

/** Every active user holding `admin` directly or through a department. */
async function listEffectiveAdminIds(): Promise<ReadonlySet<string>> {
  const adminRole = await db.role.findUnique({ where: { name: ADMIN_ROLE_NAME }, select: { id: true } });
  return adminRole ? getEffectiveAdminUserIds(db, adminRole.id) : new Set();
}

export async function notifyAdminsOfAccessRequest(
  request: AccessRequestNotice,
  /** Injectable so a recipient-lookup failure can be tested without breaking the shared client. */
  listAdminIds: () => Promise<ReadonlySet<string>> = listEffectiveAdminIds,
): Promise<void> {
  try {
    const adminIds = await listAdminIds();

    await Promise.all(
      [...adminIds].map(async (recipientId) => {
        const result = await pushSystemNotification({
          recipientId,
          originApp: "admin",
          severity: "info",
          title: (TITLE_PREFIX + request.name).slice(0, TITLE_MAX),
          body: `${request.email} asked to join Operai. Review it in Admin › Users › Access requests.`,
          link: { href: ACCESS_REQUESTS_LINK },
          email: true,
        });
        if (result.status === "failed") {
          logNotifyFailed({ accessRequestId: request.id, recipientId, error: result.error });
        }
      }),
    );
  } catch (error) {
    logNotifyFailed({
      accessRequestId: request.id,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
