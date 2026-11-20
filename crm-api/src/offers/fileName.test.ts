import { describe, expect, it } from "bun:test";
import { clientCode, dealCode, offerFileName, referenceCode } from "./fileName";

// The Drive naming convention for offer PDFs (owner request 2026-11-20).
describe("offer file name", () => {
  it("follows the Drive convention: WellD_<entity>_<client>_<deal initials>_<reference>.pdf", () => {
    expect(offerFileName({ entity: "welld_ch", companyName: "Studio V", dealTitle: "Fleet Management System", reference: "0009/2026" })).toBe(
      "WellD_CH_STUDIOV_FMS_00092026.pdf",
    );
  });

  it("a revision keeps its rN after the reference", () => {
    expect(offerFileName({ entity: "welld_it", companyName: "Studio V", dealTitle: "Fleet Management System", reference: "0027/2026r2" })).toBe(
      "WellD_IT_STUDIOV_FMS_00272026r2.pdf",
    );
  });

  it("the client is the company name without accents, spaces or symbols, in upper case", () => {
    expect(clientCode("Società Elettrica S.p.A.")).toBe("SOCIETAELETTRICASPA");
    expect(clientCode("x".repeat(50))).toHaveLength(30);
  });

  it("the deal code is the initials of every word of the title", () => {
    expect(dealCode("Fleet-Management system")).toBe("FMS");
    expect(dealCode("Évolution du portail, fase 2")).toBe("EDPF2");
    expect(dealCode("   ")).toBe("");
  });

  it("an empty part is left out, never an empty segment", () => {
    expect(offerFileName({ entity: "welld_ch", companyName: "ACME", dealTitle: "—", reference: "0001/2026" })).toBe("WellD_CH_ACME_00012026.pdf");
  });

  it("an older OF-… reference keeps its hyphens", () => {
    expect(referenceCode("OF-2026-ABC123-1")).toBe("OF-2026-ABC123-1");
  });
});
