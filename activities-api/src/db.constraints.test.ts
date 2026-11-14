/**
 * The rules the schema itself enforces (specs/20261110-activities T2): Prisma cannot express CHECKs, so the
 * initial migration adds them by hand, and these tests prove at the DATABASE that each one
 * refuses what the model forbids. Each refusal is asserted by its constraint's NAME, so a row
 * refused for some other reason (a missing column, a bad enum) cannot pass for it; each rule
 * also has its accepted neighbour, so the refusal is the rule and not the fixture.
 *
 * Runs against the `*_test` database (src/test-support/env.ts, the `bun test` preload).
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "./lib/db";
import type { Prisma } from "./lib/generated/prisma/client";

beforeEach(async () => {
  await db.taskBlocker.deleteMany();
  await db.activityParticipant.deleteMany();
  await db.activity.deleteMany();
});

const date = (iso: string) => new Date(`${iso}T00:00:00Z`);
const at = new Date("2026-11-01T10:00:00Z");

/** A valid pre-sales note on a CRM company; `over` is applied last. */
const crmData = (over: Partial<Prisma.ActivityUncheckedCreateInput> = {}): Prisma.ActivityUncheckedCreateInput => ({
  kind: "pre_sales",
  type: "note",
  hostApp: "crm",
  hostType: "company",
  hostId: "company-1",
  subject: "Call notes",
  occurredAt: at,
  authorUserId: "user-1",
  ...over,
});

/** A valid operational task on a project; `over` is applied last. */
const projectData = (over: Partial<Prisma.ActivityUncheckedCreateInput> = {}): Prisma.ActivityUncheckedCreateInput => ({
  kind: "operational",
  type: "task",
  hostApp: "projects",
  hostType: "project",
  hostId: "project-1",
  subject: "Set up CI",
  occurredAt: at,
  authorUserId: "user-1",
  ...over,
});

const make = (data: Prisma.ActivityUncheckedCreateInput) => db.activity.create({ data });

/** The error a refused write carries: Prisma wraps the driver's, so match on the text. */
const refusal = (constraint: string) => expect.objectContaining({ message: expect.stringContaining(constraint) });
/** A Prisma query is a lazy thenable, not a Promise: run it inside an async function so `rejects` can see it. */
const refusedBy = (constraint: string, write: PromiseLike<unknown>) =>
  expect(
    (async () => {
      await write;
    })(),
  ).rejects.toEqual(refusal(constraint));

describe("activity_host_shape", () => {
  const SHAPE = "activity_host_shape";

  it("accepts a CRM activity of every type and a project task", async () => {
    for (const type of ["note", "call", "meeting", "email", "task"] as const) {
      expect((await make(crmData({ type }))).type).toBe(type);
    }
    expect((await make(crmData({ contactId: "contact-1", dealId: "deal-1" }))).contactId).toBe("contact-1");
    expect((await make(projectData())).kind).toBe("operational");
  });

  it("refuses a project activity that is not a task (AC-3.6)", async () => {
    for (const type of ["note", "call", "meeting", "email"] as const) {
      await refusedBy(SHAPE, make(projectData({ type })));
    }
  });

  it("refuses a project task with a contact, a deal or a meeting", async () => {
    await refusedBy(SHAPE, make(projectData({ contactId: "contact-1" })));
    await refusedBy(SHAPE, make(projectData({ dealId: "deal-1" })));
    // meetingId needs type=meeting for its own CHECK, so a project task with one is refused by the
    // host shape (type is not task) AND by the meeting rule: either way it never lands.
    await refusedBy(SHAPE, make(projectData({ type: "meeting", meetingId: "m1" })));
    expect(await db.activity.count()).toBe(0);
  });

  it("refuses a CRM activity that is operational, or a project that is pre-sales", async () => {
    await refusedBy(SHAPE, make(crmData({ kind: "operational" })));
    await refusedBy(SHAPE, make(projectData({ kind: "pre_sales" })));
  });

  it("refuses a host reference of the wrong entity type for its app", async () => {
    await refusedBy(SHAPE, make(crmData({ hostType: "project" })));
    await refusedBy(SHAPE, make(projectData({ hostType: "company" })));
    await refusedBy(SHAPE, make(crmData({ hostType: "deal" })));
  });
});

describe("activity_task_fields_only_on_tasks", () => {
  const RULE = "activity_task_fields_only_on_tasks";

  it("accepts task fields on a task and none on a note", async () => {
    const done = await make(
      crmData({ type: "task", dueDate: date("2026-12-01"), assigneeUserId: "user-2", completedAt: at, completedByUserId: "user-2" }),
    );
    expect(done.assigneeUserId).toBe("user-2");
    expect((await make(crmData())).dueDate).toBeNull();
  });

  it("refuses a due date, an assignee or a completion on a note", async () => {
    await refusedBy(RULE, make(crmData({ dueDate: date("2026-12-01") })));
    await refusedBy(RULE, make(crmData({ assigneeUserId: "user-2" })));
    await refusedBy(RULE, make(crmData({ completedAt: at, completedByUserId: "user-2" })));
  });
});

describe("activity_completion_pair", () => {
  const RULE = "activity_completion_pair";

  it("accepts both completion fields or neither", async () => {
    expect((await make(crmData({ type: "task" }))).completedAt).toBeNull();
    expect((await make(crmData({ type: "task", completedAt: at, completedByUserId: "user-1" }))).completedAt).toEqual(at);
  });

  it("refuses one without the other", async () => {
    await refusedBy(RULE, make(crmData({ type: "task", completedAt: at })));
    await refusedBy(RULE, make(crmData({ type: "task", completedByUserId: "user-1" })));
  });
});

describe("activity_meeting_id_only_on_meetings", () => {
  const RULE = "activity_meeting_id_only_on_meetings";

  it("accepts a meetingId on a meeting activity", async () => {
    expect((await make(crmData({ type: "meeting", meetingId: "m1" }))).meetingId).toBe("m1");
  });

  it("refuses a meetingId on any other type", async () => {
    for (const type of ["note", "call", "email", "task"] as const) {
      await refusedBy(RULE, make(crmData({ type, meetingId: "m1" })));
    }
  });

  it("allows at most one activity per meeting", async () => {
    await make(crmData({ type: "meeting", meetingId: "m1" }));
    await expect(
      (async () => {
        await make(crmData({ type: "meeting", meetingId: "m1" }));
      })(),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("task_blocker_not_self", () => {
  it("accepts a blocker between two tasks and refuses a task blocking itself", async () => {
    const a = await make(projectData());
    const b = await make(projectData({ subject: "Deploy" }));
    await db.taskBlocker.create({ data: { blockedId: a.id, blockerId: b.id, createdBy: "user-1" } });
    await refusedBy("task_blocker_not_self", db.taskBlocker.create({ data: { blockedId: a.id, blockerId: a.id, createdBy: "user-1" } }));
  });

  it("removes the link when either task is deleted", async () => {
    const a = await make(projectData());
    const b = await make(projectData({ subject: "Deploy" }));
    await db.taskBlocker.create({ data: { blockedId: a.id, blockerId: b.id, createdBy: "user-1" } });
    await db.activity.delete({ where: { id: b.id } });
    expect(await db.taskBlocker.count()).toBe(0);
  });
});
