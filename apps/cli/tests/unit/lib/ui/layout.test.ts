import { stripAnsi } from "consola/utils";
import { describe, expect, it } from "vitest";

import { Facts, Frame, Prose, trimBlank, WIDTH } from "../../../../src/lib/ui/layout";
import { section } from "../../../../src/lib/ui/summary";

const plain = (text: string): string => stripAnsi(text);
const widest = (text: string): number =>
  Math.max(
    ...plain(text)
      .split("\n")
      .map((line) => line.length),
  );

describe("Prose", () => {
  it("leaves a line that already fits", () => {
    expect(new Prose("short enough", 40).render()).toBe("short enough");
  });

  it("wraps prose to the width it is given", () => {
    expect(new Prose("one two three four five six", 10).render()).toBe(
      "one two\nthree four\nfive six",
    );
  });

  it("keeps a wrapped line under the indent of its first line", () => {
    expect(new Prose("    alpha beta gamma", 12).render()).toBe("    alpha\n    beta\n    gamma");
  });

  it("indents the continuation of a list item past its marker", () => {
    const [first, ...rest] = new Prose("[ok] alpha beta gamma delta", 16).render().split("\n");

    expect(first).toMatch(/^\[ok] /);
    expect(rest.every((line) => line.startsWith("  ") && line.trim() !== "")).toBe(true);
  });

  it("leaves a line laid out in columns whole, however long", () => {
    const row = "users             list, get, create, update, delete      created_at, id, schema";
    expect(new Prose(row, 20).render()).toBe(row);
  });
});

describe("Frame", () => {
  it("is the same width whatever it holds", () => {
    const narrow = new Frame("Next steps", [], [{ text: "Short." }]).render();
    const wide = new Frame(
      "Next steps",
      [],
      [{ text: "A sentence that is a good deal longer." }],
    ).render();

    expect(widest(narrow)).toBe(widest(wide));
  });

  it("never draws wider than the width everything else obeys", () => {
    const box = new Frame(
      "Next steps",
      [],
      [
        {
          text: `Deploy it, ${"and then some more words ".repeat(10)}:`,
          command: "zitadel deploy",
        },
      ],
    ).render();

    expect(widest(box)).toBeLessThanOrEqual(WIDTH);
  });

  it("keeps a command longer than the box whole, so it can still be copied", () => {
    const command = `zitadel deploy ${"-".repeat(200)}`;

    expect(plain(new Frame("Next steps", [], [{ text: "Run next:", command }]).render())).toContain(
      command,
    );
  });

  it("puts each command on its own line under the sentence that asks for it", () => {
    const box = plain(
      new Frame("Next steps", [], [{ text: "Run next:", command: "a\nb" }]).render(),
    );

    expect(box).toContain("Run next:");
    expect(box.indexOf("a")).toBeLessThan(box.indexOf("b"));
  });
});

describe("Facts", () => {
  it("aligns the values of a section's facts", () => {
    const [heading, first, second] = plain(
      new Facts([section("Project", ["Id", "proj-1"], ["Server", "api.zitadel.cloud"])]).render(),
    ).split("\n");

    expect(heading).toBe("Project");
    expect(first?.indexOf("proj-1")).toBe(second?.indexOf("api.zitadel.cloud"));
  });
});

describe("trimBlank", () => {
  it("drops the blank lines at either end and keeps the ones between", () => {
    expect(trimBlank(["", "a", "", "b", ""])).toEqual(["a", "", "b"]);
  });
});

describe("Frame with a report", () => {
  it("keeps the report and the steps in one frame", () => {
    const box = plain(
      new Frame(
        "Zitadel is ready",
        ["PROJECT", "✓ Id   proj-1"],
        [{ text: "Start it:", command: "npm run dev" }],
      ).render(),
    );

    expect(box).toContain("PROJECT");
    expect(box).toContain("npm run dev");
    expect(box.indexOf("PROJECT")).toBeLessThan(box.indexOf("npm run dev"));
  });
});
