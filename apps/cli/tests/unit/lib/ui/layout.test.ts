import { stripAnsi } from "consola/utils";
import { describe, expect, it } from "vitest";

import { Facts, Frame, Prose, WIDTH } from "../../../../src/lib/ui/layout";
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

  it("leaves a table's rows whole, however long, because their gaps line up", () => {
    const table = [
      "topic   verbs                              filters",
      "users   list, get, create, update, delete   created_at, id, schema",
      "teams   list, get, create, update           created_at, name, status",
    ].join("\n");

    expect(new Prose(table, 20).render()).toBe(table);
  });

  // The whole bug: a label and three `key=value` pairs joined by two spaces is
  // not a table, and nothing was aligned to it, so it ran off the screen as
  // one unbroken line. A stray double space after a full stop did the same.
  it("wraps a sentence that happens to hold a double space", () => {
    const sentence = "Project proj-1  lifecycle=configured  issuer=https://auth.example.com";

    expect(new Prose(sentence, 30).render().split("\n").length).toBeGreaterThan(1);
  });

  it("wraps a line that lines up with nothing above or below it", () => {
    const text = ["Done.  Everything that was asked for has been written.", "And then some."].join(
      "\n",
    );

    expect(new Prose(text, 30).render().split("\n").length).toBeGreaterThan(2);
  });

  it("leaves a row whole when the caller says it is building columns", () => {
    const row = "Wrote    .zitadel/schemas/default-human-user.json and .zitadel/flows/login.json";

    expect(new Prose(row, 20, true).render()).toBe(row);
  });

  it("folds even an aligned table when the caller says there are no columns", () => {
    const table = ["a   one of the values", "b   another of the values"].join("\n");

    expect(new Prose(table, 10, false).render()).not.toBe(table);
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

  // Written with real escapes rather than picocolors, which draws nothing
  // under the test runner: measuring a styled line by its raw length is the
  // whole bug, so the test has to carry the colour itself.
  it("is the same width when its last line is coloured, as it is at a terminal", () => {
    const dim = (text: string) => `\u001b[2m${text}\u001b[22m`;

    const box = new Frame(
      "Summary",
      ["Short body."],
      [{ text: "Do it." }],
      dim("On host."),
    ).render();

    expect(widest(box)).toBe(WIDTH);
  });

  it("is the same width when it ends on a command, which is always coloured", () => {
    const box = new Frame("Summary", [], [{ text: "Do it:", command: "zitadel deploy" }]).render();

    expect(widest(box)).toBe(WIDTH);
  });

  it("wraps what the command rendered, not only its steps", () => {
    const box = new Frame("Summary", [`A headline ${"that keeps going ".repeat(12)}`], []).render();

    expect(widest(box)).toBeLessThanOrEqual(WIDTH);
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

  // A frame sizes itself to its content, so anything left unwrapped inside one
  // widens it. `zitadel status` drew a 93-column box this way, out of one line
  // that held two spaces.
  it("never widens for a table it is handed", () => {
    const box = new Frame(
      "Summary",
      [
        "name         source                  server                       resolved",
        "development  .env.development.local  https://api.zitadel.cloud    yes",
      ],
      [],
    ).render();

    expect(widest(box)).toBe(WIDTH);
  });

  it("never widens for a step whose sentence holds a double space", () => {
    const box = new Frame(
      "Summary",
      [],
      [
        {
          text: `Project proj-1  lifecycle=configured  issuer=https://${"sub.".repeat(8)}example.com`,
        },
      ],
    ).render();

    expect(widest(box)).toBe(WIDTH);
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
