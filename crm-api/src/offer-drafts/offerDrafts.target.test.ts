/**
 * A draft that edits or revises an offer (specs/20261115-crm-offer-wizard T33; AC-6.6, AC-7.1, AC-7.2, AC-7.3; DD-28, DD-42):
 * `POST …/offer-draft` with `target: edit | revision` and their generate branches.
 */

// The test world first: it sets the environment the other modules read when they load.
import {
  bucket,
  call,
  db,
  insertOfferRow,
  makeDraftTemplate,
  readyDealWithProfiles,
  resetWorld,
  wizardOfferSnapshot,
} from "../test-support/world";
import { beforeEach, describe, expect, it } from "bun:test";

beforeEach(resetWorld);

const noMatch = { "If-None-Match": "*" };
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const startDraft = (dealId: string, body: unknown) => call("POST", `/deals/${dealId}/offer-draft`, { body, headers: noMatch });
const generate = (dealId: string, version: number) => call("POST", `/deals/${dealId}/offer-draft/generate`, { ifMatch: version });
const offers = (dealId: string) => db.dealOffer.findMany({ where: { dealId }, orderBy: { number: "asc" } });

/** A deal with a wizard offer made through the API, with `change` applied to its draft's answers first. */
async function wizardOffer(change: (answers: any) => void = () => {}) {
  const { deal } = await readyDealWithProfiles();
  const template = await makeDraftTemplate();
  const draft = (await startDraft(deal.id, { templateId: template.id })).json;
  const answers = structuredClone(draft.answers);
  change(answers);
  const saved = await call("PUT", `/deals/${deal.id}/offer-draft`, { ifMatch: 1, body: { templateVersion: 1, target: { kind: "new" }, answers } });
  expect(saved.status).toBe(200);
  const made = await generate(deal.id, saved.json.version);
  expect(made.status).toBe(201);
  return { dealId: deal.id, companyId: (await db.deal.findUniqueOrThrow({ where: { id: deal.id } })).companyId, template, offer: made.json, answers };
}

const markSent = (dealId: string, offerId: string) => call("POST", `/deals/${dealId}/offers/${offerId}/sent`);

describe("edit of an unsent wizard offer (AC-7.1)", () => {
  it("without a templateId starts from the snapshot's template and its answers, hand edits included (DD-28)", async () => {
    const w = await wizardOffer((a) => {
      a.handEdits["OGGETTO#0"] = { heading: "OGGETTO", body: "Testo scritto a mano.", sourceHeading: "OGGETTO" };
      a.client.place = "Zurigo";
    });
    const res = await startDraft(w.dealId, { target: { kind: "edit", offerId: w.offer.id } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      template: { id: w.template.id },
      templateVersion: 1,
      target: { kind: "edit", offerId: w.offer.id, offerVersion: 1, reference: w.offer.reference },
      version: 1,
    });
    expect(res.json.answers.handEdits["OGGETTO#0"].body).toBe("Testo scritto a mano.");
    expect(res.json.answers.client.place).toBe("Zurigo");
    expect(res.json.answers.fields).toEqual(w.answers.fields);
    const summary = (await call("GET", `/deals/${w.dealId}/offer-draft/summary`)).json.draft;
    expect(summary.target).toEqual({ kind: "edit", offerId: w.offer.id, offerVersion: 1, reference: w.offer.reference });
  });

  it("with the snapshot's template archived is 409 template_archived naming it", async () => {
    const w = await wizardOffer();
    await makeDraftTemplate(); // another active one, so the archive is allowed
    const archive = await call("POST", `/offer-templates/${w.template.id}/archive`, { ifMatch: w.template.version });
    expect(archive.status).toBe(200);
    const res = await startDraft(w.dealId, { target: { kind: "edit", offerId: w.offer.id } });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: "template_archived", templateId: w.template.id });
    expect(await db.offerDraft.count()).toBe(0);
  });

  it("with another templateId keeps the client lines, contacts, place and date, and starts the rest again", async () => {
    const w = await wizardOffer();
    const person = await call("POST", "/contacts", { body: { companyId: w.companyId, firstName: "Ada", lastName: "Lovelace" } });
    // the unsent offer's own answers carry the client block
    const stored = await db.dealOffer.findUniqueOrThrow({ where: { id: w.offer.id } });
    const snapshot = stored.snapshot as any;
    snapshot.wizard.answers.client = { lines: ["Altra riga"], contactIds: [person.json.id], place: "Zurigo", date: day(5) };
    snapshot.wizard.answers.fields.EPICI = "da non portare";
    await db.dealOffer.update({ where: { id: w.offer.id }, data: { snapshot } });
    const other = await makeDraftTemplate();
    const res = await startDraft(w.dealId, { target: { kind: "edit", offerId: w.offer.id }, templateId: other.id });
    expect(res.status).toBe(201);
    expect(res.json.template.id).toBe(other.id);
    expect(res.json.answers.client).toEqual({ lines: ["Altra riga"], contactIds: [person.json.id], place: "Zurigo", date: day(5) });
    expect(res.json.answers.fields.EPICI).not.toBe("da non portare");
    expect(res.json.target).toMatchObject({ kind: "edit", offerId: w.offer.id });
  });

  it("is refused for a sent offer (offer_sent) and for one that is not the latest (offer_not_latest)", async () => {
    const w = await wizardOffer();
    await markSent(w.dealId, w.offer.id);
    const sent = await startDraft(w.dealId, { target: { kind: "edit", offerId: w.offer.id } });
    expect(sent.status).toBe(409);
    expect(sent.json.code).toBe("offer_sent");

    const next = await startDraft(w.dealId, { templateId: w.template.id });
    expect((await generate(w.dealId, next.json.version)).status).toBe(201);
    const old = await startDraft(w.dealId, { target: { kind: "edit", offerId: w.offer.id } });
    expect(old.status).toBe(409);
    expect(old.json.code).toBe("offer_not_latest");
  });

  it("generate: the same reference, the offer's version + 1, the old PDF replaced, the draft gone (200)", async () => {
    const w = await wizardOffer();
    const before = await db.dealOffer.findUniqueOrThrow({ where: { id: w.offer.id } });
    const draft = (await startDraft(w.dealId, { target: { kind: "edit", offerId: w.offer.id } })).json;
    const answers = structuredClone(draft.answers);
    answers.fields.EPICI = "Epiche riviste";
    const saved = await call("PUT", `/deals/${w.dealId}/offer-draft`, { ifMatch: 1, body: { templateVersion: 1, target: { kind: "edit", offerId: w.offer.id }, answers } });
    expect(saved.status).toBe(200);
    const res = await generate(w.dealId, saved.json.version);
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"2"');
    expect(res.json).toMatchObject({ id: w.offer.id, reference: w.offer.reference, version: 2, origin: "wizard", sent: null });
    expect(await db.offerDraft.count()).toBe(0);
    const rows = await offers(w.dealId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.objectKey).not.toBe(before.objectKey);
    expect(bucket.objects.has(rows[0]!.objectKey)).toBe(true);
    expect(bucket.objects.has(before.objectKey)).toBe(false);
    expect(rows[0]!.sequenceNo).toBe(before.sequenceNo);
    expect(JSON.stringify(rows[0]!.snapshot)).toContain("Epiche riviste");
  });

  it("generate: marked sent meanwhile is 409 offer_sent, a changed offer is 409 offer_changed, and nothing is made or lost", async () => {
    const w = await wizardOffer();
    const draft = (await startDraft(w.dealId, { target: { kind: "edit", offerId: w.offer.id } })).json;
    const before = await db.dealOffer.findUniqueOrThrow({ where: { id: w.offer.id } });

    await db.dealOffer.update({ where: { id: w.offer.id }, data: { version: { increment: 1 } } });
    const changed = await generate(w.dealId, draft.version);
    expect(changed.status).toBe(409);
    expect(changed.json.code).toBe("offer_changed");

    await db.dealOffer.update({ where: { id: w.offer.id }, data: { version: before.version, sentAt: new Date(), sentBy: "user-admin" } });
    const sent = await generate(w.dealId, draft.version);
    expect(sent.status).toBe(409);
    expect(sent.json.code).toBe("offer_sent");

    const after = await db.dealOffer.findUniqueOrThrow({ where: { id: w.offer.id } });
    expect(after.objectKey).toBe(before.objectKey);
    expect(bucket.objects.has(before.objectKey)).toBe(true);
    expect([...bucket.objects.keys()].filter((key) => key.startsWith("offers/"))).toEqual([before.objectKey]);
    expect(await db.offerDraft.count()).toBe(1);
  });
});

describe("revision of a sent wizard offer (AC-7.2)", () => {
  it("is refused while the offer is unsent (offer_not_sent)", async () => {
    const w = await wizardOffer();
    const res = await startDraft(w.dealId, { target: { kind: "revision", offerId: w.offer.id } });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("offer_not_sent");
  });

  it("generate: the next rN, the sent offer's row and object untouched (201)", async () => {
    const w = await wizardOffer();
    await markSent(w.dealId, w.offer.id);
    const sentRow = await db.dealOffer.findUniqueOrThrow({ where: { id: w.offer.id } });
    const draft = await startDraft(w.dealId, { target: { kind: "revision", offerId: w.offer.id } });
    expect(draft.status).toBe(201);
    expect(draft.json.target).toMatchObject({ kind: "revision", offerId: w.offer.id, reference: w.offer.reference });
    expect(draft.json.template.id).toBe(w.template.id);
    const res = await generate(w.dealId, draft.json.version);
    expect(res.status).toBe(201);
    expect(res.json.reference).toBe(`${w.offer.reference}r1`);
    expect(res.json.id).not.toBe(w.offer.id);
    const after = await db.dealOffer.findUniqueOrThrow({ where: { id: w.offer.id } });
    expect(after).toEqual(sentRow);
    expect(bucket.objects.has(sentRow.objectKey)).toBe(true);
    expect(await offers(w.dealId)).toHaveLength(2);
    expect(await db.offerDraft.count()).toBe(0);
  });

  it("a revision of an offer dated more than 90 days ago keeps that date and is incomplete until a new one is set (DD-42)", async () => {
    const w = await wizardOffer((a) => (a.client.date = day(-80)));
    await markSent(w.dealId, w.offer.id);
    // time passes: the stored date is now 100 days old
    const stored = await db.dealOffer.findUniqueOrThrow({ where: { id: w.offer.id } });
    const snapshot = stored.snapshot as any;
    snapshot.wizard.answers.client.date = day(-100);
    await db.dealOffer.update({ where: { id: w.offer.id }, data: { snapshot } });

    const draft = await startDraft(w.dealId, { target: { kind: "revision", offerId: w.offer.id } });
    expect(draft.json.answers.client.date).toBe(day(-100));
    const refused = await generate(w.dealId, draft.json.version);
    expect(refused.status).toBe(422);
    expect(refused.json.code).toBe("offer_incomplete");
    expect(refused.json.invalid).toContainEqual({ name: "client:date", label: null, step: "client", code: "date_out_of_range" });
    expect(await offers(w.dealId)).toHaveLength(1);

    const answers = structuredClone(draft.json.answers);
    answers.client.date = null;
    const saved = await call("PUT", `/deals/${w.dealId}/offer-draft`, {
      ifMatch: 1,
      body: { templateVersion: 1, target: { kind: "revision", offerId: w.offer.id }, answers },
    });
    expect(saved.status).toBe(200);
    expect((await generate(w.dealId, saved.json.version)).status).toBe(201);
  });
});

describe("a template that moved, and the offers a draft cannot start from", () => {
  it("reconciles against the template's new version: the notice fires, generation refuses until it is saved", async () => {
    const w = await wizardOffer();
    await db.offerTemplate.update({ where: { id: w.template.id }, data: { version: { increment: 1 } } });
    const draft = await startDraft(w.dealId, { target: { kind: "edit", offerId: w.offer.id } });
    expect(draft.status).toBe(201);
    expect(draft.json.templateVersion).toBe(1);
    expect(draft.json.template.version).toBe(2);
    expect((await call("GET", `/deals/${w.dealId}/offer-draft/summary`)).json.draft.templateChanged).toBe(true);
    const refused = await generate(w.dealId, draft.json.version);
    expect(refused.json.code).toBe("template_changed");
  });

  it("a legacy contract offer starts from `templateId` with its client lines and contacts, and needs one (422 template_required)", async () => {
    const { deal } = await readyDealWithProfiles();
    const company = (await db.deal.findUniqueOrThrow({ where: { id: deal.id } })).companyId;
    const person = await call("POST", "/contacts", { body: { companyId: company, firstName: "Ada", lastName: "Lovelace" } });
    const legacy = await insertOfferRow(
      deal.id,
      wizardOfferSnapshot({ wizard: undefined, clientLines: ["Cliente vecchio", "Via Vecchia 1"], contactIds: [person.json.id], contacts: ["Ada Lovelace"], place: "Bellinzona" }),
      { sent: true },
    );
    const template = await makeDraftTemplate();
    const none = await startDraft(deal.id, { target: { kind: "revision", offerId: legacy.id } });
    expect(none.status).toBe(422);
    expect(none.json.code).toBe("template_required");
    const res = await startDraft(deal.id, { target: { kind: "revision", offerId: legacy.id }, templateId: template.id });
    expect(res.status).toBe(201);
    expect(res.json.answers.client).toEqual({ lines: ["Cliente vecchio", "Via Vecchia 1"], contactIds: [person.json.id], place: "Bellinzona", date: null });
    expect(res.json.target).toMatchObject({ kind: "revision", offerId: legacy.id, offerVersion: 1 });
    expect(res.json.templateVersion).toBe(1);
  });

  it("an 018-summary offer is 409 offer_legacy, another deal's offer is 404, a deleted one is 404", async () => {
    const a = await readyDealWithProfiles();
    const b = await readyDealWithProfiles();
    const template = await makeDraftTemplate();
    const summary = await insertOfferRow(a.deal.id, { reference: "OF-2026-ABC123-1", validUntil: "2026-03-01", scope: { aiAssisted: false, manDaysTenths: 0 } }, { sent: true });
    const res = await startDraft(a.deal.id, { target: { kind: "revision", offerId: summary.id }, templateId: template.id });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("offer_legacy");
    const elsewhere = await insertOfferRow(b.deal.id, wizardOfferSnapshot({ wizard: undefined }), { sent: true });
    expect((await startDraft(a.deal.id, { target: { kind: "revision", offerId: elsewhere.id }, templateId: template.id })).status).toBe(404);
    await db.dealOffer.update({ where: { id: elsewhere.id }, data: { deletedAt: new Date(), deletedBy: "user-admin" } });
    expect((await startDraft(b.deal.id, { target: { kind: "revision", offerId: elsewhere.id }, templateId: template.id })).status).toBe(404);
    expect((await startDraft(a.deal.id, { target: { kind: "edit", offerId: "nope" }, templateId: template.id })).status).toBe(404);
    expect(await db.offerDraft.count()).toBe(0);
  });
});
