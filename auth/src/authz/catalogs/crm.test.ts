/**
 * Structural checks of the CRM catalog constant (specs/017-crm — AC-5.1). The
 * registration path and the role grants are covered by `../seed.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { CRM_APP_ID, CRM_CATALOG } from "./crm";
import { ESTIMAI_CATALOG } from "./estimai";
import { INVENTORY_CATALOG } from "./inventory";
import { REFUND_CATALOG } from "./refund";

describe("CRM_CATALOG (specs/017)", () => {
  test("declares appId `crm` with a condition-free `access` action", () => {
    expect(CRM_APP_ID).toBe("crm");
    expect(CRM_CATALOG.appId).toBe("crm");
    expect(CRM_CATALOG.resources.find((r) => r.key === "crm")?.actions).toEqual([
      { key: "access", label: "Access", supportedConditions: [] },
    ]);
  });

  test("`deal:manage` supports only the entity condition (ADR-0015); `deal:financials` and `contact:erase` none", () => {
    const deal = CRM_CATALOG.resources.find((r) => r.key === "deal");
    expect(deal?.actions.map((a) => [a.key, a.supportedConditions])).toEqual([
      ["manage", ["entity"]],
      ["financials", []],
    ]);
    const contact = CRM_CATALOG.resources.find((r) => r.key === "contact");
    expect(contact?.actions.map((a) => [a.key, a.supportedConditions])).toEqual([["erase", []]]);
  });

  test("declares exactly three resources", () => {
    expect(CRM_CATALOG.resources.map((r) => r.key).sort()).toEqual(["contact", "crm", "deal"]);
  });

  test("no resource key collides with another app's (the resolver keys grants by resource, not app)", () => {
    const others = [ESTIMAI_CATALOG, REFUND_CATALOG, INVENTORY_CATALOG].flatMap((c) => c.resources.map((r) => r.key));
    for (const resource of CRM_CATALOG.resources) expect(others).not.toContain(resource.key);
  });
});
