import { describe, expect, it } from "vitest";

import { reflow, renderBox, WIDTH } from "../../../../src/lib/ui/layout";
import { section } from "../../../../src/lib/ui/summary";
import { sectionLines, trimBlank } from "../../../../src/lib/ui/layout";

const plain = (text: string): string => text.replace(/\u001B\[[0-9;]*m/g, "");
const widest = (text: string): number =>
  Math.max(
    ...plain(text)
      .split("\n")
      .map((line) => line.length),
  );

describe("reflow", () => {
  it("leaves a line that already fits", () => {
    expect(reflow("short enough", 40)).toBe("short enough");
  });

  it("wraps prose to the width it is given", () => {
    expect(reflow("one two three four five six", 10)).toBe("one two\nthree four\nfive six");
  });

  it("keeps a wrapped line under the indent of its first line", () => {
    expect(reflow("    alpha beta gamma", 12)).toBe("    alpha\n    beta\n    gamma");
  });

  it("indents the continuation of a list item past its marker", () => {
    const [first, ...rest] = reflow("[ok] alpha beta gamma delta", 16).split("\n");

    expect(first).toMatch(/^\[ok] /);
    expect(rest.every((line) => line.startsWith("  ") && line.trim() !== "")).toBe(true);
  });

  it("leaves a line laid out in columns whole, however long", () => {
    const row = "users             list, get, create, update, delete      created_at, id, schema";
    expect(reflow(row, 20)).toBe(row);
  });
});

describe("renderBox", () => {
  it("is the same width whatever it holds", () => {
    const narrow = renderBox("Next steps", [], [{ text: "Short." }]);
    const wide = renderBox("Next steps", [], [{ text: "A sentence that is a good deal longer." }]);

    expect(widest(narrow)).toBe(widest(wide));
  });

  it("never draws wider than the width everything else obeys", () => {
    const box = renderBox(
      "Next steps",
      [],
      [
        {
          text: `Deploy it, ${"and then some more words ".repeat(10)}:`,
          command: "zitadel deploy",
        },
      ],
    );

    expect(widest(box)).toBeLessThanOrEqual(WIDTH);
  });

  it("keeps a command longer than the box whole, so it can still be copied", () => {
    const command = `zitadel deploy ${"-".repeat(200)}`;

    expect(plain(renderBox("Next steps", [], [{ text: "Run next:", command }]))).toContain(command);
  });

  it("puts each command on its own line under the sentence that asks for it", () => {
    const box = plain(renderBox("Next steps", [], [{ text: "Run next:", command: "a\nb" }]));

    expect(box).toContain("Run next:");
    expect(box.indexOf("a")).toBeLessThan(box.indexOf("b"));
  });
});

describe("sectionLines", () => {
  it("aligns the values of a section's facts", () => {
    const [heading, first, second] = sectionLines(
      section("Project", ["Id", "proj-1"], ["Server", "api.zitadel.cloud"]),
    ).map(plain);

    expect(heading).toBe("Project");
    expect(first?.indexOf("proj-1")).toBe(second?.indexOf("api.zitadel.cloud"));
  });
});

describe("trimBlank", () => {
  it("drops the blank lines at either end and keeps the ones between", () => {
    expect(trimBlank(["", "a", "", "b", ""])).toEqual(["a", "", "b"]);
  });
});

describe("renderBox with a report", () => {
  it("keeps the report and the steps in one frame", () => {
    const box = plain(
      renderBox(
        "Zitadel is ready",
        ["PROJECT", "✓ Id   proj-1"],
        [{ text: "Start it:", command: "npm run dev" }],
      ),
    );

    expect(box).toContain("PROJECT");
    expect(box).toContain("npm run dev");
    expect(box.indexOf("PROJECT")).toBeLessThan(box.indexOf("npm run dev"));
  });
});
