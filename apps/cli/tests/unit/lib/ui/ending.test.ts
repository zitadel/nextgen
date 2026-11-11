import { stripVTControlCharacters as stripAnsi } from "node:util";
import pc from "picocolors";
import { describe, expect, it } from "vitest";

import { command, dim, strong } from "@/lib/style";
import { Ending } from "@/lib/ui/ending";
import { section, type Summary } from "@/lib/ui/summary";
import { Where } from "@/lib/ui/where";

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

describe("the next steps of a normal command", () => {
  const START = "npx @zitadel/cli@0.5.0 start";
  const OVERVIEW = "Explore all commands:\n  npx @zitadel/cli@0.5.0";
  const normally = (summary: Partial<Summary>): Ending =>
    new Ending({ title: "Done", sections: [], ...summary }, nowhere, "plain");
  const written = (summary: Partial<Summary>): string =>
    plain(normally(summary).renderStandalone()).trim();

  it("sit under one bold Next: heading, however many steps there are", () => {
    const shown = normally({
      next: [{ text: "Open the app." }, { text: "Next:", command: START }],
    }).renderStandalone();

    expect(shown.split("\n").filter((line) => line.includes("Next:"))).toEqual([strong("Next:")]);
  });

  it("put a sentence before the commands, indented under the heading", () => {
    expect(written({ next: [{ text: "Open the app." }, { text: "Next:", command: START }] })).toBe(
      `Next:\n  Open the app.\n  $ ${START}`,
    );
  });

  it("draw each command the way every other command is drawn, dim $ and bold cyan", () => {
    const shown = normally({ next: [{ text: "Next:", command: START }] }).renderStandalone();

    expect(shown).toContain(`  ${dim("$")} ${command(START)}`);
  });

  it("leave a blank line between the answer and the heading", () => {
    expect(written({ lines: ["Project proj-1."], next: [{ text: "Next:", command: START }] })).toBe(
      `Project proj-1.\n\nNext:\n  $ ${START}`,
    );
  });

  it("end on the overview when the command asks for it, under the steps", () => {
    expect(written({ next: [{ text: "Next:", command: START }], overview: OVERVIEW })).toBe(
      `Next:\n  $ ${START}\n\n${OVERVIEW}`,
    );
  });

  it("open on a blank line when the command has no answer to follow, after what it wrote", () => {
    const shown = plain(normally({ next: [{ text: "Next:", command: START }] }).renderStandalone());

    expect(shown.startsWith(`\nNext:\n  $ ${START}`)).toBe(true);
  });

  it("end on the overview even when there is nothing to do next", () => {
    expect(written({ overview: OVERVIEW })).toBe(OVERVIEW);
  });

  it("add no overview the command did not ask for", () => {
    expect(written({ next: [{ text: "Next:", command: START }] })).not.toContain(
      "Explore all commands",
    );
  });

  it("are not shown by a wizard's standalone ending, which draws them in its box", () => {
    const shown = plain(
      new Ending(
        { title: "Done", sections: [], next: [{ text: "Next:", command: START }] },
        nowhere,
        "wizard",
      ).renderStandalone(),
    );

    expect(shown).not.toContain(START);
  });
});

describe("what a long failure looks like under its closing line", () => {
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

  // A wizard writes none of its steps out as lines, so without this a summary
  // that carried steps and forgot to ask for a box lost them in silence — the
  // overview and the skills offer the base command appends included.
  it("frames a wizard's steps even when the summary never asked for a box", () => {
    const shown = plain(
      ending({ next: [{ text: "Deploy it:", command: "zitadel deploy" }] }).render(),
    );

    expect(shown).toContain("zitadel deploy");
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

  // The terminal wraps a long line to its own width, and a line it wraps is
  // still one line when it is copied. Only the box has a width of its own.
  describe("a line longer than the terminal", () => {
    const long = `Error E_NETWORK: GET http://localhost:9/deployments?project_id=${"x".repeat(60)}&live=true got no response, and ${"then some ".repeat(8)}`;

    it("closes a chain on its whole sentence, on one line", () => {
      expect(plain(ending({ title: long, failed: true }).line)).toBe(long);
    });

    it("says a normal command's failure on one line, and what it has to say under it", () => {
      const shown = plain(
        normally({ title: long, lines: [long], failed: true }).renderStandalone(),
      );

      expect(shown.split("\n").filter((line) => line === long)).toHaveLength(2);
    });

    it("says a normal command's answer as it is", () => {
      const shown = plain(normally({ lines: [long] }).renderStandalone());

      expect(shown).toContain(`${long}\n`);
    });

    it("says a next step's sentence on one line", () => {
      const shown = plain(normally({ next: [{ text: long }] }).renderStandalone());

      expect(shown).toContain(`  ${long}\n`);
    });
  });

  // A command broken across lines can no longer be run, and the box breaks a
  // long one with the shell's own continuation. A normal command's step is not
  // in a box, so its command is left whole, however long.
  it("leaves a normal command's next-step command whole, however long", () => {
    const command =
      "npx @zitadel/cli@0.5.0 deployment create --release rel_01KX3RG8A7F0N9WD3P2E4YM5C1 --server http://localhost:8111";

    const shown = plain(
      normally({
        title: "Created rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
        next: [{ text: "Next:", command }],
      }).renderStandalone(),
    );

    expect(shown).toContain(`Next:\n  $ ${command}\n`);
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

  // Which project, on which server, is the thing a run that failed is read
  // for: a `-e production` run that failed against staging looks identical
  // without it. It is the same dim footer an answer gets, under the failure
  // rather than beside it, because the failure is already said in red above.
  it("says where a normal command's failure happened, under it", () => {
    const shown = plain(
      normally({ title: "Error E_NOT_FOUND: nope", failed: true }, somewhere).renderStandalone(),
    );

    expect(shown).toContain("project proj-1 on api.zitadel.cloud");
  });
});

describe("the answer of a normal command, which draws no chain", () => {
  const answering = (summary: Partial<Summary>) =>
    new Ending({ title: "Done", sections: [], ...summary }, nowhere, "plain");

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
