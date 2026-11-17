/**
 * Structural checks of the letterheads catalog constant (specs/20261116-letterhead-service —
 * AC-8.1, AC-8.9). The registration path and the role grants are covered by `../seed.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { CRM_CATALOG } from "./crm";
import { ESTIMAI_CATALOG } from "./estimai";
import { INVENTORY_CATALOG } from "./inventory";
import { LETTERHEADS_APP_ID, LETTERHEADS_CATALOG } from "./letterheads";
import { MEETINGS_CATALOG } from "./meetings";
import { PROJECTS_CATALOG } from "./projects";
import { REFUND_CATALOG } from "./refund";

describe("LETTERHEADS_CATALOG (specs/20261116-letterhead-service)", () => {
  test("declares appId `letterheads` with a condition-free `access` action on the app-access resource", () => {
    expect(LETTERHEADS_APP_ID).toBe("letterheads");
    expect(LETTERHEADS_CATALOG.appId).toBe("letterheads");
    expect(LETTERHEADS_CATALOG.resources.find((r) => r.key === "letterheads")?.actions).toEqual([
      { key: "access", label: "Access", supportedConditions: [] },
    ]);
  });

  test("declares exactly letterheads:access and entity-scoped letterhead:manage", () => {
    const capabilities = LETTERHEADS_CATALOG.resources.flatMap((r) =>
      r.actions.map((a) => [`${r.key}:${a.key}`, a.supportedConditions] as const),
    );
    expect(capabilities.sort(([a], [b]) => a.localeCompare(b))).toEqual([
      ["letterhead:manage", ["entity"]],
      ["letterheads:access", []],
    ]);
  });

  test("no resource name collides with another app's (the resolver matches grants by resource, not app)", () => {
    const others = [
      ESTIMAI_CATALOG,
      REFUND_CATALOG,
      INVENTORY_CATALOG,
      CRM_CATALOG,
      MEETINGS_CATALOG,
      PROJECTS_CATALOG,
    ].flatMap((c) => c.resources.map((r) => r.key));
    for (const resource of LETTERHEADS_CATALOG.resources) expect(others).not.toContain(resource.key);
  });
});
