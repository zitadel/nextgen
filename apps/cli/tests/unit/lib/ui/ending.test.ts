import { stripAnsi } from "consola/utils";
import pc from "picocolors";
import { describe, expect, it } from "vitest";

import { Ending } from "../../../../src/lib/ui/ending";
import { section, type Summary } from "../../../../src/lib/ui/summary";
import { Where } from "../../../../src/lib/ui/where";

const plain = (text: string | undefined): string => stripAnsi(text ?? "");
const nowhere = new Where();
const somewhere = new Where("proj-1", "api.zitadel.cloud");
const ending = (summary: Partial<Summary>, where = nowhere): Ending =>
  new Ending({ title: "Done", sections: [], ...summary }, where);

describe("Ending", () => {
  describe("the line it closes on", () => {
    it("is the headline the command gave", () => {
      expect(plain(ending({ title: "Removed the origin" }).line)).toBe("Removed the origin");
    });

    it("is red when the headline is a failure", () => {
      expect(ending({ title: "Stopped", failed: true }).line).toBe(pc.red("Stopped"));
    });
  });

  describe("what goes under it", () => {
    it("is nothing at all for a command that produced nothing and reached nothing", () => {
      expect(ending({}).render()).toBeUndefined();
    });

    it("says nothing at all for a command that produced nothing and left nothing to do", () => {
      expect(ending({}, somewhere).render()).toBeUndefined();
    });

    it("states the facts under the closing line, unframed, when nothing is left to do", () => {
      const below = plain(ending({ sections: [section("Project", ["Id", "proj-1"])] }).render());

      expect(below).toContain("proj-1");
      expect(below).not.toContain("╭");
    });

    it("frames the steps a command left to do", () => {
      expect(
        plain(
          ending({
            next: [{ text: "Deploy it:", command: "zitadel deploy" }],
            boxed: true,
          }).render(),
        ),
      ).toContain("zitadel deploy");
    });

    it("frames a command that asked for a box though it produced nothing", () => {
      expect(plain(ending({ boxed: true }).render())).toContain("╭");
    });

    it("closes the box with where it ran, under what the command produced", () => {
      const below = plain(
        ending(
          {
            lines: ["a table"],
            next: [{ text: "Deploy it:", command: "zitadel deploy" }],
            boxed: true,
          },
          somewhere,
        ).render(),
      );

      expect(below.indexOf("a table")).toBeLessThan(below.indexOf("Using project proj-1"));
    });

    it("leaves a listing alone: no frame, and no line about where it ran", () => {
      const below = plain(ending({ lines: ["a table"] }, somewhere).render());

      expect(below).toContain("a table");
      expect(below).not.toContain("╭");
      expect(below).not.toContain("Using project proj-1");
    });

    // The same command prints these as its footer when it drew no chain, so
    // losing them because something happened to open one would make the
    // output depend on whether an unrelated warning fired.
    it("keeps what the command added after its listing, once a chain is open", () => {
      const below = plain(
        ending({ lines: ["a table"], extras: ["Resolved now: development"] }).render(),
      );

      expect(below).toContain("Resolved now: development");
    });

    it("does not repeat those extras in the footer of a standalone ending", () => {
      const standalone = new Ending(
        { title: "Found 1 environment", sections: [], extras: ["Resolved now: development"] },
        nowhere,
        "plain",
      );

      const shown = plain(standalone.renderStandalone());

      expect(shown.match(/Resolved now: development/g)).toHaveLength(1);
    });

    it("drops the blank lines a command's own rendering left at either end", () => {
      expect(plain(ending({ lines: ["", "a table", ""] }).render())).toBe("   a table\n");
    });

    it("titles the box as the command asked", () => {
      expect(plain(ending({ boxed: true, boxTitle: "Zitadel is ready" }).render())).toContain(
        "Zitadel is ready",
      );
    });

    it("titles it Summary when the command did not ask for a title", () => {
      expect(plain(ending({ boxed: true }).render())).toContain("Summary");
    });
  });
});

describe("what a long failure looks like under its closing line", () => {
  // A server pastes a URL into its message; the message must still fold
  // rather than run off the right of the screen.
  it("wraps the body of an unboxed ending", () => {
    const long = `GET http://host/deployments?project_id=x returned 404 ${"and then some more words ".repeat(6)}`;

    const below = plain(ending({ lines: [long], failed: true }).render());

    expect(Math.max(...below.split("\n").map((line) => line.length))).toBeLessThanOrEqual(80);
  });

  // Outside a frame nothing is widened by a wide line, so a table the command
  // was asked for keeps its columns however wide they are.
  it("still leaves a table's rows whole, past the width prose obeys", () => {
    const rows = [
      "name         source                  server                    project_id  resolved",
      "development  .env.development.local  http://mock.zitadel.test  proj-1      yes",
    ];

    const below = plain(ending({ lines: rows }).render());

    for (const row of rows) {
      expect(below).toContain(row);
    }
  });

  it("folds a sentence that holds a double space, which no table is aligned to", () => {
    const sentence = `Project proj-1  lifecycle=configured  issuer=https://${"sub.".repeat(10)}example.com`;

    const below = plain(ending({ lines: [sentence] }).render());

    expect(Math.max(...below.split("\n").map((line) => line.length))).toBeLessThanOrEqual(80);
  });
});

describe("which shape an ending takes", () => {
  const normally = (summary: Partial<Summary>, where = nowhere) =>
    new Ending({ title: "Done", sections: [], ...summary }, where, "plain");

  // The shape is the command's, so nothing a run happens to produce — a
  // question, a warning, a failure, a box the command asked for — may change
  // it. That is the whole defect: `--force` used to change how a command
  // looked, because it decided whether anything opened a chain.
  it.each([
    ["an answer", {}],
    ["a failure", { failed: true }],
    ["a summary that asked for a box", { boxed: true }],
    ["a summary with steps", { next: [{ text: "Deploy it:", command: "zitadel deploy" }] }],
  ])("stands on its own for a normal command ending on %s", (_what, summary) => {
    expect(normally(summary).standalone).toBe(true);
  });

  it("never frames a normal command's summary, even one that asked for a frame", () => {
    expect(plain(normally({ boxed: true, lines: ["a detail"] }).render())).not.toContain("╭");
  });

  it("frames the same summary for a wizard", () => {
    expect(plain(ending({ boxed: true, lines: ["a detail"] }).render())).toContain("╭");
  });

  // With no box to hold them, dropping the steps would lose the command the
  // person is meant to run next, which is what an ending is read for.
  it("writes a normal command's next steps out as lines", () => {
    const shown = plain(
      normally({
        title: "Started the local Zitadel server",
        next: [{ text: "Create an app:", command: "zitadel setup --server local" }],
      }).renderStandalone(),
    );

    expect(shown).toContain("Create an app:\n  $ zitadel setup --server local");
  });

  // A dim unmarked footer is right for an answer and wrong for an error: it
  // would make "Error E_NOT_FOUND: …" read exactly like "No variables on the
  // project". With no chain to close in red, the headline itself is red.
  it("says a normal command's failure in red above what it has to say", () => {
    const shown = normally({
      title: "Error E_NOT_FOUND: variable not found",
      lines: ["Check the name."],
      failed: true,
    }).renderStandalone();

    expect(shown).toContain(pc.red("Error E_NOT_FOUND: variable not found"));
    expect(plain(shown)).toContain("Check the name.");
  });

  it("keeps where it ran out of a failure, which is not an answer", () => {
    const shown = plain(
      normally({ title: "Error E_NOT_FOUND: nope", failed: true }, somewhere).renderStandalone(),
    );

    expect(shown).not.toContain("proj-1");
  });
});

describe("the answer of a normal command, which draws no chain", () => {
  const answering = (summary: Partial<Summary>) =>
    new Ending({ title: "Done", sections: [], ...summary }, nowhere, "plain");

  // `release create -m x` drew a 98-column headline: the standalone answer was
  // the one body the layout never folded.
  it("folds a long answer instead of running it off the screen", () => {
    const long = `Created a release ${"that keeps going ".repeat(8)}`;

    const shown = plain(answering({ lines: [long] }).renderStandalone());

    expect(Math.max(...shown.split("\n").map((line) => line.length))).toBeLessThanOrEqual(80);
  });

  it("still leaves a table's rows whole, however wide they are", () => {
    const rows = [
      "name         source                  server                    project_id         resolved",
      "development  .env.development.local  http://mock.zitadel.test  proj-1c9eb9159f55  yes     ",
    ];

    const shown = plain(answering({ lines: rows }).renderStandalone());

    for (const row of rows) {
      expect(shown).toContain(row);
    }
  });
});
