/**
 * The paper constants are a spec value (AC-11.10: frame 120 / 110 / 71 / 71 pt on A4): the PDF and the preview's
 * pages both read them, so a change must be deliberate. These pin the values the letterhead was measured against.
 */

import { describe, expect, it } from "bun:test";
import { CELL_PAD, FRAME, HEADING_SIZE, LINE, PAGE, SIZE, SPACING, TABLE_SIZE, TITLE_SIZE } from "./paper";

describe("paper constants (DD-67)", () => {
  it("is A4 in points with the measured frame", () => {
    expect(PAGE).toEqual({ width: 595.28, height: 841.89 });
    expect(FRAME).toEqual({ top: 120, bottom: 110, left: 71, right: 71 });
  });

  it("keeps the PDF's type sizes and line height", () => {
    expect({ SIZE, LINE, HEADING_SIZE, TITLE_SIZE, TABLE_SIZE, CELL_PAD }).toEqual({
      SIZE: 10,
      LINE: 1.35,
      HEADING_SIZE: 10.5,
      TITLE_SIZE: 11.5,
      TABLE_SIZE: 9.5,
      CELL_PAD: 4,
    });
  });

  it("leaves a body that holds a whole number of lines of room (frame fits the page)", () => {
    expect(PAGE.height - FRAME.top - FRAME.bottom).toBeCloseTo(611.89, 2);
    expect(PAGE.width - FRAME.left - FRAME.right).toBeCloseTo(453.28, 2);
  });

  it("spells every spacing as finite non-negative points or a ratio", () => {
    for (const [name, value] of Object.entries(SPACING)) {
      expect(Number.isFinite(value), name).toBe(true);
      expect(value, name).toBeGreaterThanOrEqual(0);
    }
    expect(SPACING.sectionBefore).toBe(7);
    expect(SPACING.titleAfter).toBe(14);
  });
});
