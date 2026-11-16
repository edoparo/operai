/**
 * The seven seeds name their issuer through the entity profile (specs/20261115-crm-offer-wizard T61; US-12, AC-12.3,
 * AC-12.10, DD-59): no text writes "WellD Sagl" or the Via Pessina address, each declares `[EMITTENTE]` from the
 * profile's legal name, and the two SLA texts also print the profile's address. The fidelity test (fidelity.test.ts)
 * proves the bindings stand exactly where the literals stood; this one states the texts' shape.
 */
import { describe, expect, it } from "bun:test";
import { parseTemplate } from "../../offers/engine/syntax";
import { WELLD_CH_IT_V1, type WizardSeedCode } from "./welldChIt";

/** `[EMITTENTE]` per seed: the two places the mockup wrote the name, five in the SLA texts. */
const NAME_PLACES: Readonly<Record<WizardSeedCode, number>> = { T1: 2, T2: 2, T3: 5, T4: 2, T5: 2, T6: 2, "T1+T3": 5 };
const WITH_ADDRESS: readonly WizardSeedCode[] = ["T3", "T1+T3"];

const count = (text: string, part: string): number => text.split(part).length - 1;

describe("seeds v2: the issuer comes from the profile (AC-12.3, AC-12.10, DD-59)", () => {
  it("there are seven, none writes the old legal name or the old address", () => {
    expect(WELLD_CH_IT_V1).toHaveLength(7);
    for (const seed of WELLD_CH_IT_V1) {
      expect(seed.source, seed.code).not.toContain("WellD Sagl");
      expect(seed.source, seed.code).not.toContain("Via Pessina");
      expect(seed.source, seed.code).not.toContain("CP 1920");
    }
  });

  for (const seed of WELLD_CH_IT_V1) {
    it(`${seed.code}: declares EMITTENTE from the issuer and prints it ${NAME_PLACES[seed.code]} times`, () => {
      const { ast, problems } = parseTemplate(seed.source);
      expect(problems.filter((problem) => problem.severity === "error")).toEqual([]);
      const emittente = ast.fields.filter((field) => field.name === "EMITTENTE");
      expect(emittente).toHaveLength(1);
      expect(emittente[0]!.source).toBe("issuer");
      expect(count(seed.source, "[EMITTENTE]")).toBe(NAME_PLACES[seed.code]);
      // the parties sentence: the issuer is defined as «Fornitore»
      expect(seed.source).toContain("Il presente contratto viene stipulato tra [EMITTENTE], di seguito denominata «Fornitore»");
    });
  }

  for (const code of WITH_ADDRESS) {
    it(`${code}: the SLA parties row prints the name, then the address only when there is one (AC-12.10, AC-12.12)`, () => {
      const seed = WELLD_CH_IT_V1.find((entry) => entry.code === code)!;
      const { ast } = parseTemplate(seed.source);
      const address = ast.fields.filter((field) => field.name === "INDIRIZZO_EMITTENTE");
      expect(address).toHaveLength(1);
      expect(address[0]!.source).toBe("issuerAddress");
      expect(seed.source).toContain("| **Fornitore** | [EMITTENTE]{{?INDIRIZZO_EMITTENTE::, [INDIRIZZO_EMITTENTE]}} | — |");
      expect(count(seed.source, "[INDIRIZZO_EMITTENTE]")).toBe(1);
    });

    it(`${code}: «WellD», the defined short term, stays (AC-12.3)`, () => {
      const seed = WELLD_CH_IT_V1.find((entry) => entry.code === code)!;
      expect(seed.source).toContain("con cui [EMITTENTE] («WellD») eroga");
      expect(count(seed.source, "«WellD»")).toBe(1);
    });
  }

  it("the other five do not read the address at all", () => {
    for (const seed of WELLD_CH_IT_V1.filter((entry) => !WITH_ADDRESS.includes(entry.code))) {
      expect(seed.source, seed.code).not.toContain("INDIRIZZO_EMITTENTE");
    }
  });

  it("the jurisdiction clauses and the place of issue keep their own Lugano: they are not the issuer's address (AC-12.10)", () => {
    for (const seed of WELLD_CH_IT_V1) expect(seed.source, seed.code).toContain("il foro competente è quello di Lugano (Svizzera)");
  });
});

describe("the catalog's keys (DD-59)", () => {
  it("each seed has its v2 key, the v1 key it replaces and the kept key a v1 row an author had edited gets", () => {
    for (const seed of WELLD_CH_IT_V1) {
      expect(seed.seedKey).toBe(`welld-ch-it-v2:${seed.code}`);
      expect(seed.previousKey).toBe(`welld-ch-it-v1:${seed.code}`);
      expect(seed.keptKey).toBe(`welld-ch-it-v1-kept:${seed.code}`);
    }
    expect(new Set(WELLD_CH_IT_V1.flatMap((seed) => [seed.seedKey, seed.previousKey, seed.keptKey])).size).toBe(21);
  });
});
