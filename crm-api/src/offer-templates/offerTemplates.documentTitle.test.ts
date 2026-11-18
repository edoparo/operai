/**
 * The words of the document title, set per offer template and per language: stored, read, replaced, copied and refused as
 * the API says (src/offers/documentTitle.ts). The drawing of the title is covered by blocks.test.ts and contractPdf.test.ts, the
 * snapshot by offerDrafts.generate.test.ts and the unsaved text's preview by offerTemplates.tryPreview.test.ts.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { DOCUMENT_TITLE_MAX, DocumentTitleSchema, documentTitleData, documentTitleOf } from "../offers/documentTitle";
import { call, db, makeWizardTemplate, resetWorld, wizardBody } from "../test-support/world";

const create = (documentTitle: unknown, over: Record<string, unknown> = {}) =>
  call("POST", "/offer-templates", { body: wizardBody({ name: crypto.randomUUID().slice(0, 8), documentTitle, ...over }) });

const edit = (id: string, version: number, over: Record<string, unknown>) => {
  const { entity: _entity, ...body } = wizardBody({ name: "Renamed", ...over });
  return call("PUT", `/offer-templates/${id}`, { ifMatch: version, body });
};

describe("the document title schema", () => {
  const parse = (value: unknown) => DocumentTitleSchema.safeParse(value);

  it("trims, composes (NFC) and reads a blank as not set", () => {
    expect(parse({ it: "  OFFERTA  ", en: "   " })).toMatchObject({ success: true, data: { it: "OFFERTA", en: null } });
    expect(parse({ it: "é" })).toMatchObject({ success: true, data: { it: "é" } });
    expect(parse({})).toMatchObject({ success: true, data: {} });
    expect(parse({ it: null, en: null })).toMatchObject({ success: true, data: { it: null, en: null } });
  });

  it(`accepts ${DOCUMENT_TITLE_MAX} characters and refuses one more (counted after trimming)`, () => {
    expect(parse({ it: "x".repeat(DOCUMENT_TITLE_MAX) }).success).toBe(true);
    expect(parse({ it: ` ${"x".repeat(DOCUMENT_TITLE_MAX)} ` }).success).toBe(true);
    expect(parse({ it: "x".repeat(DOCUMENT_TITLE_MAX + 1) }).success).toBe(false);
  });

  it("refuses a line break, a tab, a control character, a NUL, and what the document cannot print", () => {
    for (const bad of ["two\nlines", "two\r\nlines", "a\rb", "a\tb", "a\u0007b", "a\u0000b", "日本語", "😀", "ab", "ab", "A⟪REF⟫B", "⟪REF⟫", "a⟦b⟧"]) {
      expect(parse({ en: bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("accepts what the document prints: accents, the WinAnsi punctuation and a question mark", () => {
    for (const good of ["OFFERTA COMMERCIALE", "Offerta n° 5 – “Pro”", "PROPOSTA D’INCARICO", "È più semplice?", "€ 100"]) {
      expect(parse({ it: good }).success, good).toBe(true);
    }
  });

  it("refuses an unknown language and a non-string", () => {
    expect(parse({ fr: "x" }).success).toBe(false);
    expect(parse({ it: 5 }).success).toBe(false);
    expect(parse("OFFERTA").success).toBe(false);
  });

  it("documentTitleData: absent leaves the columns alone, present replaces both", () => {
    expect(documentTitleData(undefined)).toEqual({});
    expect(documentTitleData({ it: "A" })).toEqual({ documentTitleIt: "A", documentTitleEn: null });
    expect(documentTitleData({})).toEqual({ documentTitleIt: null, documentTitleEn: null });
  });

  it("documentTitleOf picks the offer's language", () => {
    const row = { documentTitleIt: "OFFERTA", documentTitleEn: null };
    expect(documentTitleOf(row, "it")).toBe("OFFERTA");
    expect(documentTitleOf(row, "en")).toBeNull();
  });
});

describe("offer templates carry the words of the document title", () => {
  beforeEach(resetWorld);

  it("a template made without one has none: both members null, on create, read and list", async () => {
    const made = await makeWizardTemplate();
    expect(made.documentTitle).toEqual({ it: null, en: null });
    expect((await call("GET", `/offer-templates/${made.id}`)).json.documentTitle).toEqual({ it: null, en: null });
    const listed = (await call("GET", "/offer-templates?entity=welld_ch&formats=wizard")).json.items as { id: string; documentTitle: unknown }[];
    expect(listed.every((t) => t.documentTitle !== undefined)).toBe(true);
    expect(listed.find((t) => t.id === made.id)!.documentTitle).toEqual({ it: null, en: null });
    expect(await db.offerTemplate.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({ documentTitleIt: null, documentTitleEn: null });
  });

  it("a legacy template and every seeded one read as none", async () => {
    const items = (await call("GET", "/offer-templates?entity=welld_ch&formats=sections,wizard")).json.items as { documentTitle: unknown }[];
    expect(items.length).toBeGreaterThan(1);
    for (const item of items) expect(item.documentTitle).toEqual({ it: null, en: null });
  });

  it("creates with a title per language, trimmed, and reads it back", async () => {
    const res = await create({ it: "  OFFERTA ", en: "OFFER" });
    expect(res.status).toBe(201);
    expect(res.json.documentTitle).toEqual({ it: "OFFERTA", en: "OFFER" });
    expect((await call("GET", `/offer-templates/${res.json.id}`)).json.documentTitle).toEqual({ it: "OFFERTA", en: "OFFER" });
    expect(await db.offerTemplate.findUniqueOrThrow({ where: { id: res.json.id } })).toMatchObject({ documentTitleIt: "OFFERTA", documentTitleEn: "OFFER" });
  });

  it("one language alone, and a blank one, are not set", async () => {
    expect((await create({ it: "OFFERTA" })).json.documentTitle).toEqual({ it: "OFFERTA", en: null });
    expect((await create({ en: "OFFER", it: "" })).json.documentTitle).toEqual({ it: null, en: "OFFER" });
    expect((await create({})).json.documentTitle).toEqual({ it: null, en: null });
  });

  it("refuses a bad title on create with a 422 naming the field, and creates nothing", async () => {
    const before = await db.offerTemplate.count({ where: { format: "wizard" } });
    for (const [value, field] of [
      [{ it: "x".repeat(DOCUMENT_TITLE_MAX + 1) }, "documentTitle.it"],
      [{ en: "two\nlines" }, "documentTitle.en"],
      [{ en: "tab\there" }, "documentTitle.en"],
      [{ it: "A⟪REF⟫" }, "documentTitle.it"],
      [{ it: "a\u0000b" }, "documentTitle.it"],
      [{ fr: "x" }, "documentTitle"],
      [{ it: 5 }, "documentTitle.it"],
      ["OFFERTA", "documentTitle"],
    ] as const) {
      const res = await create(value);
      expect(res.status, JSON.stringify(value)).toBe(422);
      expect(res.json.field ?? res.json.errors?.[0]?.field, JSON.stringify(value)).toContain(field);
    }
    expect(await db.offerTemplate.count({ where: { format: "wizard" } })).toBe(before);
  });

  it("a PUT with the member replaces both languages; without it, leaves the stored words; null/blank clears", async () => {
    const made = (await create({ it: "OFFERTA", en: "OFFER" })).json;
    // absent: untouched (and the version still moves, as any save)
    const kept = await edit(made.id, made.version, {});
    expect(kept.status).toBe(200);
    expect(kept.json.documentTitle).toEqual({ it: "OFFERTA", en: "OFFER" });
    // present with one language: the other is cleared
    const replaced = await edit(made.id, kept.json.version, { documentTitle: { en: "PROPOSAL" } });
    expect(replaced.json.documentTitle).toEqual({ it: null, en: "PROPOSAL" });
    // present and empty: both cleared
    const cleared = await edit(made.id, replaced.json.version, { documentTitle: {} });
    expect(cleared.json.documentTitle).toEqual({ it: null, en: null });
    expect(await db.offerTemplate.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({ documentTitleIt: null, documentTitleEn: null });
  });

  it("a bad title on a PUT is a 422 that leaves the row and its version as they were", async () => {
    const made = (await create({ it: "OFFERTA" })).json;
    const res = await edit(made.id, made.version, { documentTitle: { it: "x".repeat(DOCUMENT_TITLE_MAX + 1) } });
    expect(res.status).toBe(422);
    const row = await call("GET", `/offer-templates/${made.id}`);
    expect(row.json).toMatchObject({ version: made.version, documentTitle: { it: "OFFERTA", en: null } });
  });

  it("a duplicate carries the words of its source", async () => {
    const made = (await create({ it: "OFFERTA", en: "OFFER" })).json;
    const copy = await call("POST", `/offer-templates/${made.id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.json.documentTitle).toEqual({ it: "OFFERTA", en: "OFFER" });
  });

  it("archive and restore keep the words", async () => {
    const made = (await create({ it: "OFFERTA" })).json;
    await makeWizardTemplate({ name: "Keeper" });
    const archived = await call("POST", `/offer-templates/${made.id}/archive`, { ifMatch: made.version });
    expect(archived.json.documentTitle).toEqual({ it: "OFFERTA", en: null });
    const restored = await call("POST", `/offer-templates/${made.id}/restore`, { ifMatch: archived.json.version });
    expect(restored.json.documentTitle).toEqual({ it: "OFFERTA", en: null });
  });

  it("the database refuses a row whose words are blank, over the limit or on two lines (the CHECK, behind the API)", async () => {
    const made = (await create({})).json;
    const set = async (data: Record<string, unknown>) => {
      await db.offerTemplate.update({ where: { id: made.id }, data });
    };
    await expect(set({ documentTitleIt: "" })).rejects.toThrow();
    await expect(set({ documentTitleEn: "x".repeat(DOCUMENT_TITLE_MAX + 1) })).rejects.toThrow();
    await expect(set({ documentTitleEn: "a\nb" })).rejects.toThrow();
    await set({ documentTitleEn: "x".repeat(DOCUMENT_TITLE_MAX) });
  });
});
