/**
 * A NUL character (`\u0000`) in any text or id input is a 422 naming the field, never the 500 the
 * database would make of it (OWASP review L2), and an unexpected error is logged by name and code
 * only, never with the statement a database error carries.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { call, db, makeCompany, resetWorld } from "../test-support/world";

beforeEach(resetWorld);

const NUL = "\u0000";

describe("NUL in user input", () => {
  it("is a 422 on the free text of a create and an edit, and nothing is written", async () => {
    const co = makeCompany();
    for (const body of [{ subject: `a${NUL}b` }, { subject: "ok", body: `x${NUL}` }]) {
      const res = await call("POST", "/activities", { body: { type: "note", companyId: co.id, ...body } });
      expect(res.status).toBe(422);
      expect(res.json.field).toBe(Object.keys(body)[Object.keys(body).length - 1]);
    }
    expect(await db.activity.count()).toBe(0);
    const made = await call("POST", "/activities", { body: { type: "note", subject: "S", companyId: co.id } });
    const edit = await call("PATCH", `/activities/${made.json.id}`, { body: { subject: `n${NUL}` } });
    expect(edit.status).toBe(422);
    expect(edit.json.field).toBe("subject");
  });

  it("is a 422 on ids in a body, a query and a path", async () => {
    const co = makeCompany();
    expect((await call("POST", "/activities", { body: { type: "note", subject: "S", companyId: `c${NUL}` } })).status).toBe(422);
    expect((await call("POST", "/activities", { body: { type: "note", subject: "S", companyId: co.id, contactId: `c${NUL}` } })).status).toBe(422);
    expect((await call("POST", "/activities", { body: { type: "task", subject: "S", companyId: co.id, blockedByIds: [`b${NUL}`] } })).status).toBe(422);
    expect((await call("GET", "/activities?companyId=a%00b")).status).toBe(422);
    expect((await call("GET", "/tasks?assignee=a%00b")).status).toBe(422);
    expect((await call("DELETE", "/activities/a%00b")).status).toBe(422);
  });
});

describe("an unexpected error is logged without its statement", () => {
  let logged: unknown[][];
  let spy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    logged = [];
    spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => void logged.push(args));
  });
  afterEach(() => spy.mockRestore());

  it("keeps the error name and, for a database error, its code, and drops the message", async () => {
    // A real database refusal that validation lets through: year 0 is a valid JS date, not a Postgres one.
    const co = makeCompany();
    const res = await call("POST", "/activities", { body: { type: "task", subject: "Client secret text", companyId: co.id, dueDate: "0000-01-01" } });
    expect(res.status).toBe(500);
    expect(res.json.detail).toBe("An unexpected error occurred");
    const uncaught = logged.find((args) => args[0] === "[uncaught]");
    expect(uncaught).toBeDefined();
    expect(Object.keys(uncaught![1] as object).every((key) => key === "name" || key === "code")).toBe(true);
    expect(typeof (uncaught![1] as { name: unknown }).name).toBe("string");
    expect(JSON.stringify(logged)).not.toContain("Client secret text");
  });
});
