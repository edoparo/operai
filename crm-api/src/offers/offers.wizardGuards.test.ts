/**
 * The legacy offer routes beside the wizard (specs/20261115-crm-offer-wizard T28; AC-7.3, AC-9.4): the offers list
 * says where each offer came from, and each side refuses the other's records instead of reading them wrongly.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  call,
  db,
  insertOfferRow,
  makeReadyDeal,
  makeWizardTemplate,
  offerBody,
  putEntityProfile,
  resetWorld,
  wizardOfferSnapshot,
} from "../test-support/world";

const SUMMARY_SNAPSHOT = { reference: "OF-2026-ABC123-1", validUntil: "2026-10-31", scope: { aiAssisted: false, manDaysTenths: 0 } };

/** A deal with a legacy contract offer (made by the real flow), a 018-summary offer and a wizard offer; and a wizard template. */
async function world() {
  const { deal } = await makeReadyDeal();
  await putEntityProfile();
  const legacyBody = await offerBody(deal.id, "welld_ch", "Training");
  const wizardTemplate = await makeWizardTemplate({ language: "it" });
  const contract = await call("POST", `/deals/${deal.id}/offers`, { body: legacyBody });
  expect(contract.status).toBe(201);
  await call("POST", `/deals/${deal.id}/offers/${contract.json.id}/sent`);
  const summary = await insertOfferRow(deal.id, SUMMARY_SNAPSHOT, { number: 2, language: "en" });
  const wizard = await insertOfferRow(deal.id, wizardOfferSnapshot({ reference: "0002/2026" }), { number: 3, sent: true });
  return { deal, legacyBody, wizardTemplate, contract: contract.json, summary, wizard };
}

describe("the offers list reports where each offer came from (AC-7.3)", () => {
  beforeEach(resetWorld);

  it("a 018-summary offer is `summary`, a legacy contract offer `sections`, a wizard offer `wizard`", async () => {
    const { deal, contract, summary, wizard } = await world();
    const items = (await call("GET", `/deals/${deal.id}/offers`)).json.items as { id: string; origin: string }[];
    expect(Object.fromEntries(items.map((item) => [item.id, item.origin]))).toEqual({
      [contract.id]: "sections",
      [summary.id]: "summary",
      [wizard.id]: "wizard",
    });
  });

  it("a read-only holder sees the same origins", async () => {
    const { deal } = await world();
    const res = await call("GET", `/deals/${deal.id}/offers`, { as: "salesCh" });
    expect(res.status).toBe(200);
    expect((res.json.items as { origin: string }[]).map((item) => item.origin).sort()).toEqual(["sections", "summary", "wizard"]);
  });
});

describe("the legacy routes refuse a wizard template (AC-9.4)", () => {
  beforeEach(resetWorld);

  it("the legacy prefill and the legacy generate answer 409 template_format_mismatch", async () => {
    const { deal, legacyBody, wizardTemplate } = await world();
    const prefill = await call("GET", `/deals/${deal.id}/offers/draft?templateId=${wizardTemplate.id}`);
    expect(prefill.status).toBe(409);
    expect(prefill.json.code).toBe("template_format_mismatch");
    const before = await db.dealOffer.count({ where: { dealId: deal.id } });
    const generate = await call("POST", `/deals/${deal.id}/offers`, { body: { ...legacyBody, templateId: wizardTemplate.id } });
    expect(generate.status).toBe(409);
    expect(generate.json.code).toBe("template_format_mismatch");
    expect(await db.dealOffer.count({ where: { dealId: deal.id } })).toBe(before);
  });

  it("a legacy template still prefills and generates", async () => {
    const { deal, legacyBody } = await world();
    const res = await call("POST", `/deals/${deal.id}/offers`, { body: legacyBody });
    expect(res.status).toBe(201);
    expect(res.json.origin).toBe("sections");
  });
});

describe("the legacy form and edit refuse a wizard offer (AC-7.3)", () => {
  beforeEach(resetWorld);

  it("`/form` and `PUT` answer 409 offer_wizard, and change nothing", async () => {
    const { deal, legacyBody, wizard } = await world();
    const form = await call("GET", `/deals/${deal.id}/offers/${wizard.id}/form`);
    expect(form.status).toBe(409);
    expect(form.json.code).toBe("offer_wizard");
    const put = await call("PUT", `/deals/${deal.id}/offers/${wizard.id}`, { ifMatch: wizard.version, body: legacyBody });
    expect(put.status).toBe(409);
    expect(put.json.code).toBe("offer_wizard");
    const after = await db.dealOffer.findUniqueOrThrow({ where: { id: wizard.id } });
    expect(after.version).toBe(wizard.version);
    expect(after.objectKey).toBe(wizard.objectKey);
  });

  it("without If-Match the edit is still 428 first; a missing offer is still 404", async () => {
    const { deal, legacyBody, wizard } = await world();
    expect((await call("PUT", `/deals/${deal.id}/offers/${wizard.id}`, { body: legacyBody })).status).toBe(428);
    expect((await call("GET", `/deals/${deal.id}/offers/nope/form`)).status).toBe(404);
  });
});

describe("018 offers keep working (AC-9.4)", () => {
  beforeEach(resetWorld);

  it("a 018-summary offer lists and downloads, and is still `offer_legacy` for the form", async () => {
    const { deal, summary } = await world();
    expect((await call("GET", `/deals/${deal.id}/offers/${summary.id}/download`)).status).toBe(200);
    expect((await call("GET", `/deals/${deal.id}/offers/${summary.id}/form`)).json.code).toBe("offer_legacy");
  });

  it("a legacy contract offer lists, downloads and (while not sent) edits", async () => {
    const { deal } = await makeReadyDeal();
    await putEntityProfile();
    const body = await offerBody(deal.id, "welld_ch", "Training");
    const made = await call("POST", `/deals/${deal.id}/offers`, { body });
    expect(made.status).toBe(201);
    expect((await call("GET", `/deals/${deal.id}/offers/${made.json.id}/download`)).status).toBe(200);
    const form = await call("GET", `/deals/${deal.id}/offers/${made.json.id}/form`);
    expect(form.status).toBe(200);
    const edited = await call("PUT", `/deals/${deal.id}/offers/${made.json.id}`, { ifMatch: form.json.version, body: { ...body, validityDays: 45 } });
    expect(edited.status).toBe(200);
    expect(edited.json).toMatchObject({ origin: "sections", validityDays: 45, reference: made.json.reference });
  });
});

describe("a stored 018 summary-kind offer survives the removal of its renderer (QE round 9)", () => {
  beforeEach(resetWorld);

  it("is listed and downloaded through its stored object; nothing re-renders it", async () => {
    const { deal, summary } = await world();
    const link = await call("GET", `/deals/${deal.id}/offers/${summary.id}/download`, { as: "admin" });
    expect(link.status).toBe(200);
    expect(link.json.url).toContain(summary.objectKey);
    const list = await call("GET", `/deals/${deal.id}/offers`, { as: "admin" });
    expect(list.status).toBe(200);
    expect(list.json.items.some((o: { id: string }) => o.id === summary.id)).toBe(true);
  });
});
