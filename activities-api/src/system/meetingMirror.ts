/**
 * The meeting activity of a deal (specs/20261110-activities AC-1.4; carried over from crm-api's
 * `meeting-host/notices.routes.ts`, specs/20261104-meetings US-14, ADR 20261104-meeting-host-contract-resolve-and-notices): meetings-api tells the CRM that a
 * meeting was linked, changed, relinked, unlinked or deleted, crm-api validates the deal and
 * forwards the notice here, and the meeting is mirrored as ONE `meeting` activity found by
 * `activity.meetingId` (UNIQUE).
 *
 * Everything runs in one transaction under `pg_advisory_xact_lock(hash(meetingId))`, so concurrent
 * deliveries for the same meeting serialise, and notices are ordered by `seq` through
 * `meeting_mirror_state`. The guard now lives WITH the data (ADR 20261110-caller-chosen-ids-replace-cross-service-transactions): the state and the
 * activity commit together, so a failed write never advances the guard (which would lose the
 * change) and a repeated delivery never writes twice.
 *
 *   seq <= lastSeq   nothing happens, `{ applied: false }` (duplicates, retries and reordering
 *                    are harmless)
 *   linked           upsert the activity (a relink MOVES it to the new deal and its company)
 *   changed          update subject and occurredAt IF the row exists; never recreates one its
 *                    author deleted by hand
 *   unlinked         delete the row if it is on that deal
 *   deleted          delete the row wherever it is
 *
 * Every applied event then sets `lastSeq = seq`, `deleted` included, so a late lower-seq
 * `linked` cannot bring a deleted meeting back.
 */

import { db } from "../lib/db";

export type MeetingEvent = "linked" | "changed" | "unlinked" | "deleted";

export interface MeetingNotice {
  readonly seq: number;
  readonly event: MeetingEvent;
  readonly meeting: {
    readonly id: string;
    readonly title: string | null;
    readonly startsAt: string | null;
    readonly creatorId: string;
  };
  readonly deal: { readonly id: string; readonly companyId?: string | undefined };
}

/** True when the notice was applied, false when it was a duplicate or older than one applied. */
export async function reconcileMeeting(notice: MeetingNotice): Promise<boolean> {
  const { seq, event, meeting, deal } = notice;
  return db.$transaction(async (tx) => {
    // One delivery per meeting at a time. The lock also covers the very first notice, when there
    // is no state row to lock yet. (`$executeRaw`: the function returns void.)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${meeting.id}, 0))`;

    const state = await tx.meetingMirrorState.findUnique({ where: { meetingId: meeting.id } });
    if (state && seq <= state.lastSeq) return false;

    if (event === "linked") {
      // The route's schema requires the company for `linked`.
      const companyId = deal.companyId!;
      const occurredAt = new Date(meeting.startsAt!);
      const existing = await tx.activity.findUnique({ where: { meetingId: meeting.id }, select: { id: true, hostId: true } });
      if (existing) {
        await tx.activity.update({
          where: { id: existing.id },
          data: {
            subject: meeting.title!,
            occurredAt,
            hostId: companyId,
            dealId: deal.id,
            // A contact belongs to the company the activity is on (specs/20261101-crm AC-4.1).
            ...(existing.hostId !== companyId ? { contactId: null } : {}),
          },
        });
      } else {
        await tx.activity.create({
          data: {
            kind: "pre_sales",
            type: "meeting",
            hostApp: "crm",
            hostType: "company",
            hostId: companyId,
            dealId: deal.id,
            subject: meeting.title!,
            body: null,
            occurredAt,
            authorUserId: meeting.creatorId,
            meetingId: meeting.id,
          },
        });
      }
    } else if (event === "changed") {
      await tx.activity.updateMany({
        where: { meetingId: meeting.id },
        data: { subject: meeting.title!, occurredAt: new Date(meeting.startsAt!) },
      });
    } else if (event === "unlinked") {
      await tx.activity.deleteMany({ where: { meetingId: meeting.id, dealId: deal.id } });
    } else {
      await tx.activity.deleteMany({ where: { meetingId: meeting.id } });
    }

    await tx.meetingMirrorState.upsert({
      where: { meetingId: meeting.id },
      create: { meetingId: meeting.id, lastSeq: seq },
      update: { lastSeq: seq },
    });
    return true;
  });
}
