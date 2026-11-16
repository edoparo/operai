/**
 * The resolved text is bounded WHILE it is built (specs/20261115-crm-offer-wizard, QE D1 / security M-1): a template of
 * a few thousand references to a 20 000-character answer used to resolve to hundreds of megabytes (one section, 1.8 s
 * for 2 000 references, about a gigabyte for the 150 000-character maximum), in the browser preview and in crm-api's
 * generate, where one process serves every user. The vectors (resolve.json § bounds) hold the rule; this holds the
 * amplification: the time and the size of what comes back, never the allocation it would have made.
 */
import { describe, expect, it } from "bun:test";
import { initialAnswers, type WizardContext } from "./answers";
import { resolveOffer, resolveSectionText } from "./resolve";
import { MAX_TEMPLATE_CHARS, parseTemplate } from "./syntax";
import answerVectors from "./vectors/answers.json";

const context = answerVectors.context as unknown as WizardContext;

/** A template whose one section, opening or annex intro is `references` x `[D]` on one line (three characters each). */
const COSTS = ["", "## COSTI", "@@step costs", "@@costs", "@@line a one_off | A | unit=100 | qty=1", "@@total **T**", "@@end"];
const FIELD = ["", "@@field D", "label: Dd"];
const amplifying = (references: number, where: "section" | "opening" | "annex" = "section") => {
  const line = "[D]".repeat(references);
  const head = ["@@salutation S", "@@acceptance C", ""];
  if (where === "opening") return [...head, line, "", "## UNO", "@@step scope", "x", ...COSTS, ...FIELD].join("\n");
  if (where === "annex") return [...head, "## UNO", "@@step scope", "x", ...COSTS, "", "@@annex A Annesso", line, "", "## PARTE", "y", ...FIELD].join("\n");
  return [...head, "## UNO", "@@step scope", line, ...COSTS, ...FIELD].join("\n");
};

const run = (source: string) => {
  const { ast, problems } = parseTemplate(source);
  expect(problems.filter((problem) => problem.severity === "error")).toEqual([]);
  const answers = initialAnswers(ast, context);
  answers.fields.D = "x".repeat(20_000);
  const started = performance.now();
  const offer = resolveOffer(ast, answers, context);
  return { offer, ms: performance.now() - started, ast, answers };
};

describe("resolveOffer — an amplifying template", () => {
  it("2 000 references to a 20 000-character answer: invalid at the section, a small result, quickly", () => {
    const { offer, ms } = run(amplifying(2_000));
    expect(offer.invalid.map((issue) => [issue.name, issue.code])).toEqual([["section:UNO#0", "section_too_long"]]);
    expect(JSON.stringify(offer).length).toBeLessThan(100_000);
    expect(ms).toBeLessThan(1_000);
  });

  it("the largest template (about 50 000 references, 150 000 characters): bounded time, bounded size, bounded memory", () => {
    const source = amplifying(49_000);
    expect(source.length).toBeLessThanOrEqual(MAX_TEMPLATE_CHARS);
    expect(source.length).toBeGreaterThan(MAX_TEMPLATE_CHARS - 5_000);
    Bun.gc(true);
    const before = process.memoryUsage().rss;
    const { offer, ms } = run(source);
    const grown = process.memoryUsage().rss - before;
    expect(offer.invalid.map((issue) => [issue.name, issue.code])).toEqual([["section:UNO#0", "section_too_long"]]);
    expect(offer.sections[0]!.body.length).toBeLessThanOrEqual(21_000);
    expect(JSON.stringify(offer).length).toBeLessThan(100_000);
    expect(ms).toBeLessThan(1_000);
    expect(grown).toBeLessThan(150 * 1024 * 1024);
  });

  it("the opening and an annex intro are bounded the same way", () => {
    const opening = run(amplifying(49_000, "opening"));
    expect(opening.offer.invalid.map((issue) => [issue.name, issue.code])).toEqual([["opening", "section_too_long"]]);
    expect(opening.offer.opening.length).toBeLessThanOrEqual(21_000);
    expect(opening.ms).toBeLessThan(1_000);
    const annex = run(amplifying(49_000, "annex"));
    expect(annex.offer.invalid.map((issue) => [issue.name, issue.code])).toEqual([["annex:A", "section_too_long"]]);
    expect(annex.offer.annexes[0]!.intro.length).toBeLessThanOrEqual(21_000);
    expect(annex.ms).toBeLessThan(1_000);
  });

  it("the hand-edit dialog's starting text is bounded too (resolveSectionText)", () => {
    const { ast, answers } = run(amplifying(49_000));
    const started = performance.now();
    const text = resolveSectionText(ast, answers, context, "UNO#0");
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(text!.body.length).toBeLessThanOrEqual(21_000);
  });

  it("a section whose first line alone passes the build bound still resolves for the hand-edit dialog, never null (QE D6)", () => {
    const { ast, answers } = run(amplifying(1));
    answers.fields.D = "*".repeat(10_600);
    expect(resolveSectionText(ast, answers, context, "UNO#0")).not.toBeNull();
    expect(resolveOffer(ast, answers, context).invalid.map((issue) => [issue.name, issue.code])).toEqual([["section:UNO#0", "section_too_long"]]);
  });

  it("a list or table line repeats the bound, it does not multiply it: 50 items of 2 000 characters over 400 lines", () => {
    const source = ["@@salutation S", "@@acceptance C", "", "## UNO", "@@step scope", ...Array.from({ length: 400 }, () => "- [ITEM] [ITEM]"), "", "## COSTI", "@@step costs", "@@costs", "@@line a one_off | A | unit=100 | qty=1", "@@total **T**", "@@end", "", "@@list ITEM", "label: Voce"].join("\n");
    const { ast, problems } = parseTemplate(source);
    expect(problems.filter((problem) => problem.severity === "error")).toEqual([]);
    const answers = initialAnswers(ast, context);
    answers.lists.ITEM = Array.from({ length: 50 }, () => "w".repeat(2_000));
    const started = performance.now();
    const offer = resolveOffer(ast, answers, context);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(offer.invalid.map((issue) => issue.code)).toEqual(["section_too_long"]);
    expect(offer.sections[0]!.body.length).toBeLessThanOrEqual(21_000);
  });
});
