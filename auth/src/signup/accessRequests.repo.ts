/**
 * The waiting list's write side (specs/023, ADR-0071). `recordAccessRequest`
 * follows plan.md's state table. It writes through the module `db` client, NOT
 * through better-auth's transaction: the sign-up gate throws right after, which
 * rolls that transaction back, and the request must survive (T-INT-2).
 */

import { db } from "../lib/db";
import { notifyAdminsOfAccessRequest } from "./notifyAdmins";
import type { AccessRequestNotice } from "./notifyAdmins";

export type AccessRequestProvider = "google" | "github" | "unknown";
export type RecordedStatus = "pending" | "rejected";

export interface RecordAccessRequestInput {
  /** Already lower-cased by better-auth; lower-cased again here defensively. */
  readonly email: string;
  readonly name: string | null | undefined;
  readonly provider: AccessRequestProvider;
}

export interface RecordAccessRequestResult {
  readonly id: string;
  /** What the person is told: still waiting, or turned down. */
  readonly status: RecordedStatus;
}

const NAME_MAX = 200;

/** Trimmed, at most 200 characters, falling back to the email's local part. */
export function displayNameFor(name: string | null | undefined, email: string): string {
  const trimmed = (name ?? "").trim().slice(0, NAME_MAX).trim();
  return trimmed.length > 0 ? trimmed : email.slice(0, email.lastIndexOf("@")).slice(0, NAME_MAX);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/** Fire and forget: `notifyAdminsOfAccessRequest` never throws, the catch is belt and braces. */
function notifyWithoutWaiting(notify: Notify, notice: AccessRequestNotice): void {
  void Promise.resolve(notify(notice)).catch(() => {});
}

type Notify = (request: AccessRequestNotice) => Promise<void>;

export async function recordAccessRequest(
  input: RecordAccessRequestInput,
  notify: Notify = notifyAdminsOfAccessRequest,
): Promise<RecordAccessRequestResult> {
  const email = input.email.trim().toLowerCase();
  const name = displayNameFor(input.name, email);
  const { provider } = input;
  const now = new Date();

  const existing = await db.accessRequest.findUnique({ where: { email } });
  if (!existing) {
    try {
      const created = await db.accessRequest.create({
        data: { email, name, provider, status: "pending", requestedAt: now, firstRequestedAt: now },
      });
      notifyWithoutWaiting(notify, { id: created.id, email, name });
      return { id: created.id, status: "pending" };
    } catch (error) {
      // A concurrent first attempt won the unique index: take its row. Only
      // the winner notifies, so exactly one notice goes out.
      if (!isUniqueViolation(error)) throw error;
      const winner = await db.accessRequest.findUniqueOrThrow({ where: { email } });
      return settleExisting(winner, { email, name, provider, now }, notify, false);
    }
  }
  return settleExisting(existing, { email, name, provider, now }, notify, true);
}

async function settleExisting(
  row: { id: string; status: string },
  attempt: { email: string; name: string; provider: AccessRequestProvider; now: Date },
  notify: Notify,
  mayNotify: boolean,
): Promise<RecordAccessRequestResult> {
  const { email, name, provider, now } = attempt;

  if (row.status === "rejected") return { id: row.id, status: "rejected" };

  if (row.status === "approved") {
    // Its invitation is no longer live (a live one would have let the person in
    // at step 2). CAS so two concurrent attempts reopen it, and notify, once.
    const reopened = await db.accessRequest.updateMany({
      where: { id: row.id, status: "approved" },
      data: {
        status: "pending",
        requestedAt: now,
        name,
        provider,
        decidedAt: null,
        decidedByUserId: null,
        invitationId: null,
      },
    });
    if (reopened.count === 1 && mayNotify) notifyWithoutWaiting(notify, { id: row.id, email, name });
    if (reopened.count === 1) return { id: row.id, status: "pending" };
    // Lost the CAS: whoever won decided the state we report.
    const current = await db.accessRequest.findUniqueOrThrow({ where: { id: row.id } });
    return { id: row.id, status: current.status === "rejected" ? "rejected" : "pending" };
  }

  // pending: refresh the attempt, no notice (AC-2.2, AC-4.2). The CAS keeps a
  // concurrent rejection from being overwritten.
  await db.accessRequest.updateMany({
    where: { id: row.id, status: "pending" },
    data: { requestedAt: now, name, provider },
  });
  return { id: row.id, status: "pending" };
}
