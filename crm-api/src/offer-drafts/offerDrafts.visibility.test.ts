/**
 * QE pass (specs/20261115-crm-offer-wizard, AC-6.2): "A person without `deal:financials` does not learn that a draft
 * exists." offerDrafts.test.ts proves it for the three GET routes only; this proves it for every WRITE route of the
 * draft — a caller outside the gate (no manage / no financials) or outside the deal's entity gets the same status and the
 * same body whether the deal has a draft or not, and the draft is left exactly as it was.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, makeDraftTemplate, readyDealWithProfiles, resetWorld } from "../test-support/world";

beforeEach(resetWorld);

const noMatch = { "If-None-Match": "*" };

type Caller = "managerNoMoney" | "consultant" | "salesCh";

describe("the write routes of the draft do not reveal whether a draft exists (AC-6.2)", () => {
  it("answers a caller outside the gate or the scope the same 403 with or without a draft, on every write route", async () => {
    // salesCh is a welld_ch caller, so the welld_it deal is out of its scope; the other two lack a half of the gate.
    const cases: { entity: "welld_ch" | "welld_it"; as: Caller }[] = [
      { entity: "welld_ch", as: "managerNoMoney" },
      { entity: "welld_ch", as: "consultant" },
      { entity: "welld_it", as: "salesCh" },
    ];
    for (const { entity, as } of cases) {
      const { deal } = await readyDealWithProfiles({ entity });
      const template = await makeDraftTemplate({ entity, name: `Template ${as}` });
      const other = await makeDraftTemplate({ entity, name: `Another ${as}` });
      const dealId = deal.id;

      const probe = async () => {
        const attempts: [string, string, Parameters<typeof call>[2]][] = [
          ["POST", `/deals/${dealId}/offer-draft`, { as, body: { templateId: template.id }, headers: noMatch }],
          ["PUT", `/deals/${dealId}/offer-draft`, { as, ifMatch: 1, body: { templateVersion: 1, target: { kind: "new" }, answers: {} } }],
          ["DELETE", `/deals/${dealId}/offer-draft`, { as, ifMatch: 1 }],
          ["POST", `/deals/${dealId}/offer-draft/template`, { as, ifMatch: 1, body: { templateId: other.id } }],
          ["POST", `/deals/${dealId}/offer-draft/generate`, { as, ifMatch: 1 }],
        ];
        const out: unknown[] = [];
        for (const [method, path, options] of attempts) {
          const res = await call(method, path, options);
          out.push({ method, path, status: res.status, body: { ...res.json, instance: undefined } });
        }
        return out;
      };

      const without = await probe();
      expect(await db.offerDraft.count({ where: { dealId } })).toBe(0);

      const created = await call("POST", `/deals/${dealId}/offer-draft`, { as: "admin", body: { templateId: template.id }, headers: noMatch });
      expect(created.status).toBe(201);
      const before = await db.offerDraft.findUniqueOrThrow({ where: { dealId } });

      const withDraft = await probe();
      expect(withDraft).toEqual(without);
      // Every answer is a refusal that says nothing about a draft: never a 404 `draft_not_found` / 409 `draft_exists`.
      // (A PUT whose body is not even well-formed is 422 before the scope is looked at, as on every crm-api route; the
      // body it gets is identical with or without a draft, which is what AC-6.2 asks.)
      const rows = without as { method: string; status: number }[];
      expect(rows.every((entry) => entry.status === 403 || (entry.method === "PUT" && entry.status === 422))).toBe(true);
      expect(rows.filter((entry) => entry.method !== "PUT").every((entry) => entry.status === 403)).toBe(true);
      // And nothing was changed or consumed by the refused calls.
      const after = await db.offerDraft.findUniqueOrThrow({ where: { dealId } });
      expect(after.version).toBe(before.version);
      expect(after.templateId).toBe(before.templateId);
      expect(await db.dealOffer.count({ where: { dealId } })).toBe(0);
    }
  });
});
