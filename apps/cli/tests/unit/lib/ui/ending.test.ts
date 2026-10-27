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

    // A dim unmarked footer is right for an answer and wrong for an error:
    // it would make "Error E_NOT_FOUND: …" read exactly like "No variables
    // on the project".
    it("never lets a failure take the footer shape an answer takes", () => {
      const failure = new Ending(
        { title: "Error E_NOT_FOUND: variable not found", sections: [], failed: true },
        nowhere,
        false,
      );

      expect(failure.standalone).toBe(false);
    });

    it("lets an answer that asked nothing take it", () => {
      const answer = new Ending({ title: "No variables", sections: [] }, nowhere, false);

      expect(answer.standalone).toBe(true);
    });

    it("does not repeat those extras in the footer of a standalone ending", () => {
      const standalone = new Ending(
        { title: "Found 1 environment", sections: [], extras: ["Resolved now: development"] },
        nowhere,
        false,
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

describe("the answer of a command that drew no chain", () => {
  const answering = (summary: Partial<Summary>) =>
    new Ending({ title: "Done", sections: [], ...summary }, nowhere, false);

  // `release create -m x` drew a 98-column headline: the standalone answer was
  // the one body the layout never folded.
  it("folds a long answer instead of running it off the screen", () => {
    const long = `Created a release ${"that keeps going ".repeat(8)}`;

    const shown = plain(answering({ lines: [long] }).renderStandalone());

    expect(Math.max(...shown.split("\n").map((line) => line.length))).toBeLessThanOrEqual(80);
  });

  it("still leaves a table's rows whole", () => {
    const rows = [
      "name         source                  resolved",
      "development  .env.development.local  yes      ",
    ];

    const shown = plain(answering({ lines: rows }).renderStandalone());

    expect(shown).toContain(rows[0] as string);
  });
});
