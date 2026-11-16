/**
 * The issuer the sample PDFs print (specs/20261115-crm-offer-wizard T61; DD-64, AC-12.3): `--legal-name` and the
 * repeatable `--address-line` set what the seven samples say of the issuer, defaulting to the engine's sample
 * values; the owner re-renders them with each entity's real profile before release.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { renderWizardSamples, runRenderWizardSamples } from "./render-wizard-samples";

const made: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "wizard-samples-issuer-"));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NAMES = ["T1", "T2", "T3", "T4", "T5", "T6", "T1+T3"].map((code) => `${code}.pdf`);
const WIN_ANSI: Record<number, string> = { 0x92: "’", 0x95: "•", 0x96: "–", 0x91: "‘", 0x93: "“", 0x94: "”" };

/** Every `<hex> Tj` string the PDF draws, decoded from WinAnsi, in drawing order. */
async function printedText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
    const content = streams.map((stream) => (stream instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1") : "")).join("\n");
    for (const match of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      out.push((match[1]!.match(/../g) ?? []).map((hex) => WIN_ANSI[parseInt(hex, 16)] ?? String.fromCharCode(parseInt(hex, 16))).join(""));
    }
  }
  return out.join(" ");
}

describe("the issuer the samples print (DD-64)", () => {
  it("defaults to the engine's sample issuer, never the mockup's legal name", async () => {
    const out = tempDir();
    await renderWizardSamples(out);
    const text = await printedText(readFileSync(join(out, "T3.pdf")));
    expect(text).toContain("Fornitore di esempio SA");
    expect(text).toContain("Via Esempio 2");
    expect(text).not.toContain("WellD Sagl");
    expect(text).not.toContain("Pessina");
  });

  it("prints the legal name and address lines it is given, in every sample and in the SLA parties row", async () => {
    const out = tempDir();
    await renderWizardSamples(out, { legalName: "wellD SA", addressLines: ["Via Example 1", "6900 Lugano"] });
    for (const name of NAMES) {
      const text = await printedText(readFileSync(join(out, name)));
      expect(text, name).toContain("wellD SA");
      expect(text, name).not.toContain("Fornitore di esempio");
      expect(text, name).not.toContain("WellD Sagl");
    }
    expect(await printedText(readFileSync(join(out, "T3.pdf")))).toContain("Via Example 1");
    expect(await printedText(readFileSync(join(out, "T1+T3.pdf")))).toContain("Via Example 1");
  });

  it("the command reads --legal-name and the repeatable --address-line", async () => {
    const errors: string[] = [];
    const io = { log: () => {}, error: (line: string) => void errors.push(line) };
    const out = tempDir();
    expect(await runRenderWizardSamples(["--out", out, "--legal-name", "wellD SA", "--address-line", "Via Example 1", "--address-line", "6900 Lugano"], io)).toBe(0);
    const text = await printedText(readFileSync(join(out, "T1+T3.pdf")));
    expect(text).toContain("wellD SA");
    expect(text).toContain("Via Example 1");
    expect(errors).toEqual([]);
  });

  it("refuses what a profile could not hold: a blank legal name, more than five address lines", async () => {
    const errors: string[] = [];
    const io = { log: () => {}, error: (line: string) => void errors.push(line) };
    const out = tempDir();
    expect(await runRenderWizardSamples(["--out", out, "--legal-name", "  "], io)).toBe(1);
    expect(errors.pop()).toContain("--legal-name");
    const six = ["a", "b", "c", "d", "e", "f"].flatMap((line) => ["--address-line", line]);
    expect(await runRenderWizardSamples(["--out", out, ...six], io)).toBe(1);
    expect(errors.pop()).toContain("--address-line");
    expect(readdirSync(out)).toEqual([]);
  });
});
