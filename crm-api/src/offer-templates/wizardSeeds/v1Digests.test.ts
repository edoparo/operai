/**
 * The first set's texts, recorded as digests (specs/20261115-crm-offer-wizard T61; DD-59, DD-60, AC-12.5): T63's
 * one-time upgrade replaces a stored row only when its text hashes to one of these. The data is generated from the
 * git history of the seed files by `scripts/seed-digests.ts`; `toV1` is the inverse of the v1 → v2 conversion, so
 * `toV1(v2)` hashing into the record proves the conversion changed nothing but the issuer.
 */
import { firstV2Text } from "./revisions";
import { describe, expect, it } from "bun:test";
import { NO_HISTORY_NOTE, codesWithHistory, sha256, v1Revisions } from "../../../scripts/seed-digests";
import { WELLD_CH_IT_V1 } from "./welldChIt";
import { toV1 } from "./toV1";
import { V1_DIGESTS } from "./v1Digests";

const CODES = WELLD_CH_IT_V1.map((seed) => seed.code);

describe("toV1 is the inverse of the issuer conversion (DD-63)", () => {
  it("a v2 text turns into a text with the literals back and no trace of the issuer fields", () => {
    for (const seed of WELLD_CH_IT_V1) {
      const v1 = toV1(firstV2Text(seed));
      expect(v1, seed.code).toContain("WellD Sagl");
      expect(v1, seed.code).not.toContain("EMITTENTE");
    }
    expect(toV1(WELLD_CH_IT_V1.find((seed) => seed.code === "T3")!.source)).toContain("| **Fornitore** | WellD Sagl, Via Pessina 9, CP 1920, CH-6901 Lugano | — |");
  });

  it("refuses a text that does not have the shape v2 gave it (an edited seed is not silently converted)", () => {
    expect(() => toV1("@@field EMITTENTE\nsource: client\n\nx [EMITTENTE]")).toThrow();
    expect(() => toV1("a text with no issuer at all")).toThrow();
  });

  it("the digests of toV1(v2) are the last revision of each seed's recorded v1 digests", () => {
    for (const seed of WELLD_CH_IT_V1) {
      const recorded = V1_DIGESTS[seed.code];
      expect(recorded.length, seed.code).toBeGreaterThanOrEqual(1);
      expect(sha256(toV1(firstV2Text(seed))), seed.code).toBe(recorded[recorded.length - 1]!.sha256);
    }
  });
});

describe("the recorded digests (AC-12.5)", () => {
  it("every code has at least one, each a SHA-256 in hex with the commit that introduced it, none repeated", () => {
    expect(Object.keys(V1_DIGESTS).sort()).toEqual([...CODES].sort());
    for (const code of CODES) {
      for (const entry of V1_DIGESTS[code]) {
        expect(entry.sha256, code).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.commit, code).toMatch(/^[0-9a-f]{8}$/);
      }
      expect(new Set(V1_DIGESTS[code].map((entry) => entry.sha256)).size, code).toBe(V1_DIGESTS[code].length);
    }
  });

  it("T2 and T4 were revised after their first conversion, so they record more than one", () => {
    expect(V1_DIGESTS.T2.length).toBeGreaterThan(1);
    expect(V1_DIGESTS.T4.length).toBeGreaterThan(1);
  });

  it("no v2 text is among the v1 digests", () => {
    for (const seed of WELLD_CH_IT_V1) {
      expect(V1_DIGESTS[seed.code].map((entry) => entry.sha256), seed.code).not.toContain(sha256(seed.source));
    }
  });

  // Since the squash of 33ebd929 the history holds only v2 texts, so v1Digests.ts is authoritative; the check stays for
  // any branch whose history still has v1 revisions: those must agree with the record.
  const found = v1Revisions();
  const withHistory = codesWithHistory(found);

  it.skipIf(withHistory.length === 0)(
    `regenerating them from the git history gives exactly what is recorded${withHistory.length === 0 ? ` (skipped: ${NO_HISTORY_NOTE})` : ""}`,
    () => {
      for (const code of withHistory) expect(found[code], code).toEqual([...V1_DIGESTS[code]]);
    },
  );
});
