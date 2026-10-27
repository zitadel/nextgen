import { stripAnsi } from "consola/utils";
import { describe, expect, it } from "vitest";

import {
  COLUMN_MARK,
  columnGap,
  Facts,
  Frame,
  Prose,
  WIDTH,
  wrapCommand,
} from "../../../../src/lib/ui/layout";
import { section } from "../../../../src/lib/ui/summary";

const plain = (text: string): string => stripAnsi(text);
const widest = (text: string): number =>
  Math.max(
    ...plain(text)
      .split("\n")
      .map((line) => line.length),
  );

/** The lines a box holds, without its border, its padding or its blanks. */
const inside = (box: string): string[] =>
  plain(box)
    .split("\n")
    .flatMap((line) => {
      const held = /^\s*│(.*)│\s*$/.exec(line)?.[1];
      return held === undefined ? [] : [held.slice(2).trimEnd()];
    })
    .filter((line) => line !== "");

/** What a shell makes of the lines a command was written over. */
const pasted = (lines: readonly string[]): string =>
  lines.join("\n").replaceAll("\\\n", "").replace(/ +/g, " ").trim();

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

  // A record of one field is one line, so the alignment its builder laid it
  // out with has nothing to agree with. The mark in the gap is the builder
  // saying so, and it is the only thing that separates this line from the
  // sentence with a stray double space just above.
  it("leaves a lone row whole when its builder marked the gap it aligned", () => {
    const row = `value${columnGap()}${"x".repeat(120)}`;

    expect(new Prose(row, 30).render()).toBe(`value  ${"x".repeat(120)}`);
  });

  it("takes the builder's mark back out of everything it renders", () => {
    const row = `value${columnGap()}held`;

    expect(new Prose(row, 30).render()).not.toContain(COLUMN_MARK);
  });

  it("takes the mark out of a row it folds as well, so no mark survives a fold", () => {
    const row = `value${columnGap()}${"x".repeat(120)}`;

    expect(new Prose(row, 30, false).render()).not.toContain(COLUMN_MARK);
  });

  it("folds a marked row when the caller says there are no columns", () => {
    const row = `value${columnGap()}${"x".repeat(120)}`;

    expect(new Prose(row, 30, false).render().split("\n").length).toBeGreaterThan(1);
  });

  it("does not count the mark as width, so a marked row fits where it reads as fitting", () => {
    const row = `ab${columnGap()}cd`;

    expect(new Prose(row, 6, false).render()).toBe("ab  cd");
  });
});

describe("wrapCommand", () => {
  it("leaves a command that already fits on one line", () => {
    expect(wrapCommand("zitadel deploy", 40)).toEqual(["zitadel deploy"]);
  });

  it("breaks a long command at a space between two of its arguments", () => {
    expect(wrapCommand("zitadel deploy --server http://localhost:9", 30)).toEqual([
      "zitadel deploy --server \\",
      "http://localhost:9",
    ]);
  });

  it("ends every line but the last in the shell's own continuation", () => {
    const lines = wrapCommand(`zitadel deploy ${"--flag value ".repeat(20)}`.trim(), 40);

    expect(lines.slice(0, -1).every((line) => line.endsWith(" \\"))).toBe(true);
    expect(lines.at(-1)?.endsWith("\\")).toBe(false);
  });

  // `\` before a newline is literal inside single quotes, so breaking there
  // would change the argument rather than continue the command.
  it("never breaks inside a quoted argument", () => {
    const lines = wrapCommand("npx @zitadel/cli@0.1.0 deploy -m '<what changed>' --server x", 40);

    expect(lines.every((line) => !/'<what$|^changed>'/.test(line))).toBe(true);
  });

  it("breaks an argument too long for a line of its own where it must", () => {
    const lines = wrapCommand(`zitadel deploy ${"-".repeat(90)}`, 40);

    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(40);
  });

  // The shell removes `\`-newline and nothing else, so an indent on the
  // continuation of a broken argument would land inside the argument.
  it("continues a broken argument at the margin, so the argument rejoins exactly", () => {
    const lines = wrapCommand(`zitadel deploy ${"-".repeat(90)}`, 40, "  ");

    expect(lines.slice(2).every((line) => !line.startsWith(" "))).toBe(true);
  });

  it("keeps the lead on a line it began at an argument boundary", () => {
    const lines = wrapCommand("zitadel deploy --server http://localhost:9", 30, "  ");

    expect(lines.every((line) => line.startsWith("  "))).toBe(true);
  });

  it("pastes back as the command it was", () => {
    const command = `npx @zitadel/cli@0.1.0 deploy -m '<what changed>' --server http://localhost:9 ${"-".repeat(90)}`;

    expect(pasted(wrapCommand(command, 40, "  "))).toBe(command);
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

  // A command is never folded as prose, because a command broken across lines
  // cannot be run. It is written the way a shell writes one over several
  // lines, so the box keeps its ceiling and what is copied out still runs.
  it("never widens for a command longer than it is", () => {
    const command = `npx @zitadel/cli@0.1.0 deploy -m '<what changed>' --server http://localhost:9`;

    expect(widest(new Frame("Summary", [], [{ text: "Run next:", command }]).render())).toBe(WIDTH);
  });

  it("never widens for a command that is one unbreakable argument", () => {
    const command = `zitadel deploy ${"-".repeat(200)}`;

    expect(widest(new Frame("Next steps", [], [{ text: "Run next:", command }]).render())).toBe(
      WIDTH,
    );
  });

  it("writes a command too long to fit as the one command it is", () => {
    const command = `npx @zitadel/cli@0.1.0 deploy -m '<what changed>' --server http://localhost:9`;
    const box = new Frame("Summary", [], [{ text: "Run next:", command }]).render();

    expect(pasted(inside(box).filter((line) => line.trim() !== "Run next:"))).toBe(command);
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
  // A section of one fact is one line, so nothing lines up with it either.
  it("marks the gap it aligned, so a section of one fact survives the wrap", () => {
    const fact = new Facts([section("Project", ["Id", "x".repeat(120)])]).render();

    expect(plain(new Prose(fact, WIDTH).render()).split("\n")).toEqual([
      "Project",
      `Id   ${"x".repeat(120)}`,
    ]);
  });

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
