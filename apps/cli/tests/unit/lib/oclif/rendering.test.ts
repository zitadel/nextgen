import { describe, expect, it } from "vitest";

import { json, painted, prose, rows } from "@/lib/oclif/rendering";

describe("prose", () => {
  it("spells an escape out the way a person reads one, and keeps the layout", () => {
    expect(prose("Deployed \u001b[2Jwiped\nto one origin")).toEqual({
      kind: "prose",
      text: "Deployed \\x1b[2Jwiped\nto one origin",
    });
  });
});

describe("json", () => {
  it("spells a control character out the way JSON does, so a reader parses the value back", () => {
    const rendering = json({ note: "a\u009bb" });

    expect(rendering.kind).toBe("piped");
    expect(rendering.text).not.toContain("\u009b");
    expect(JSON.parse(rendering.text)).toEqual({ note: "a\u009bb" });
  });

  it("leaves a character above the BMP as the pair JSON spells it with", () => {
    const rendering = json({ tag: "a\u{E0001}b" });

    expect(JSON.parse(rendering.text)).toEqual({ tag: "a\u{E0001}b" });
  });
});

describe("rows", () => {
  it("keeps the tabs and line breaks that separate the records", () => {
    expect(rows("a\tb\nc\td")).toEqual({ kind: "piped", text: "a\tb\nc\td" });
  });
});

describe("painted", () => {
  it("keeps the colour the CLI applied", () => {
    expect(painted("\u001b[32mok\u001b[39m")).toEqual({
      kind: "painted",
      text: "\u001b[32mok\u001b[39m",
    });
  });
});
