/** The due-date reminder clock: Zurich calendar dates, the 08:00 boundary, DST days. Pure, no database. */
import { describe, expect, it } from "bun:test";
import { isDue, nextDay, reminderDueDate, zurichNow } from "./dueReminderClock";

const task = (over: Partial<Parameters<typeof isDue>[0]> = {}) => ({
  type: "task",
  dueDate: new Date("2026-11-27T00:00:00Z"),
  completedAt: null,
  dueReminderSentFor: null,
  ...over,
});

describe("zurichNow / nextDay", () => {
  it("reads Zurich's wall clock in winter (UTC+1) and summer (UTC+2)", () => {
    expect(zurichNow(new Date("2026-11-26T07:00:00Z"))).toEqual({ date: "2026-11-26", hour: 8 });
    expect(zurichNow(new Date("2026-07-01T06:00:00Z"))).toEqual({ date: "2026-07-01", hour: 8 });
    // 23:30 UTC is already the next day in Zurich.
    expect(zurichNow(new Date("2026-11-26T23:30:00Z"))).toEqual({ date: "2026-11-27", hour: 0 });
  });

  it("counts calendar days across month and year ends", () => {
    expect(nextDay("2026-11-30")).toBe("2026-12-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
  });
});

describe("reminderDueDate: 08:00 Europe/Zurich", () => {
  it("nothing at 07:59, tomorrow from 08:00 (winter)", () => {
    expect(reminderDueDate(new Date("2026-11-26T06:59:59Z"))).toBeNull();
    expect(reminderDueDate(new Date("2026-11-26T07:00:00Z"))).toBe("2026-11-27");
    expect(reminderDueDate(new Date("2026-11-26T22:59:00Z"))).toBe("2026-11-27");
  });

  it("nothing at 07:59, tomorrow from 08:00 (summer)", () => {
    expect(reminderDueDate(new Date("2026-07-01T05:59:59Z"))).toBeNull();
    expect(reminderDueDate(new Date("2026-07-01T06:00:00Z"))).toBe("2026-07-02");
  });

  it("on the spring-forward day (29.03.2026, 02:00 → 03:00) 08:00 is 06:00 UTC", () => {
    expect(reminderDueDate(new Date("2026-03-29T05:59:00Z"))).toBeNull();
    expect(reminderDueDate(new Date("2026-03-29T06:00:00Z"))).toBe("2026-03-30");
    // The evening before the change, still winter time.
    expect(reminderDueDate(new Date("2026-03-28T06:59:00Z"))).toBeNull();
    expect(reminderDueDate(new Date("2026-03-28T07:00:00Z"))).toBe("2026-03-29");
  });

  it("on the fall-back day (25.10.2026, 03:00 → 02:00) 08:00 is 07:00 UTC", () => {
    expect(reminderDueDate(new Date("2026-10-25T06:59:00Z"))).toBeNull();
    expect(reminderDueDate(new Date("2026-10-25T07:00:00Z"))).toBe("2026-10-26");
    // The day before, still summer time.
    expect(reminderDueDate(new Date("2026-10-24T05:59:00Z"))).toBeNull();
    expect(reminderDueDate(new Date("2026-10-24T06:00:00Z"))).toBe("2026-10-25");
  });
});

describe("isDue", () => {
  const at0800 = new Date("2026-11-26T07:00:00Z");

  it("an open task due tomorrow, from 08:00, not yet reminded", () => {
    expect(isDue(task(), at0800)).toBe(true);
    expect(isDue(task(), new Date("2026-11-26T06:59:00Z"))).toBe(false);
    expect(isDue(task({ dueDate: "2026-11-27" }), at0800)).toBe(true);
  });

  it("never for a task due today, in the past, or later than tomorrow", () => {
    for (const d of ["2026-11-26", "2026-11-20", "2026-11-28"]) expect(isDue(task({ dueDate: d }), at0800)).toBe(false);
  });

  it("never for a done task, a task without a due date, or another type", () => {
    expect(isDue(task({ completedAt: new Date("2026-11-25T10:00:00Z") }), at0800)).toBe(false);
    expect(isDue(task({ dueDate: null }), at0800)).toBe(false);
    expect(isDue(task({ type: "note" }), at0800)).toBe(false);
  });

  it("once per due date: reminded for this date no, for an earlier date yes", () => {
    expect(isDue(task({ dueReminderSentFor: new Date("2026-11-27T00:00:00Z") }), at0800)).toBe(false);
    expect(isDue(task({ dueReminderSentFor: "2026-11-20" }), at0800)).toBe(true);
  });
});
