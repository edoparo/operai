/**
 * The offer draft's read side and its creation for a new offer (specs/20261115-crm-offer-wizard T29; AC-2.1, AC-2.3,
 * AC-2.4, AC-6.2, AC-6.4; DD-27, DD-41): the wizard context, the draft and its summary, and the answers a draft starts from.
 */

import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { buildDraft } from "../offers/draft";
import { parseTemplate } from "../offers/engine/syntax";
import {
  call,
  db,
  estimai,
  makeCompany,
  makeDeal,
  makeDraftTemplate,
  readyDealWithProfiles,
  resetWorld,
  insertOfferRow,
  storedPdfAttachment,
  wizardOfferSnapshot,
} from "../test-support/world";

beforeEach(resetWorld);
afterEach(() => setSystemTime());

const DAY = "2026-03-04";
/**
 * Pins the clock to a past day. The personas' tokens are signed (and cached) first, under the real clock: a token
 * signed under the fake one would expire in the real one.
 */
const clock = async () => {
  for (const as of ["admin", "salesCh", "managerNoMoney", "consultant"] as const) await call("GET", "/scope", { as });
  setSystemTime(new Date(`${DAY}T23:30:00Z`));
};
const noMatch = { "If-None-Match": "*" };

/** `POST /offer-draft` with `If-None-Match: *` unless `headers` says otherwise. */
const createDraft = (dealId: string, body: unknown, as: "admin" | "salesCh" | "managerNoMoney" | "consultant" = "admin", headers: Record<string, string> = noMatch) =>
  call("POST", `/deals/${dealId}/offer-draft`, { as, body, headers });

describe("GET /deals/{id}/offer-wizard/context", () => {
  it("returns the client lines per language, contacts, place, attachments, the estimate and the server's day, no-store, no language", async () => {
    await clock();
    const { deal, company } = await readyDealWithProfiles();
    await call("POST", "/contacts", { body: { companyId: company.id, firstName: "Mario", lastName: "Rossi" } });
    const attachment = await storedPdfAttachment(deal.id, "brochure.pdf");

    const res = await call("GET", `/deals/${deal.id}/offer-wizard/context`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = res.json;
    expect(body).not.toHaveProperty("language");
    expect(body.today).toBe(DAY);
    expect(body.dealTitle).toBe("Grid analytics");
    expect(body.currency).toBe("CHF");
    expect(body.dealAmountCents).toBe(9_000_050);
    expect(body.issuerLegalName).toBe("wellD SA");
    expect(body.placeOfIssue).toBe("Lugano");
    expect(body.clientLines.it).toEqual(["Acme Holding SA", "Via Roma 1", "6900 Lugano", "Svizzera"]);
    expect(body.clientLines.en).toEqual(["Acme Holding SA", "Via Roma 1", "6900 Lugano", "Switzerland"]);
    expect(body.contacts).toEqual([{ id: expect.any(String), name: "Mario Rossi" }]);
    expect(body.attachments).toEqual([{ id: attachment.id, fileName: "brochure.pdf", sizeBytes: 1000 }]);
    expect(body.estimate.state).toBe("ready");
    expect(body.estimate.manDays).toBe(30);
    expect(body.estimate.manDaysAi).toBe(21);
    expect(body.estimate.epics).toEqual(["Auth", "Reports", "Billing"]);
    expect(body.estimate.phases).toEqual([
      { release: "Phase 1", epics: ["Auth"] },
      { release: "Phase 2", epics: ["Reports", "Billing"] },
    ]);
    expect(body.estimate.releases).toEqual([
      { name: "Phase 1", manDays: 10 },
      { name: "Phase 2", manDays: 20 },
    ]);
    expect(typeof body.estimate.timeline.it).toBe("string");
    expect(typeof body.estimate.timeline.en).toBe("string");
    expect(body.estimate.annex.it.manDaysTenths).toBe(300);
    expect(body.estimate.annex.itAi.manDaysTenths).toBe(210);
    expect(body.latestOffer).toBeNull();
  });

  it("reports an estimate the admin overrode as `override` and a deal with none as `missing`, without refusing", async () => {
    const { deal } = await readyDealWithProfiles();
    await db.dealEstimate.update({ where: { dealId: deal.id }, data: { state: "requested", readyAt: null, readyBy: null, overrideAt: new Date(), overrideBy: "user-admin", overrideReason: "no estimate needed" } });
    const overridden = await call("GET", `/deals/${deal.id}/offer-wizard/context`);
    expect(overridden.status).toBe(200);
    expect(overridden.json.estimate).toMatchObject({ state: "override", manDays: 0, epics: [], phases: [], releases: [], annex: null });

    const company = await makeCompany({ entity: "welld_ch" });
    const bare = await makeDeal(company.id, { entity: "welld_ch" });
    const missing = await call("GET", `/deals/${bare.id}/offer-wizard/context`);
    expect(missing.status).toBe(200);
    expect(missing.json.estimate.state).toBe("missing");
  });

  it("is a 404 for a deal that does not exist and a 403 outside the caller's entity", async () => {
    const { deal } = await readyDealWithProfiles({ entity: "welld_it" });
    expect((await call("GET", "/deals/none/offer-wizard/context")).status).toBe(404);
    const out = await call("GET", `/deals/${deal.id}/offer-wizard/context`, { as: "salesCh" });
    expect(out.status).toBe(403);
    expect(out.json.code).toBe("out_of_scope");
  });
});

describe("POST /deals/{id}/offer-draft (target new)", () => {
  it("stores the TEMPLATE's language client lines and the server's day for a `default: today` date", async () => {
    await clock();
    const { deal } = await readyDealWithProfiles();
    const template = await makeDraftTemplate({ language: "it" });
    const res = await createDraft(deal.id, { templateId: template.id });
    expect(res.status).toBe(201);
    expect(res.headers.get("ETag")).toBe('"1"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.json.answers.client.lines).toEqual(["Acme Holding SA", "Via Roma 1", "6900 Lugano", "Svizzera"]);
    expect(res.json.answers.client.date).toBeNull();
    expect(res.json.answers.fields.DATA_OFFERTA).toBe(DAY);
    expect(res.json).toMatchObject({
      dealId: deal.id,
      template: { id: template.id, name: template.name, language: "it", version: 1, archived: false },
      templateVersion: 1,
      target: { kind: "new" },
      version: 1,
    });

    const english = await makeDraftTemplate({ language: "en" });
    const other = await readyDealWithProfiles();
    const en = await createDraft(other.deal.id, { templateId: english.id });
    expect(en.json.answers.client.lines[3]).toBe("Switzerland");
  });

  it("prefills what the legacy dialog prefills: epics, phases, timeline, man-days, deal, the per-release split", async () => {
    const { deal } = await readyDealWithProfiles();
    const template = await makeDraftTemplate();
    const res = await createDraft(deal.id, { templateId: template.id });
    expect(res.status).toBe(201);

    const estimate = [...estimai.estimates.values()].at(-1)!;
    const legacy = (aiAssisted: boolean) =>
      buildDraft({
        template: {
          id: "legacy",
          name: "Legacy",
          language: "it",
          salutation: "S",
          opening: "{epics}\u0001{phases}\u0001{timeline}\u0001{manDays}\u0001{deal}",
          sections: [{ heading: "H", body: "b", costs: true }],
          costLines: [
            { description: "Fase {release}", kind: "one_off", amount: "perRelease", quantity: 1 },
            { description: "Totale", kind: "one_off", amount: "deal", quantity: 1 },
          ],
          costColumns: { position: true, unit: false },
          showTotal: true,
          acceptanceLabel: null,
          annex: false,
        },
        deal: { title: "Grid analytics", amountCents: 9_000_050, currency: "CHF" },
        company: { name: "Acme", legalName: "Acme Holding SA", street: "Via Roma 1", postalCode: "6900", city: "Lugano", country: "CH" },
        issuerLegalName: "wellD SA",
        estimate: { id: estimate.id, name: estimate.name, content: estimate.content } as never,
        aiAssisted,
        validityDays: 30,
      });
    const base = legacy(false);
    const [epics, phases, timeline, manDays, dealTitle] = base.opening.split("\u0001");
    const fields = res.json.answers.fields;
    expect(fields.EPICI).toBe(epics);
    expect(fields.FASI).toBe(phases);
    expect(fields.TEMPI).toBe(timeline);
    expect(fields.GIORNI).toBe(manDays);
    expect(fields.PROGETTO).toBe(dealTitle);
    // the per-release split and the deal amount
    expect(res.json.answers.costs.lines.fasi.releases.map((r: { description: string; unitCents: number }) => [r.description, r.unitCents])).toEqual(
      base.costLines.slice(0, 2).map((line) => [line.description.replace("Fase ", ""), line.unitCents]),
    );
    expect(res.json.answers.costs.lines.giorni.unitCents).toBe(base.costLines[2]!.unitCents);
    // man-days with the AI gain: the context says what the legacy dialog says
    const context = (await call("GET", `/deals/${deal.id}/offer-wizard/context`)).json;
    expect(context.estimate.manDays).toBe(base.manDays);
    expect(context.estimate.manDaysAi).toBe(legacy(true).manDays);
    expect(context.estimate.timeline.it).toBe(timeline);
  });

  it("is 409 estimate_not_ready without a ready estimate or an override", async () => {
    await readyDealWithProfiles();
    const template = await makeDraftTemplate();
    const company = await makeCompany({ entity: "welld_ch" });
    const bare = await makeDeal(company.id, { entity: "welld_ch" });
    const res = await createDraft(bare.id, { templateId: template.id });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("estimate_not_ready");
    expect(await db.offerDraft.count()).toBe(0);
  });

  it("is 428 without `If-None-Match: *` and 409 draft_exists (with who and when) for a second one", async () => {
    const { deal } = await readyDealWithProfiles();
    const template = await makeDraftTemplate();
    expect((await createDraft(deal.id, { templateId: template.id }, "admin", {})).status).toBe(428);
    expect((await createDraft(deal.id, { templateId: template.id }, "admin", { "If-None-Match": '"1"' })).status).toBe(428);
    expect((await createDraft(deal.id, { templateId: template.id })).status).toBe(201);
    const again = await createDraft(deal.id, { templateId: template.id });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ code: "draft_exists", updatedBy: { id: "user-admin" } });
    expect(typeof again.json.updatedAt).toBe("string");
  });

  it("needs a template for `new` (422 template_required), refuses another entity's (404) and an archived one (409)", async () => {
    const { deal } = await readyDealWithProfiles();
    expect((await createDraft(deal.id, {})).json.code).toBe("template_required");
    expect((await createDraft(deal.id, { target: { kind: "new" } })).status).toBe(422);
    const foreign = await makeDraftTemplate({ entity: "welld_it" });
    expect((await createDraft(deal.id, { templateId: foreign.id })).status).toBe(404);
    const keeper = await makeDraftTemplate({ language: "it" });
    const archived = await makeDraftTemplate({ language: "it" });
    const archive = await call("POST", `/offer-templates/${archived.id}/archive`, { ifMatch: archived.version });
    expect(archive.status).toBe(200);
    const res = await createDraft(deal.id, { templateId: archived.id });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: "template_archived", templateId: archived.id });
    expect(keeper.id).toBeTruthy();
  });
});

describe("POST /deals/{id}/offer-draft while the latest offer is unsent (018 AC-7.1)", () => {
  it("is 409 offer_not_sent for a new offer, and no draft is made", async () => {
    const { deal } = await readyDealWithProfiles();
    const template = await makeDraftTemplate();
    await insertOfferRow(deal.id, wizardOfferSnapshot());
    const res = await createDraft(deal.id, { templateId: template.id });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("offer_not_sent");
    expect(await db.offerDraft.count()).toBe(0);
    // once it went out, a new draft is allowed
    await db.dealOffer.updateMany({ where: { dealId: deal.id }, data: { sentAt: new Date(), sentBy: "user-admin" } });
    expect((await createDraft(deal.id, { templateId: template.id })).status).toBe(201);
  });
});

describe("GET /deals/{id}/offer-draft and /summary", () => {
  it("round-trips the draft with its ETag, and is a 404 draft_not_found without one", async () => {
    const { deal } = await readyDealWithProfiles();
    expect((await call("GET", `/deals/${deal.id}/offer-draft`)).json.code).toBe("draft_not_found");
    const template = await makeDraftTemplate();
    const created = await createDraft(deal.id, { templateId: template.id });
    const got = await call("GET", `/deals/${deal.id}/offer-draft`);
    expect(got.status).toBe(200);
    expect(got.headers.get("ETag")).toBe('"1"');
    expect(got.json).toEqual(created.json);
  });

  it("the summary is `{ draft: null }` without a draft, and with one carries what the deal page needs and no answer value", async () => {
    const { deal } = await readyDealWithProfiles();
    const none = await call("GET", `/deals/${deal.id}/offer-draft/summary`);
    expect(none.status).toBe(200);
    expect(none.json).toEqual({ draft: null });
    expect(none.headers.get("ETag")).toBeNull();
    expect(none.headers.get("Cache-Control")).toBe("no-store");

    const template = await makeDraftTemplate();
    await createDraft(deal.id, { templateId: template.id });
    const res = await call("GET", `/deals/${deal.id}/offer-draft/summary`);
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"1"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.json.draft).toMatchObject({
      dealId: deal.id,
      template: { id: template.id, name: template.name, language: "it", archived: false },
      templateChanged: false,
      target: { kind: "new" },
      version: 1,
      updatedBy: { id: "user-admin" },
    });
    expect(typeof res.json.draft.updatedAt).toBe("string");
    expect(typeof res.json.draft.createdAt).toBe("string");
    expect(res.json.draft).not.toHaveProperty("answers");
    // no answer value anywhere in the bytes: not a client line, not an epic, not the deal title
    const bytes = JSON.stringify(res.json);
    for (const secret of ["Acme Holding", "Via Roma", "Auth", "Reports", "Grid analytics"]) expect(bytes).not.toContain(secret);
  });

  it("flags `templateChanged` once the template moved on", async () => {
    const { deal } = await readyDealWithProfiles();
    const template = await makeDraftTemplate();
    await createDraft(deal.id, { templateId: template.id });
    await db.offerTemplate.update({ where: { id: template.id }, data: { version: { increment: 1 } } });
    expect((await call("GET", `/deals/${deal.id}/offer-draft/summary`)).json.draft.templateChanged).toBe(true);
  });

  it("answers the same 403 with or without a draft for a caller outside the gate or the scope (AC-6.2)", async () => {
    const { deal } = await readyDealWithProfiles({ entity: "welld_it" });
    const paths = [`/deals/${deal.id}/offer-draft`, `/deals/${deal.id}/offer-draft/summary`, `/deals/${deal.id}/offer-wizard/context`];
    const read = async () => {
      const out: unknown[] = [];
      for (const as of ["salesCh", "managerNoMoney", "consultant"] as const) {
        for (const path of paths) {
          const res = await call("GET", path, { as });
          out.push({ as, path, status: res.status, body: { ...res.json, instance: undefined } });
        }
      }
      return out;
    };
    const without = await read();
    const template = await makeDraftTemplate({ entity: "welld_it" });
    expect((await createDraft(deal.id, { templateId: template.id })).status).toBe(201);
    const withDraft = await read();
    expect(withDraft).toEqual(without);
    expect(without.every((entry) => (entry as { status: number }).status === 403)).toBe(true);
  });

  it("the deal and the offers list carry no draft data", async () => {
    const { deal } = await readyDealWithProfiles();
    const template = await makeDraftTemplate();
    await createDraft(deal.id, { templateId: template.id });
    expect(JSON.stringify((await call("GET", `/deals/${deal.id}`)).json)).not.toMatch(/draft/i);
    expect(JSON.stringify((await call("GET", `/deals/${deal.id}/offers`)).json)).not.toMatch(/draft/i);
  });
});

describe("the caller gate of the draft routes", () => {
  it("manage + financials in scope may create, financials without manage and manage without financials may not", async () => {
    const { deal } = await readyDealWithProfiles();
    const template = await makeDraftTemplate();
    const gate = async (as: "salesCh" | "managerNoMoney" | "consultant") => {
      const res = await createDraft(deal.id, { templateId: template.id }, as);
      return res.status;
    };
    expect(await gate("managerNoMoney")).toBe(403);
    expect(await gate("consultant")).toBe(403);
    expect(await gate("salesCh")).toBe(201);
  });
});

describe("the template parses", () => {
  it("DRAFT_SOURCE has no problem the parser calls an error", async () => {
    const { DRAFT_SOURCE } = await import("../test-support/world");
    expect(parseTemplate(DRAFT_SOURCE).problems.filter((p) => p.severity === "error")).toEqual([]);
  });
});
