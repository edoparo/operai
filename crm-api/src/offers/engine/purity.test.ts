/**
 * AC-9.3 and the determinism of the two copies (specs/20261115-crm-offer-wizard DD-50): the engine has no
 * entity, currency, clock, locale or I/O dependency. Checked on the code with comments removed — the files'
 * own comments say "no `Intl`", which must not trip the check. The tests are not engine code and are skipped.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";
import { sampleAnswers, sampleContext } from "./answers";
import { parseTemplate } from "./syntax";

const DIR = import.meta.dir;
const files = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort();

/** The file as JavaScript with comments removed and imports kept (verbatim), so the textual checks never read a comment. */
function code(source: string): string {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true, verbatimModuleSyntax: true },
  }).outputText;
}

/** Every module specifier of the file, type-only imports and `export … from` included. */
function specifiers(source: string): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) out.push(node.argument.literal.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const arg = node.arguments[0];
      out.push(arg && ts.isStringLiteral(arg) ? arg.text : "<dynamic>");
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile("x.ts", source, ts.ScriptTarget.ESNext, true));
  return out;
}

/** A `"CHF"`/`"EUR"` VALUE literal (not a type) with the name of the function that holds it. */
function currencyLiterals(source: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && (node.text === "CHF" || node.text === "EUR") && !ts.isLiteralTypeNode(node.parent)) {
      let holder: ts.Node | undefined = node.parent;
      while (holder && !ts.isFunctionDeclaration(holder)) holder = holder.parent;
      found.push(holder && ts.isFunctionDeclaration(holder) && holder.name ? holder.name.text : "<top level>");
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile("x.ts", source, ts.ScriptTarget.ESNext, true));
  return found;
}

const FORBIDDEN: readonly [string, RegExp][] = [
  ["a `welld_` literal", /welld_/],
  ["the name of a real wellD company (DD-57: sample data names no real company)", /welld/i],
  ["`Intl`", /\bIntl\b/],
  ["`toLocale*`", /\btoLocale\w*/],
  ["`Date.now`", /\bDate\s*\.\s*now\b/],
  ["`new Date(`", /\bnew\s+Date\s*\(/],
  ["`localStorage`", /\blocalStorage\b/],
  ["`eval(`", /\beval\s*\(/],
  ["`new Function`", /\bnew\s+Function\b/],
];

/** The only places a currency literal may be a value: the per-currency separators and the fixed sample deal (DD-50). */
const CURRENCY_ALLOWED: Record<string, string> = { "format.ts": "formatAmount", "answers.ts": "sampleContext" };

describe("the engine's purity (AC-9.3, DD-50)", () => {
  it("covers the twelve engine files", () => {
    expect(files).toEqual(["answers.ts", "compute.ts", "costs.ts", "edit.ts", "format.ts", "markup.ts", "numbering.ts", "outline.ts", "printable.ts", "resolve.ts", "syntax.ts", "words.ts"]);
  });

  for (const file of files) {
    const source = readFileSync(join(DIR, file), "utf8");

    it(`${file}: no entity, clock, locale, storage or dynamic-code use`, () => {
      const js = code(source);
      for (const [label, pattern] of FORBIDDEN) expect(pattern.test(js), `${file} contains ${label}`).toBe(false);
    });

    it(`${file}: imports only from the engine directory`, () => {
      for (const spec of specifiers(source)) {
        const resolved = spec.startsWith("./") ? normalize(join(DIR, spec)) : "";
        expect(resolved !== "" && dirname(resolved) === DIR, `${file} imports "${spec}"`).toBe(true);
      }
    });

    it(`${file}: a CHF/EUR value literal only where DD-50 allows it`, () => {
      const holders = currencyLiterals(source);
      const allowed = CURRENCY_ALLOWED[file];
      for (const holder of holders) expect(holder, `${file} holds a currency literal in ${holder}`).toBe(allowed ?? "<none allowed>");
    });
  }

  it("the allow-list is exactly the two named places, and both still hold their literal", () => {
    expect(Object.keys(CURRENCY_ALLOWED).sort()).toEqual(["answers.ts", "format.ts"]);
    for (const [file, holder] of Object.entries(CURRENCY_ALLOWED)) {
      expect(currencyLiterals(readFileSync(join(DIR, file), "utf8"))).toContain(holder);
    }
  });

  it("the sample data of the Try view names no real wellD company, in either language (AC-12.8, AC-12.13)", () => {
    const ast = parseTemplate(["@@salutation S", "", "Apertura [E] [A]", "", "@@field E", "source: issuer", "", "@@field A", "source: issuerAddress"].join("\n")).ast;
    for (const language of ["it", "en"] as const) {
      const sample = JSON.stringify([sampleContext(language), sampleAnswers(ast, language)]);
      expect(/welld/i.test(sample), `the ${language} sample data names wellD`).toBe(false);
      expect(sampleContext(language).issuerLegalName).not.toBe("");
      expect(sampleContext(language).issuerAddressLines.length).toBeGreaterThan(0);
    }
  });

  it("the checks can fail (they are not vacuous)", () => {
    expect(FORBIDDEN.every(([, pattern]) => pattern.test(code("const x = 'welld_it' + Intl.x + n.toLocaleString() + Date.now() + new Date(1) + localStorage + eval('1') + new Function('1');")))).toBe(true);
    expect(FORBIDDEN.some(([, pattern]) => pattern.test(code("// no Intl, no welld_\n/* Date.now() */ const y = Date.UTC(2026, 0, 1);")))).toBe(false);
    expect(specifiers('import type { A } from "../lib/x"; export { B } from "node:fs"; const c = await import("./y");')).toEqual(["../lib/x", "node:fs", "./y"]);
    expect(currencyLiterals('function f(c: "CHF" | "EUR") { return c === "EUR"; } const t = "CHF";')).toEqual(["f", "<top level>"]);
  });
});
