/**
 * The registry rules as pure functions (specs/20261110-activities plan § Access; AC-3.2, AC-3.3, AC-3.8, AC-8.1):
 * the same functions the `may` flags of a view and the checks of a write both use, so the table
 * below is the whole authorization matrix of the activity routes, host by host.
 */
import { describe, expect, it } from "bun:test";
import { buildRegistry } from "../hosts/registry";
import type { OpenEntity } from "./access";
import { changeRefused, mayChange, mayComplete, mayCreate, mayFlags } from "./rules";

const registry = buildRegistry({ crmApiUrl: "http://crm.test", projectsApiUrl: "http://projects.test" });
const crm = registry.get("crm", "company")!;
const projects = registry.get("projects", "project")!;

const entity = (extra: Partial<OpenEntity> & { may?: { write: boolean; manage: boolean } } = {}): OpenEntity => ({
  state: "open",
  writable: true,
  label: "L",
  href: "/x",
  may: { write: true, manage: true },
  assignees: null,
  ...extra,
});
const row = (extra: Partial<{ type: string; authorUserId: string; assigneeUserId: string | null }> = {}) => ({
  type: "task",
  authorUserId: "author",
  assigneeUserId: "assignee",
  ...extra,
});

describe("the registry is data (plan § Access)", () => {
  it("the CRM: the author edits, any reader completes, any CRM user can be assigned", () => {
    expect([crm.editBy, crm.completeBy, crm.assignees, crm.types.length]).toEqual(["author", "reader", "app_users", 5]);
  });
  it("Projects: a manager edits, the assignee or a manager completes, the host lists who can be assigned, only tasks", () => {
    expect([projects.editBy, projects.completeBy, projects.assignees, projects.types]).toEqual([
      "manager",
      "assignee_or_manager",
      "host_list",
      ["task"],
    ]);
  });
});

describe("create", () => {
  it("is the host's `write`", () => {
    expect(mayCreate(entity({ may: { write: true, manage: false } }))).toBe(true);
    expect(mayCreate(entity({ may: { write: false, manage: true } }))).toBe(false);
  });
});

describe("edit, reassign, delete", () => {
  it("CRM: the author, and nobody else, whatever else the caller holds", () => {
    expect(mayChange(crm, entity(), row(), "author")).toBe(true);
    expect(mayChange(crm, entity(), row(), "someone")).toBe(false);
    expect(mayChange(crm, entity({ may: { write: true, manage: true } }), row(), "assignee")).toBe(false);
  });
  it("Projects: a manager of the entity, not the author and not the assignee", () => {
    expect(mayChange(projects, entity({ may: { write: true, manage: true } }), row(), "someone")).toBe(true);
    expect(mayChange(projects, entity({ may: { write: false, manage: false } }), row(), "author")).toBe(false);
    expect(mayChange(projects, entity({ may: { write: false, manage: false } }), row(), "assignee")).toBe(false);
  });
  it("is refused as `author_only` where the author owns the record, `forbidden` where a manager does", () => {
    expect(changeRefused(crm)).toMatchObject({ status: 403, code: "author_only" });
    expect(changeRefused(projects)).toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("complete and reopen", () => {
  it("CRM: any reader, on a task only", () => {
    expect(mayComplete(crm, entity({ may: { write: false, manage: false } }), row(), "anyone")).toBe(true);
    expect(mayComplete(crm, entity(), row({ type: "note" }), "anyone")).toBe(false);
  });
  it("Projects: the assignee, or a manager; a reader who is neither cannot", () => {
    const readOnly = entity({ may: { write: false, manage: false } });
    expect(mayComplete(projects, readOnly, row(), "assignee")).toBe(true);
    expect(mayComplete(projects, readOnly, row(), "someone")).toBe(false);
    expect(mayComplete(projects, entity(), row(), "someone")).toBe(true);
  });
});

describe("the view's flags are the same rules, with `writable` applied (AC-3.8)", () => {
  it("a closed project: no edit, no delete, completion stays", () => {
    const closed = entity({ writable: false });
    expect(mayFlags(projects, closed, row(), "assignee")).toEqual({ edit: false, delete: false, complete: true });
    expect(mayFlags(projects, entity(), row(), "someone")).toEqual({ edit: true, delete: true, complete: true });
  });
  it("an entity the host did not report open: nothing", () => {
    expect(mayFlags(crm, undefined, row(), "author")).toEqual({ edit: false, delete: false, complete: false });
  });
});
