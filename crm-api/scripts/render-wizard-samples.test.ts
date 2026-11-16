import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { renderWizardSamples, runRenderWizardSamples } from "./render-wizard-samples";

const made: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "wizard-samples-"));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NAMES = ["T1", "T2", "T3", "T4", "T5", "T6", "T1+T3"].map((code) => `${code}.pdf`);

describe("render-wizard-samples (specs/20261115-crm-offer-wizard T37; plan R2)", () => {
  it("writes one non-empty, readable PDF per seed to the directory it is given, and nothing else", async () => {
    const out = tempDir();
    const written = await renderWizardSamples(out);
    expect(written.map((entry) => entry.file)).toEqual(NAMES);
    expect(readdirSync(out).sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) {
      const bytes = readFileSync(join(out, name));
      expect(statSync(join(out, name)).size).toBeGreaterThan(5_000);
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      const pages = (await PDFDocument.load(bytes)).getPageCount();
      expect(pages).toBeGreaterThan(1);
    }
  });

  it("each PDF is the seed's own text: its title carries the sample reference and its name is the template's", async () => {
    const out = tempDir();
    const written = await renderWizardSamples(out);
    expect(written.map((entry) => entry.template)).toEqual([
      "Progetto a corpo",
      "Risorse a tempo",
      "Manutenzione e SLA",
      "Formazione",
      "Consulenza e assessment",
      "Servizi a canone",
      "Progetto a corpo con SLA",
    ]);
    for (const entry of written) expect((await PDFDocument.load(readFileSync(join(out, entry.file)))).getTitle()).toBe("Offerta 0001/2026");
  });

  it("is deterministic: the same seeds give the same bytes", async () => {
    const first = tempDir();
    const second = tempDir();
    await renderWizardSamples(first);
    await renderWizardSamples(second);
    for (const name of NAMES) expect(readFileSync(join(first, name)).equals(readFileSync(join(second, name)))).toBe(true);
  });

  it("the command needs --out, writes the seven files for it, and reports each", async () => {
    const lines: string[] = [];
    const errors: string[] = [];
    const io = { log: (line: string) => void lines.push(line), error: (line: string) => void errors.push(line) };

    expect(await runRenderWizardSamples([], io)).toBe(1);
    expect(errors.join("\n")).toContain("--out");

    const out = join(tempDir(), "nested", "samples");
    expect(existsSync(out)).toBe(false);
    expect(await runRenderWizardSamples(["--out", out], io)).toBe(0);
    expect(readdirSync(out).sort()).toEqual([...NAMES].sort());
    expect(lines.filter((line) => line.endsWith(".pdf") || line.includes(".pdf "))).toHaveLength(7);
  });
});
