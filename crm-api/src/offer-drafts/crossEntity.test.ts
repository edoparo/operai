/**
 * Nothing in the wizard is entity-, language- or currency-specific (specs/20261115-crm-offer-wizard T36; AC-9.3,
 * AC-2.5): a welld_it template in English, created through the API, generates end to end on a deal in EUR. The PDF
 * prints every amount and the template's `source: currency` field in EUR, with the English document words; it
 * supersedes only welld_it's English legacy templates, and welld_ch's Italian ones are untouched.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { bucket, call, db, makeWizardTemplate, readyDealWithProfiles, resetWorld, wizardBody } from "../test-support/world";
import { renderContractPdf, type DrawnText } from "../offers/contractPdf";
import type { ContractSnapshot } from "../offers/contract";
import { formatAmount } from "../offers/engine/format";

beforeEach(resetWorld);

const YEAR = new Date().getUTCFullYear();
const noMatch = { "If-None-Match": "*" };

/** An English contract with its currency as a field, a fixed amount and a deal-amount line. */
const ENGLISH_SOURCE = [
  "@@salutation Dear Sirs",
  "@@acceptance The Client",
  "",
  "We are pleased to submit our offer to **[CLIENT]**.",
  "",
  "## SCOPE",
  "@@step scope",
  "All amounts are in [CURRENCY]. Out-of-scope work is invoiced at 140.- [CURRENCY]/hour.",
  "",
  "## COSTS",
  "@@step costs",
  "@@costs position unit",
  "@@line work one_off | Implementation | unit=deal | qty=1",
  "@@line support yearly | Annual support | unit=[SUPPORT_FEE] | qty=1",
  "@@total **TOTAL**",
  "@@end",
  "",
  "@@field CLIENT",
  "source: client",
  "",
  "@@field CURRENCY",
  "source: currency",
  "",
  "@@field SUPPORT_FEE",
  "label: Annual support fee",
  "kind: amount",
  "default: 1200",
  "",
].join("\n");

const legacy = (entity: "welld_ch" | "welld_it", language: "it" | "en", archived = false) =>
  db.offerTemplate.count({ where: { entity, language, format: "sections", archivedAt: archived ? { not: null } : null } });

describe("a welld_it English wizard template on an EUR deal (AC-9.3, AC-2.5)", () => {
  it("supersedes only welld_it's English legacy templates, and generates end to end with every amount in EUR", async () => {
    // both entities' legacy defaults are seeded on first read (018)
    await call("GET", "/offer-templates?entity=welld_ch");
    await call("GET", "/offer-templates?entity=welld_it");
    expect([await legacy("welld_it", "en"), await legacy("welld_it", "it"), await legacy("welld_ch", "it"), await legacy("welld_ch", "en")]).toEqual([7, 7, 7, 7]);

    const template = await makeWizardTemplate({ entity: "welld_it", language: "en", name: "Supply contract", source: ENGLISH_SOURCE });
    expect(template).toMatchObject({ entity: "welld_it", language: "en", format: "wizard" });

    // welld_it's English legacy templates are archived; everything else keeps its rows exactly as they were
    expect([await legacy("welld_it", "en"), await legacy("welld_it", "en", true)]).toEqual([0, 7]);
    expect([await legacy("welld_it", "it"), await legacy("welld_ch", "it"), await legacy("welld_ch", "en")]).toEqual([7, 7, 7]);
    const untouched = await db.offerTemplate.findMany({ where: { OR: [{ entity: "welld_ch" }, { entity: "welld_it", language: "it" }] } });
    expect(untouched.length).toBe(21);
    for (const row of untouched) expect([row.version, row.archivedAt]).toEqual([1, null]);
    expect(await db.offerTemplate.count({ where: { entity: "welld_ch", format: "wizard" } })).toBe(0);

    // an EUR deal of welld_it, with the entity's letterhead data and an estimate
    const { deal } = await readyDealWithProfiles({ entity: "welld_it" });
    await db.deal.update({ where: { id: deal.id }, data: { currency: "EUR" } });

    const created = await call("POST", `/deals/${deal.id}/offer-draft`, { body: { templateId: template.id }, headers: noMatch });
    expect(created.status).toBe(201);
    const generated = await call("POST", `/deals/${deal.id}/offer-draft/generate`, { as: "admin", ifMatch: created.json.version });
    expect(generated.status).toBe(201);
    expect(generated.json).toMatchObject({
      reference: `0001/${YEAR}`,
      language: "en",
      origin: "wizard",
      currency: "EUR",
      // the deal's 90 000.50 and the annual support fee: the stored price is the one-off lines only
      priceCents: 9_000_050,
      templateName: "Supply contract",
    });

    // the stored PDF is a real document
    const [row] = await db.dealOffer.findMany({ where: { dealId: deal.id } });
    const stored = bucket.objects.get(row!.objectKey)!;
    expect((await PDFDocument.load(stored.bytes!)).getPageCount()).toBeGreaterThan(0);

    // what the renderer draws for that snapshot: the same function the route called, with its draw log
    const snapshot = row!.snapshot as unknown as ContractSnapshot;
    expect(snapshot.costs.currency).toBe("EUR");
    const drawLog: DrawnText[] = [];
    await renderContractPdf(snapshot, { letterhead: null, attachments: [] }, { drawLog });
    const drawn = drawLog.map((entry) => entry.text);
    const all = drawn.join("\n");

    // every amount in EUR, with EUR's separators, and the currency field printed as EUR
    expect(drawn).toContain(formatAmount(9_000_050, "EUR"));
    expect(drawn).toContain(formatAmount(120_000, "EUR"));
    expect(drawn).toContain(formatAmount(9_120_050, "EUR"));
    expect(formatAmount(9_000_050, "EUR")).toBe("90.000,50");
    expect(all).toContain("All amounts are in EUR. Out-of-scope work is invoiced at 140.- EUR/hour.");
    expect(drawn).toContain("EUR / unit");
    expect(drawn).toContain("Total EUR");
    expect(all).not.toContain("CHF");
    expect(all).not.toContain("’");

    // the document words are English
    for (const word of ["Acceptance", "Place and date:", "Valid signature of the Client:", "Item", "Qty", "TOTAL"]) expect(drawn).toContain(word);
    expect(drawn).toContain(`SUPPLY CONTRACT – Ref. 0001/${YEAR}`);
    expect(all).not.toContain("CONTRATTO");
    expect(all).not.toContain("Per accettazione");
    expect(drawn).toContain("1. SCOPE");
    expect(drawn).toContain("2. COSTS");
  });

  it("welld_ch's Italian templates are still there to generate with: the legacy route is untouched for them", async () => {
    await call("GET", "/offer-templates?entity=welld_ch");
    await call("GET", "/offer-templates?entity=welld_it");
    await makeWizardTemplate({ entity: "welld_it", language: "en", name: "Supply contract", source: ENGLISH_SOURCE });
    const list = await call("GET", "/offer-templates?entity=welld_ch");
    const items = list.json.items as { language: string; format: string; archived: boolean }[];
    expect(items.filter((item) => item.language === "it" && item.format === "sections").length).toBe(7);
    expect(items.filter((item) => item.language === "it" && item.archived)).toEqual([]);
  });

  it("the same template text works for welld_ch in Italian wording: no entity or language branch of behaviour", async () => {
    const template = await makeWizardTemplate(wizardBody({ entity: "welld_ch", language: "it", name: "Contratto", source: ENGLISH_SOURCE.replace("Dear Sirs", "Spett.le") }));
    const { deal } = await readyDealWithProfiles({ entity: "welld_ch" });
    const created = await call("POST", `/deals/${deal.id}/offer-draft`, { body: { templateId: template.id }, headers: noMatch });
    const generated = await call("POST", `/deals/${deal.id}/offer-draft/generate`, { as: "admin", ifMatch: created.json.version });
    expect(generated.status).toBe(201);
    expect(generated.json).toMatchObject({ language: "it", currency: "CHF" });
  });
});
