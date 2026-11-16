/**
 * Renders the seven seeded wizard templates to PDFs, for the owner's review before release
 * (specs/20261115-crm-offer-wizard T37, AC-9.1, plan R2).
 *
 *   bun scripts/render-wizard-samples.ts --out <dir> [--legal-name <name>] [--address-line <line> …]
 *
 * The issuer the samples print (`[EMITTENTE]`, the SLA parties row, the page footer) is `--legal-name` and the
 * repeatable `--address-line` (up to five), defaulting to the engine's sample issuer (DD-64): before a release the
 * owner re-renders the seven with each entity's real profile values and reads what production will print.
 *
 * Writes `T1.pdf` … `T6.pdf` and `T1+T3.pdf` into `<dir>` (created if missing). Each PDF is what the offer
 * wizard would generate for the template with its sample answers (`sampleAnswers`, AC-8.5) and the sample
 * context (`sampleContext`: a made-up deal in CHF, one contact), with every optional block switched ON so the
 * whole text is on the page, on the plain letterhead, with the reference `0001/2026`. It goes through the same
 * `resolveOffer` → `wizardSnapshotOf` → `renderContractPdf` as a real generation.
 *
 * Needs no database, no bucket and no service: nothing is read or written but the directory you name. (The
 * route module it borrows `wizardSnapshotOf` from validates the environment when it loads; the variables are
 * filled with inert placeholders for this process when they are not set, and nothing connects to them.)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { WELLD_CH_IT_V1 } from "../src/offer-templates/wizardSeeds/welldChIt";
import { renderContractPdf } from "../src/offers/contractPdf";
import { sampleAnswers, sampleContext, setBlock } from "../src/offers/engine/answers";
import { resolveOffer } from "../src/offers/engine/resolve";
import { parseTemplate } from "../src/offers/engine/syntax";

export interface Io {
  log(line: string): void;
  error(line: string): void;
}

export interface WrittenSample {
  readonly code: string;
  /** The file name inside the directory. */
  readonly file: string;
  readonly template: string;
  readonly bytes: number;
}

const REFERENCE = "0001/2026";
const SAMPLE_VAT = "CHE-000.000.000 IVA";
const SAMPLE_IBAN = "CH00 0000 0000 0000 0000 0";
/** An entity profile holds at most five address lines (specs/20261115-crm-offer-wizard AC-12.1). */
const MAX_ADDRESS_LINES = 5;

/** What the samples say of the issuer; each part defaults to the engine's sample value (DD-64). */
export interface SampleIssuer {
  readonly legalName?: string | undefined;
  readonly addressLines?: readonly string[] | undefined;
}

/** The variables the borrowed module checks when it loads; real values win, nothing here is ever contacted. */
const INERT_ENV: Readonly<Record<string, string>> = {
  DATABASE_URL: "postgresql://localhost:1/sample",
  ALLOWED_ORIGINS: "http://localhost:1",
  AUTH_JWKS_URL: "http://localhost:1/jwks",
  AUTH_ISSUER: "http://localhost:1",
  AUTH_AUDIENCE: "sample",
  AUTH_BASE_URL: "http://localhost:1",
};

async function wizardSnapshotOf() {
  for (const [name, value] of Object.entries(INERT_ENV)) process.env[name] ??= value;
  return (await import("../src/offers/generation")).wizardSnapshotOf;
}

export async function renderWizardSamples(outDir: string, issuer: SampleIssuer = {}): Promise<WrittenSample[]> {
  const snapshotOf = await wizardSnapshotOf();
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const base = sampleContext("it");
  // the issuer is what the seeds print through `[EMITTENTE]` and the parties row, and what the page's footer says (DD-59, DD-64)
  const context = {
    ...base,
    issuerLegalName: issuer.legalName ?? base.issuerLegalName,
    issuerAddressLines: issuer.addressLines ?? base.issuerAddressLines,
  };
  const profile = { legalName: context.issuerLegalName, addressLines: [...context.issuerAddressLines], vatNumber: SAMPLE_VAT, iban: SAMPLE_IBAN };
  const written: WrittenSample[] = [];

  for (const seed of WELLD_CH_IT_V1) {
    const { ast, problems } = parseTemplate(seed.source);
    const errors = problems.filter((problem) => problem.severity === "error");
    if (errors.length > 0) throw new Error(`${seed.code}: the seed does not parse: ${errors.map((problem) => problem.code).join(", ")}`);

    // every optional block on (a choice keeps its default option): the whole text of the template is on the page
    let answers = sampleAnswers(ast, "it");
    const options = new Set(ast.choices.flatMap((choice) => choice.options));
    for (const block of ast.blocks) if (!options.has(block.name)) answers = setBlock(ast, answers, block.name, true);

    const resolved = resolveOffer(ast, answers, context, { reference: REFERENCE });
    if (resolved.missing.length > 0 || resolved.invalid.length > 0) {
      throw new Error(`${seed.code}: the sample answers are not complete: ${[...resolved.missing, ...resolved.invalid].map((issue) => issue.name).join(", ")}`);
    }
    const snapshot = snapshotOf({
      template: { id: `sample-${seed.code}`, name: seed.name },
      templateVersion: 1,
      answers,
      resolved,
      reference: REFERENCE,
      currency: context.currency,
      profile,
      annex: null,
      attachments: [],
      preparedBy: null,
    });
    const bytes = await renderContractPdf(snapshot, { letterhead: null, attachments: [] });
    const file = `${seed.code}.pdf`;
    writeFileSync(join(dir, file), bytes);
    written.push({ code: seed.code, file, template: seed.name, bytes: bytes.byteLength });
  }
  return written;
}

/** Returns the process exit code. */
export async function runRenderWizardSamples(argv: readonly string[], io: Io): Promise<number> {
  let values: { out?: string; "legal-name"?: string; "address-line"?: string[] };
  try {
    values = parseArgs({
      args: [...argv],
      options: { out: { type: "string" }, "legal-name": { type: "string" }, "address-line": { type: "string", multiple: true } },
      allowPositionals: false,
    }).values;
  } catch (error) {
    io.error(`render-wizard-samples: ${(error as Error).message}`);
    return 1;
  }
  const out = values.out;
  if (!out) {
    io.error("render-wizard-samples: --out <dir> is required (the directory the seven PDFs are written to)");
    return 1;
  }
  // what an entity profile could hold: a legal name that is not blank, up to five address lines that are not blank (DD-61, AC-12.1)
  const legalName = values["legal-name"];
  if (legalName !== undefined && legalName.trim() === "") {
    io.error("render-wizard-samples: --legal-name must not be blank");
    return 1;
  }
  const addressLines = values["address-line"];
  if (addressLines !== undefined && (addressLines.length > MAX_ADDRESS_LINES || addressLines.some((line) => line.trim() === ""))) {
    io.error(`render-wizard-samples: --address-line is given 1 to ${MAX_ADDRESS_LINES} times, never blank`);
    return 1;
  }
  const written = await renderWizardSamples(out, { legalName, addressLines });
  for (const entry of written) io.log(`${join(resolve(out), entry.file)}  ${entry.template}  ${entry.bytes} bytes`);
  return 0;
}

if (import.meta.main) {
  process.exit(await runRenderWizardSamples(process.argv.slice(2), { log: (line) => console.log(line), error: (line) => console.error(line) }));
}
