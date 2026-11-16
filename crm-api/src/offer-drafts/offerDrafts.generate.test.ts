/**
 * Generating an offer from the stored draft (specs/20261115-crm-offer-wizard T32; AC-1.1, AC-2.2, AC-2.4, AC-3.5,
 * AC-3.6, AC-4.3, AC-4.6, AC-5.4, AC-6.6, AC-8.4; DD-7, DD-32, DD-42, DD-44, DD-52): `POST …/offer-draft/generate` for a new offer.
 */

import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from "bun:test";
// The test world first: it sets the environment the other modules read when they load.
import {
  bucket,
  call,
  db,
  makeDraftTemplate,
  memoryStorage,
  readyDealWithProfiles,
  resetWorld,
  storedPdfAttachment,
} from "../test-support/world";
import { WELLD_CH_IT_V1 } from "../offer-templates/wizardSeeds/welldChIt";
import { setStorageForTests } from "../lib/storage";
import { resolveSectionForEdit } from "../offers/engine/edit";
import { sampleAnswers, type WizardAnswers, type WizardContext } from "../offers/engine/answers";
import { resolveOffer } from "../offers/engine/resolve";
import { parseTemplate } from "../offers/engine/syntax";

beforeEach(resetWorld);
afterEach(() => setSystemTime());

const YEAR = new Date().getUTCFullYear();
const noMatch = { "If-None-Match": "*" };

async function startDraft(source?: string, entity: "welld_ch" | "welld_it" = "welld_ch", language: "it" | "en" = "it") {
  const { deal } = await readyDealWithProfiles({ entity });
  const template = await makeDraftTemplate({ entity, language, ...(source ? { source } : {}) });
  const created = await call("POST", `/deals/${deal.id}/offer-draft`, { body: { templateId: template.id }, headers: noMatch });
  if (created.status !== 201) throw new Error(`draft: ${created.status} ${JSON.stringify(created.json)}`);
  return { dealId: deal.id, template, draft: created.json };
}

/** Saves `change(answers)` through the API. */
async function edit(s: { dealId: string; draft: any }, change: (answers: any) => void) {
  const answers = structuredClone(s.draft.answers);
  change(answers);
  const res = await call("PUT", `/deals/${s.dealId}/offer-draft`, {
    ifMatch: s.draft.version,
    body: { templateVersion: s.draft.templateVersion, target: { kind: "new" }, answers },
  });
  if (res.status !== 200) throw new Error(`save: ${res.status} ${JSON.stringify(res.json)}`);
  s.draft = res.json;
}

const generate = (s: { dealId: string; draft: { version: number } }, over: { ifMatch?: number | null; as?: "admin" | "salesCh" } = {}) =>
  call("POST", `/deals/${s.dealId}/offer-draft/generate`, { as: over.as ?? "admin", ...(over.ifMatch === null ? {} : { ifMatch: over.ifMatch ?? s.draft.version }) });

const offers = (dealId: string) => db.dealOffer.findMany({ where: { dealId }, orderBy: { number: "asc" } });

/** The engine's context for `language`, from the context route, as the browser builds it. */
async function engineContext(dealId: string, language: "it" | "en"): Promise<WizardContext> {
  const { latestOffer: _l, estimate, ...rest } = (await call("GET", `/deals/${dealId}/offer-wizard/context`)).json;
  const { annex: _a, ...facts } = estimate;
  // the context route carries no address lines until T62 (DD-54); the seeds now read them (T61), so a stand-in keeps the helper whole
  return { issuerAddressLines: [], ...rest, language, estimate: facts } as WizardContext;
}

const issuesOf = (offer: { missing: { name: string; label: string | null; step: string }[]; invalid: { name: string; label: string | null; step: string; code: string }[] }) => ({
  missing: offer.missing.map(({ name, label, step }) => ({ name, label, step })),
  invalid: offer.invalid.map(({ name, label, step, code }) => ({ name, label, step, code })),
});

describe("a complete draft", () => {
  it("is 201: reference 0001/<year> then r1, the template's language, the price the lines give, the draft gone (AC-1.1, AC-2.2, AC-6.6)", async () => {
    const s = await startDraft();
    const res = await generate(s);
    expect(res.status).toBe(201);
    expect(res.headers.get("ETag")).toBe('"1"');
    expect(res.json).toMatchObject({
      reference: `0001/${YEAR}`,
      language: "it",
      origin: "wizard",
      currency: "CHF",
      // the deal amount twice: split across the releases, and the one-off "Giornate" line
      priceCents: 2 * 9_000_050,
      templateName: s.template.name,
      sent: null,
      version: 1,
    });
    expect(await db.offerDraft.count()).toBe(0);
    const [row] = await offers(s.dealId);
    expect(row!.sequenceNo).toBe(1);
    expect(bucket.objects.has(row!.objectKey)).toBe(true);
    const snapshot = row!.snapshot as any;
    expect(snapshot.wizard.templateVersion).toBe(1);
    expect(snapshot.wizard.answers.client.lines[0]).toBe("Acme Holding SA");
    expect(snapshot.reference).toBe(`0001/${YEAR}`);
    // the next offer of the deal is a revision, once the first went out
    expect((await call("POST", `/deals/${s.dealId}/offers/${res.json.id}/sent`)).status).toBe(200);
    const next = await call("POST", `/deals/${s.dealId}/offer-draft`, { body: { templateId: s.template.id }, headers: noMatch });
    const second = await generate({ dealId: s.dealId, draft: next.json });
    expect(second.status).toBe(201);
    expect(second.json.reference).toBe(`0001/${YEAR}r1`);
  });

  it("keeps the template's language for an English template on an Italian deal", async () => {
    const s = await startDraft(undefined, "welld_ch", "en");
    const res = await generate(s);
    expect(res.status).toBe(201);
    expect(res.json.language).toBe("en");
    expect(((await offers(s.dealId))[0]!.snapshot as any).clientLines[3]).toBe("Switzerland");
  });

  it("dates a draft with no printed date on the server's day (DD-16)", async () => {
    for (const as of ["admin"] as const) await call("GET", "/scope", { as });
    const s = await startDraft();
    setSystemTime(new Date("2026-03-04T23:30:00Z"));
    const res = await generate(s);
    expect(res.status).toBe(201);
    const snapshot = (await offers(s.dealId))[0]!.snapshot as any;
    expect(snapshot.issuedOn).toBe("2026-03-04");
    expect(snapshot.validUntil).toBe("2026-04-03");
    expect(res.json.reference).toBe("0001/2026");
  });

  it("the reference prints in the snapshot's text from the SECOND resolve; a template printing it is not incomplete for the first (DD-44)", async () => {
    const source = `${"@@salutation Spett.le\n\nRif. **[RIF]** per [CLIENTE].\n\n## OGGETTO\n@@step scope\nRiferimento [RIF].\n\n## COSTI\n@@step costs\n@@costs\n@@line a one_off | Voce | unit=deal | qty=1\n@@end\n\n@@field RIF\nsource: reference\n\n@@field CLIENTE\nsource: client\n"}`;
    const s = await startDraft(source);
    const res = await generate(s);
    expect(res.status).toBe(201);
    const snapshot = (await offers(s.dealId))[0]!.snapshot as any;
    expect(snapshot.opening).toContain(`0001/${YEAR}`);
    expect(snapshot.sections[0].body).toContain(`0001/${YEAR}`);
    expect(JSON.stringify(snapshot)).not.toMatch(/[-]/);
  });

  it("a T3 draft with 'Parametri del servizio' and 'Condizioni generali' edited by hand prints the reference in both, with no token left (DD-52)", async () => {
    const seed = WELLD_CH_IT_V1.find((entry) => entry.code === "T3")!;
    const { deal } = await readyDealWithProfiles();
    const list = await call("GET", "/offer-templates?entity=welld_ch&formats=wizard");
    const template = list.json.items.find((t: { name: string }) => t.name === seed.name);
    const created = await call("POST", `/deals/${deal.id}/offer-draft`, { body: { templateId: template.id }, headers: noMatch });
    expect(created.status).toBe(201);
    const { ast } = parseTemplate(seed.source);
    const context = await engineContext(deal.id, "it");
    // a complete set of answers, the draft's own client block
    const complete: WizardAnswers = { ...sampleAnswers(ast, "it"), client: { ...created.json.answers.client } };
    const sections = ast.annexes.flatMap((annex) => annex.sections);
    const keys = ["Parametri del servizio", "Condizioni generali"].map((heading) => sections.find((section) => section.heading === heading)!.key);
    for (const key of keys) {
      const text = resolveSectionForEdit(ast, complete, context, key)!;
      expect(text.tokens).toEqual([]);
      expect(text.body).toContain("⟪REF⟫");
      complete.handEdits[key] = { heading: text.heading, body: text.body, sourceHeading: text.heading };
    }
    const saved = await call("PUT", `/deals/${deal.id}/offer-draft`, {
      ifMatch: 1,
      body: { templateVersion: 1, target: { kind: "new" }, answers: complete },
    });
    expect(saved.status).toBe(200);
    const res = await generate({ dealId: deal.id, draft: saved.json });
    expect(res.status).toBe(201);
    const snapshot = (await offers(deal.id))[0]!.snapshot as any;
    const annex = snapshot.textAnnexes.find((a: { designation: string }) => a.designation === "SLA");
    for (const heading of ["Parametri del servizio", "Condizioni generali"]) {
      const section = annex.sections.find((x: { heading: string }) => x.heading === heading);
      expect(section.body).toContain(`0001/${YEAR}`);
    }
    expect(JSON.stringify({ ...snapshot, wizard: undefined })).not.toMatch(/[⟪⟫⟦⟧]/);
  });
});

describe("an incomplete draft (AC-3.5, AC-3.6, DD-32, DD-42)", () => {
  const SOURCE = [
    "@@salutation Spett.le",
    "",
    "Cliente **[CLIENTE]**, aliquota [ALIQUOTA]%, nota [NOTA].",
    "",
    "## OGGETTO",
    "@@step scope",
    "Nota: [NOTA].",
    "",
    "## COSTI",
    "@@step costs",
    "@@costs",
    "@@line a one_off | Voce A | unit=deal | qty=1",
    "@@line sconto discount | Sconto concordato | unit=?",
    "@@total **TOTALE UNO**",
    "@@line b yearly | Canone | unit=? | qty=1",
    "@@total **TOTALE DUE**",
    "@@end",
    "",
    "@@field CLIENTE",
    "source: client",
    "",
    "@@field NOTA",
    "label: Nota",
    "",
    "@@field ALIQUOTA",
    "label: Aliquota",
    "kind: percentage",
    "",
  ].join("\n");

  it("is 422 offer_incomplete naming exactly what resolveOffer names for the stored draft, no value in it, nothing created", async () => {
    const s = await startDraft(SOURCE);
    const secret = "SEGRETO-DA-NON-RIVELARE";
    const far = new Date(Date.now() + 91 * 86_400_000).toISOString().slice(0, 10);
    await edit(s, (a) => {
      a.fields.ALIQUOTA = "150"; // invalid percentage; NOTA is missing
      a.costs.lines.sconto = { unitCents: 90_000_000 }; // over the span's one-off lines
      a.costs.lines.b = { unitCents: 5_000, quantity: 1 };
      a.costs.extra = [{ id: "x1", description: secret, kind: "discount", unitCents: null, percentBp: 1000, quantity: 1 }]; // % discount in a two-total table
      a.client.date = far; // 91 days from the server's day
    });
    // an over-long hand edit is saved (the dialog refuses it, the resolver reports it) and printed nowhere
    await edit(s, (a) => {
      a.handEdits["OGGETTO#0"] = { heading: "Oggetto", body: `${secret} ${"x".repeat(20_001)}`, sourceHeading: "OGGETTO" };
    });
    const answers = (await db.offerDraft.findUniqueOrThrow({ where: { dealId: s.dealId } })).answers;

    const res = await generate(s);
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("offer_incomplete");

    const { ast } = parseTemplate(SOURCE);
    const expected = issuesOf(resolveOffer(ast, answers as unknown as WizardAnswers, await engineContext(s.dealId, "it")));
    expect({ missing: res.json.missing, invalid: res.json.invalid }).toEqual(expected);
    const names = [...res.json.missing, ...res.json.invalid].map((i: { name: string }) => i.name);
    expect(names).toEqual(expect.arrayContaining(["NOTA", "ALIQUOTA", "cost:sconto", "cost:extra:x1", "section:OGGETTO#0", "client:date"]));
    const codes = res.json.invalid.map((i: { code: string }) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["out_of_range", "discounts_exceed_span", "percent_discount_multi_total", "section_too_long", "date_out_of_range"]));
    // names and labels only, never a value
    expect(JSON.stringify(res.json)).not.toContain(secret);
    expect(JSON.stringify(res.json)).not.toContain("150");

    expect(await offers(s.dealId)).toHaveLength(0);
    expect([...bucket.objects.keys()].filter((key) => key.startsWith("offers/"))).toEqual([]);
    expect(await db.offerDraft.count()).toBe(1);
    expect(await db.offerSequence.count()).toBe(0);
  });

  it("11 cost lines is `too_many_cost_lines` inside offer_incomplete (AC-4.3)", async () => {
    const lines = Array.from({ length: 8 }, (_, i) => `@@line l${i} one_off | Voce ${i} | unit=deal | qty=1`);
    const source = ["@@salutation Spett.le", "", "Testo.", "", "## COSTI", "@@step costs", "@@costs", ...lines, "@@end", ""].join("\n");
    const s = await startDraft(source);
    expect((await generate(s)).status).toBe(201); // 8 lines are fine
    const t = await startDraft(source);
    await edit(t, (a) => {
      a.costs.extra = [1, 2, 3].map((n) => ({ id: `e${n}`, description: `Extra ${n}`, kind: "one_off", unitCents: 100, percentBp: null, quantity: 1 }));
    });
    const res = await generate(t);
    expect(res.status).toBe(422);
    expect(res.json.invalid).toContainEqual({ name: "cost:*", label: null, step: "costs", code: "too_many_cost_lines" });
  });
});

/** QE D1 / security M-1: the resolved text is bounded, so generate cannot be made to build a gigabyte (one process serves every user). */
describe("a template that repeats an answer (QE D1, M-1)", () => {
  const sourceOf = (references: number) =>
    [
      "@@salutation Spett.le",
      "",
      "## OGGETTO",
      "@@step scope",
      "[D]".repeat(references),
      "",
      "## COSTI",
      "@@step costs",
      "@@costs",
      "@@line a one_off | Voce | unit=100 | qty=1",
      "@@total **TOTALE**",
      "@@end",
      "",
      "@@field D",
      "label: Descrizione",
      "",
    ].join("\n");

  it("is 422 offer_incomplete with section_too_long, quickly and without memory growth, nothing created", async () => {
    const source = sourceOf(40_000);
    const s = await startDraft(source);
    await edit(s, (a) => (a.fields.D = "x".repeat(20_000)));
    Bun.gc(true);
    const rss = process.memoryUsage().rss;
    const started = performance.now();
    const res = await generate(s);
    const ms = performance.now() - started;
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("offer_incomplete");
    expect(res.json.invalid.map((issue: { name: string; code: string }) => [issue.name, issue.code])).toEqual([["section:OGGETTO#0", "section_too_long"]]);
    expect(JSON.stringify(res.json).length).toBeLessThan(5_000);
    expect(ms).toBeLessThan(3_000);
    expect(process.memoryUsage().rss - rss).toBeLessThan(150 * 1024 * 1024);
    expect(await offers(s.dealId)).toHaveLength(0);
    expect([...bucket.objects.keys()].filter((key) => key.startsWith("offers/"))).toEqual([]);
    expect(await db.offerDraft.count()).toBe(1);
    expect(await db.offerSequence.count()).toBe(0);
  });

  it("a section whose first line alone passes the build bound is 422 offer_incomplete, not issued without it (QE D6)", async () => {
    const s = await startDraft(sourceOf(1));
    await edit(s, (a) => (a.fields.D = "*".repeat(10_600))); // 21 200 characters once escaped
    const res = await generate(s);
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("offer_incomplete");
    expect(res.json.invalid.map((issue: { name: string; code: string }) => [issue.name, issue.code])).toEqual([["section:OGGETTO#0", "section_too_long"]]);
    expect(await offers(s.dealId)).toHaveLength(0);
    expect(await db.offerSequence.count()).toBe(0);
  });

  it("a section at the limit still generates, and the stored snapshot stays small (a few times the text, not its multiple)", async () => {
    const s = await startDraft(sourceOf(1));
    await edit(s, (a) => (a.fields.D = "x".repeat(20_000)));
    const res = await generate(s);
    expect(res.status).toBe(201);
    const row = (await offers(s.dealId))[0]!;
    expect(JSON.stringify(row.snapshot).length).toBeLessThan(120_000);
  });
});

describe("what is checked before anything is made", () => {
  it("is 428 without If-Match, 409 for a stale version, and 404 without a draft", async () => {
    const s = await startDraft();
    expect((await generate(s, { ifMatch: null })).status).toBe(428);
    await edit(s, (a) => (a.lastStep = "costs"));
    const stale = await generate({ dealId: s.dealId, draft: { version: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe("version_conflict");
    expect(await offers(s.dealId)).toHaveLength(0);
    expect(await db.offerDraft.count()).toBe(1);
    const none = await readyDealWithProfiles();
    const missing = await generate({ dealId: none.deal.id, draft: { version: 1 } });
    expect(missing.status).toBe(404);
    expect(missing.json.code).toBe("draft_not_found");
  });

  it("is 409 template_changed once the template was edited, template_archived once archived (AC-8.4)", async () => {
    const s = await startDraft();
    await db.offerTemplate.update({ where: { id: s.template.id }, data: { version: { increment: 1 } } });
    const changed = await generate(s);
    expect(changed.status).toBe(409);
    expect(changed.json.code).toBe("template_changed");
    await db.offerTemplate.update({ where: { id: s.template.id }, data: { archivedAt: new Date() } });
    const archived = await generate(s);
    expect(archived.json).toMatchObject({ code: "template_archived", templateId: s.template.id });
    expect(await offers(s.dealId)).toHaveLength(0);
    expect(await db.offerDraft.count()).toBe(1);
  });

  it("is 409 estimate_not_ready when the estimate went away, and offer_not_sent while the latest offer is unsent", async () => {
    const s = await startDraft();
    await db.offerTemplate.count();
    const link = await db.dealEstimate.findUniqueOrThrow({ where: { dealId: s.dealId } });
    await db.dealEstimate.delete({ where: { dealId: s.dealId } });
    const gate = await generate(s);
    expect(gate.status).toBe(409);
    expect(gate.json.code).toBe("estimate_not_ready");
    await db.dealEstimate.create({ data: link });
    const first = await startDraft();
    expect((await generate(first)).status).toBe(201);
    const other = await call("POST", `/deals/${first.dealId}/offer-draft`, { body: { templateId: first.template.id }, headers: noMatch });
    // the first offer is still unsent: the draft could not even be made; make it by hand to test the generation gate
    expect(other.status).toBe(409);
    expect(other.json.code).toBe("offer_not_sent");
    await db.offerDraft.create({
      data: { dealId: first.dealId, templateId: first.template.id, templateVersion: 1, answers: first.draft.answers, createdBy: "user-admin", updatedBy: "user-admin" },
    });
    const blocked = await generate({ dealId: first.dealId, draft: { version: 1 } });
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe("offer_not_sent");
    expect(await offers(first.dealId)).toHaveLength(1);
  });

  it("is 422 contact_not_in_company for a contact of another company, and attachment_invalid for another deal's file", async () => {
    const s = await startDraft();
    const other = await readyDealWithProfiles();
    const stranger = await call("POST", "/contacts", { body: { companyId: (await db.deal.findUniqueOrThrow({ where: { id: other.deal.id } })).companyId, firstName: "Not", lastName: "Ours" } });
    await edit(s, (a) => (a.client.contactIds = [stranger.json.id]));
    const res = await generate(s);
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("contact_not_in_company");
    const foreign = await storedPdfAttachment(other.deal.id);
    await edit(s, (a) => {
      a.client.contactIds = [];
      a.attachmentIds = [foreign.id];
    });
    const bad = await generate(s);
    expect(bad.status).toBe(422);
    expect(bad.json.code).toBe("attachment_invalid");
    expect(await offers(s.dealId)).toHaveLength(0);
  });

  it("is refused for a caller outside the scope with the same 403 whatever the draft", async () => {
    const s = await startDraft(undefined, "welld_it");
    const res = await generate(s, { as: "salesCh" });
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("out_of_scope");
    expect(await db.offerDraft.count()).toBe(1);
  });
});

describe("a failure after the number was taken leaves nothing behind (ADR § Decision 3)", () => {
  it("an attachment that cannot be rendered keeps the draft, the number and the bucket as they were", async () => {
    const s = await startDraft();
    const garbage = await storedPdfAttachment(s.dealId, "broken.pdf", new Uint8Array([1, 2, 3]));
    await edit(s, (a) => (a.attachmentIds = [garbage.id]));
    const before = [...bucket.objects.keys()].length;
    const res = await generate(s);
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("attachment_unreadable");
    expect(await offers(s.dealId)).toHaveLength(0);
    expect(await db.offerDraft.count()).toBe(1);
    expect(await db.offerSequence.count()).toBe(0);
    expect([...bucket.objects.keys()].length).toBe(before);
  });

  it("a colleague's save during the generation: the draft delete matches no row, 409, the object is deleted, no offer, the newer draft stays", async () => {
    const s = await startDraft();
    setStorageForTests({
      ...memoryStorage,
      async putObject(key, bytes, type) {
        await memoryStorage.putObject(key, bytes, type);
        await db.offerDraft.update({ where: { dealId: s.dealId }, data: { version: { increment: 1 } } });
      },
    });
    const res = await generate(s);
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("version_conflict");
    expect(res.json.currentVersion).toBe(2);
    expect(await offers(s.dealId)).toHaveLength(0);
    expect(await db.offerSequence.count()).toBe(0);
    expect([...bucket.objects.keys()].filter((key) => key.startsWith("offers/"))).toEqual([]);
    expect(bucket.deleted.some((key) => key.startsWith("offers/"))).toBe(true);
    expect((await db.offerDraft.findUniqueOrThrow({ where: { dealId: s.dealId } })).version).toBe(2);
  });

  it("logs one content-free line", async () => {
    const s = await startDraft();
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await generate(s);
      const lines = log.mock.calls.map((args) => args.join(" ")).filter((line) => line.includes("[offers]"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(`offerId=${res.json.id}`);
      expect(lines[0]).toContain(`dealId=${s.dealId}`);
      expect(lines[0]).toContain("target=new");
      for (const content of ["Acme", "Grid analytics", "Via Roma", "Auth"]) expect(lines[0]).not.toContain(content);
    } finally {
      log.mockRestore();
    }
  });
});
