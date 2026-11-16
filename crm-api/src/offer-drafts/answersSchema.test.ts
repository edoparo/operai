import { describe, expect, it } from "bun:test";
import { AnswersSchema, jsonPath } from "./answersSchema";

/**
 * zod 4 changed what a few validators mean (GHSA-mrhx-c7xc-m3w5 migration): `.safe()` is now `.int()`, so a
 * decimal quantity or rate would have been refused with a 422 `answers_invalid` and every stored draft holding
 * one would have read as 409 `draft_invalid`. These pin the numbers the wizard really sends.
 */

const answers = (over: Record<string, unknown> = {}) => ({
  v: 1,
  client: { lines: ["Via Roma 1"], contactIds: [], place: "Lugano", date: null },
  fields: {},
  prefilled: {},
  blocks: {},
  lists: {},
  tables: {},
  costs: { lines: {}, extra: [], columns: { position: true, unit: true }, showTotals: true },
  handEdits: {},
  orphanedEdits: [],
  validityDays: 30,
  aiAssisted: false,
  effortAnnex: false,
  attachmentIds: [],
  lastStep: "client",
  ...over,
});

const costs = (line: Record<string, unknown>) => answers({ costs: { lines: { fasi: line }, extra: [], columns: { position: true, unit: true }, showTotals: true } });

describe("numbers inside the wizard answers", () => {
  it("a decimal quantity and a decimal field value are accepted", () => {
    expect(AnswersSchema.safeParse(costs({ quantity: 1.5, unitCents: 1000 })).success).toBe(true);
    expect(AnswersSchema.safeParse(answers({ fields: { GIORNI: 12.75 } })).success).toBe(true);
    const extra = [{ id: "e", description: "d", kind: "one_off", unitCents: 100, percentBp: null, quantity: 2.25 }];
    expect(AnswersSchema.safeParse(answers({ costs: { lines: {}, extra, columns: { position: true, unit: true }, showTotals: true } })).success).toBe(true);
  });

  it("the safe-integer range still bounds them, both ways, and a non-finite number is refused", () => {
    expect(AnswersSchema.safeParse(costs({ quantity: Number.MAX_SAFE_INTEGER })).success).toBe(true);
    expect(AnswersSchema.safeParse(costs({ quantity: Number.MIN_SAFE_INTEGER })).success).toBe(true);
    expect(AnswersSchema.safeParse(costs({ quantity: 2 ** 53 })).success).toBe(false);
    expect(AnswersSchema.safeParse(costs({ quantity: -(2 ** 53) })).success).toBe(false);
    expect(AnswersSchema.safeParse(costs({ quantity: Infinity })).success).toBe(false);
    expect(AnswersSchema.safeParse(costs({ quantity: Number.NaN })).success).toBe(false);
  });

  it("the NUL refusal keeps the wording crm-ui matches on", () => {
    const parsed = AnswersSchema.safeParse(answers({ fields: { A: "a\u0000b" } }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]!.message).toContain("contains a NUL character");
  });
});

describe("jsonPath", () => {
  it("renders names and indexes, and survives a symbol key", () => {
    expect(jsonPath(["fields", "A B", "x", 2])).toBe('fields["A B"].x[2]');
    expect(jsonPath(["fields", Symbol("s")])).toBe('fields["Symbol(s)"]');
  });
});
