/**
 * Unit tests for EstimAI's declared catalog constant (T26,
 * specs/20260713-auth-roles-permissions — refs AC-3.4). Pure structural checks —
 * no DB, no registration — the registration path itself (`upsertAppCatalog`
 * via `seedEstimaiCatalog`) is covered by `../seed.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { ESTIMAI_APP_ID, ESTIMAI_CATALOG } from "./estimai";

describe("ESTIMAI_CATALOG (T26, AC-3.4)", () => {
  test("declares appId `estimai`", () => {
    expect(ESTIMAI_APP_ID).toBe("estimai");
    expect(ESTIMAI_CATALOG.appId).toBe(ESTIMAI_APP_ID);
  });

  test("declares the app-access resource with a single, condition-free `access` action", () => {
    const accessResource = ESTIMAI_CATALOG.resources.find((r) => r.key === ESTIMAI_APP_ID);
    expect(accessResource).toBeDefined();
    expect(accessResource?.actions).toHaveLength(1);
    expect(accessResource?.actions[0]).toEqual({
      key: "access",
      label: "Access",
      supportedConditions: [],
    });
  });

  test("declares the `estimate` resource with view/create/edit/delete and read-all (specs/20261108-estimate-list-oversight)", () => {
    const estimateResource = ESTIMAI_CATALOG.resources.find((r) => r.key === "estimate");
    expect(estimateResource).toBeDefined();
    expect(estimateResource?.actions.map((a) => a.key).sort()).toEqual([
      "create",
      "delete",
      "edit",
      "read-all",
      "view",
    ]);
  });

  test("every `estimate` action supports the ownership/entity/department conditions model", () => {
    const estimateResource = ESTIMAI_CATALOG.resources.find((r) => r.key === "estimate");
    for (const action of (estimateResource?.actions ?? []).filter((a) => a.key !== "read-all")) {
      expect(action.supportedConditions.sort()).toEqual(["department", "entity", "ownership"]);
    }
    // specs/20261108-estimate-list-oversight, ADR 20261108-estimai-oversight-permission-amends-0036: read-all is global, no conditions.
    expect(estimateResource?.actions.find((a) => a.key === "read-all")?.supportedConditions).toEqual([]);
    // Guard against an empty-array false positive above.
    expect(estimateResource?.actions.length).toBeGreaterThan(0);
  });

  test("declares exactly two resources — app access and `estimate` — nothing else (declaration-only, no enforcement surface)", () => {
    expect(ESTIMAI_CATALOG.resources.map((r) => r.key).sort()).toEqual([
      "estimai",
      "estimate",
    ]);
  });
});
