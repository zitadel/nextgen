import { describe, expect, it } from "vitest";

import { colorsLines } from "../../../src/commands/logs";

describe("whether logs prints in color", () => {
  it("does on a terminal", () => {
    expect(colorsLines(true, {}, true)).toBe(true);
  });

  it("does not in a pipe", () => {
    expect(colorsLines(true, {}, false)).toBe(false);
  });

  it("does in a pipe when FORCE_COLOR asks for it", () => {
    expect(colorsLines(true, { FORCE_COLOR: "1" }, false)).toBe(true);
  });

  it("does not with --no-color", () => {
    expect(colorsLines(false, {}, true)).toBe(false);
  });

  it("does not with NO_COLOR, even where FORCE_COLOR asks for it", () => {
    expect(colorsLines(true, { NO_COLOR: "1", FORCE_COLOR: "1" }, true)).toBe(false);
  });

  it("does not on a terminal that cannot show it", () => {
    expect(colorsLines(true, { TERM: "dumb" }, true)).toBe(false);
  });
});
