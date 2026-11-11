/**
 * Security re-review lows: a catch block that logs a failure logs the error's NAME and CODE only,
 * like the global handler (index.ts), never its message. A database or driver message can carry
 * the statement and its parameters, which are free text about clients.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { announceUnblocked } from "../activities/blockers";
import { announce, setNotifierForTests } from "./notify";
import { call, db, makeCompany, resetWorld } from "../test-support/world";

const SECRET = "Renewal talk with ACME about the Zurich site";
const secretError = () => Object.assign(new Error(`could not insert ${SECRET}`), { name: "PrismaClientKnownRequestError", code: "P2002" });
const ctx = (get: (key: "userId") => string = () => "actor") => ({ get, req: { header: (_name: string) => undefined as string | undefined } });

async function logged(fn: () => Promise<void>): Promise<string> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines.join("\n");
}

beforeEach(async () => {
  await resetWorld();
  setNotifierForTests({ notify: async () => {} });
});
afterEach(() => setNotifierForTests(null));

describe("announceUnblocked (blockers.ts)", () => {
  it("looking the freed tasks up fails: the log has the error name and code, not its message", async () => {
    const failing = new Proxy([] as string[], {
      get() {
        throw secretError();
      },
    });
    const out = await logged(() => announceUnblocked(ctx(), failing, () => ({}) as never));
    expect(out).toContain("[blockers] could not look up");
    expect(out).toContain("PrismaClientKnownRequestError");
    expect(out).toContain("P2002");
    expect(out).not.toContain(SECRET);
  });

  it("announcing one freed task fails: the log has the task id, the error name and code, not its message", async () => {
    const company = makeCompany();
    const create = async (extra: Record<string, unknown>) => {
      const res = await call("POST", "/activities", { as: "admin", body: { type: "task", subject: "Task", companyId: company.id, ...extra } });
      expect(res.status).toBe(201);
      return res.json as { id: string };
    };
    const blocker = await create({ subject: "Estimate" });
    const waiting = await create({ subject: "Call", assigneeUserId: "user-tech", blockedByIds: [blocker.id] });
    await db.activity.update({ where: { id: blocker.id }, data: { completedAt: new Date(), completedByUserId: "user-tech" } });
    const out = await logged(() =>
      announceUnblocked(ctx(), [blocker.id], () => {
        throw secretError();
      }),
    );
    expect(out).toContain(`could not announce task_unblocked for ${waiting.id}`);
    expect(out).toContain("PrismaClientKnownRequestError");
    expect(out).toContain("P2002");
    expect(out).not.toContain(SECRET);
  });
});

describe("announce (notify.ts)", () => {
  it("a failure while preparing the notification: the log has the error name and code, not its message", async () => {
    const out = await logged(() =>
      announce(
        ctx(() => {
          throw secretError();
        }),
        {
          kind: "task_assigned",
          activityId: "act-1",
          recipientIds: ["a"],
          activity: { id: "act-1", type: "task", subject: "S", dueDate: null, hostApp: "crm", hostType: "company", hostId: "c" } as never,
          target: { kind: "company", name: "Acme" } as never,
        },
      ),
    );
    expect(out).toContain("[notify] could not prepare task_assigned");
    expect(out).toContain("PrismaClientKnownRequestError");
    expect(out).toContain("P2002");
    expect(out).not.toContain(SECRET);
  });
});
