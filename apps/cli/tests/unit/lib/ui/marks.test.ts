import { describe, expect, it } from "vitest";

import { GUIDE, MARK } from "../../../../src/lib/ui/marks";

const plain = (text: string): string => text.replace(/\u001B\[[0-9;]*m/g, "");

describe("marks", () => {
  it("gives each kind of line its own glyph", () => {
    const glyphs = [GUIDE, MARK.done, MARK.skipped, MARK.warning, MARK.failed].map(plain);

    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("draws each glyph in one column, so the gutter stays straight", () => {
    for (const mark of Object.values(MARK)) {
      expect(plain(mark)).toHaveLength(1);
    }
  });
});
