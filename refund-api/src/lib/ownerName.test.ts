import { describe, expect, it } from "bun:test";
import { normaliseOwnerName, OWNER_NAME_MAX } from "./ownerName";

describe("normaliseOwnerName (OWASP review 2026-11-20, low 3)", () => {
  it("keeps an ordinary name as written", () => {
    expect(normaliseOwnerName("Ada Lovelace")).toBe("Ada Lovelace");
    expect(normaliseOwnerName("Zoë D’Amico")).toBe("Zoë D’Amico");
  });

  it("removes bidi overrides and zero-width characters", () => {
    expect(normaliseOwnerName("Ada\u202E ecalevoL")).toBe("Ada ecalevoL");
    expect(normaliseOwnerName("A\u200Bda\u200D\uFEFF")).toBe("Ada");
  });

  it("turns control characters and line breaks into one space and trims", () => {
    expect(normaliseOwnerName("  Ada\n\tLovelace\u2028 ")).toBe("Ada Lovelace");
  });

  it("caps the name at OWNER_NAME_MAX code points", () => {
    expect(Array.from(normaliseOwnerName("😀".repeat(500))!).length).toBe(OWNER_NAME_MAX);
  });

  it("nothing left is no name", () => {
    expect(normaliseOwnerName("  \u202E\u200B ")).toBeNull();
    expect(normaliseOwnerName("")).toBeNull();
    expect(normaliseOwnerName(undefined)).toBeNull();
    expect(normaliseOwnerName(null)).toBeNull();
  });
});
