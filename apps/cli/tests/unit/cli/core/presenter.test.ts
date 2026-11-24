import { afterEach, describe, expect, vi } from "vitest";

import { Presenter, type PresentedRun } from "@/cli/core/presenter";
import { prose, rows } from "@/lib/oclif/rendering";
import type { CommandResult, GlobalOptions } from "@/cli/core/types";
import { Output, Ui } from "@/lib/ui";
import { test as it } from "@tests/fixtures";
import { offTerminal } from "@tests/fixtures/terminal";
import { aSuggest } from "@tests/helpers/suggestions";

/**
 * The release the runs report.
 */
const VERSION = "0.0.0-test";

/**
 * A server that is not the default one, so an ending names it.
 */
const OTHER_SERVER = "https://acme.example.com";

/**
 * The line an ending opens on.
 */
const TITLE = "Deployed the release";

/**
 * What a command wrote beside its ending, as the command's own rendering.
 */
const OWN = "own rendering";

/**
 * A command that deploys, which a result suggests.
 */
const DEPLOY = aSuggest({}, VERSION)({ id: "deploy" });

/**
 * The words the skills offer opens on.
 */
const SKILLS_OFFER = "Using an AI coding agent?";

/**
 * A run, and what it wrote, in arrays the test owns.
 */
type Rig = Readonly<{
  /**
   * What the presenter is handed.
   */
  run: PresentedRun;
  /**
   * The lines written to stdout.
   */
  written: string[];
  /**
   * The lines written to stderr.
   */
  aside: string[];
}>;

/**
 * The options a run settled: a script's, against `source`.
 *
 * @param source - The server the run is about.
 * @returns The options.
 */
function aMeta(source: string): GlobalOptions {
  return {
    cwd: "/tmp/project",
    nonInteractive: true,
    dryRun: false,
    force: false,
    command: "deploy",
    cliVersion: VERSION,
    source,
    verbose: false,
    debug: false,
    env: {},
    isTTY: false,
  };
}

/**
 * A run for a person nobody can ask: no chain is drawn, and stdout and stderr go to arrays.
 *
 * @param overrides - What to set in place of the defaults.
 * @returns The run, and the lines it wrote.
 */
function aRig(overrides: Partial<PresentedRun> = {}): Rig {
  const written: string[] = [];
  const aside: string[] = [];
  const run: PresentedRun = {
    meta: aMeta("mock"),
    ui: new Ui(
      { interactive: false, force: false },
      overrides.wizard === true ? "wizard" : "plain",
    ),
    version: VERSION,
    wizard: false,
    skillsOffered: false,
    dryRun: false,
    suggest: aSuggest({}, VERSION),
    log: (text) => {
      written.push(text);
    },
    logAside: (text) => {
      aside.push(text);
    },
    ...overrides,
  };

  return { run, written, aside };
}

/**
 * A result that succeeded.
 *
 * @param overrides - What to set in place of the defaults.
 * @returns The result.
 */
function anOk(overrides: Partial<Extract<CommandResult, { status: "ok" }>> = {}): CommandResult {
  return {
    status: "ok",
    data: { id: "rel_1" },
    summary: { title: TITLE, sections: [] },
    ...overrides,
  };
}

describe("Presenter.present", () => {
  afterEach(() => {
    Output.settle({ json: false, color: false });
  });

  describe("a piped rendering", () => {
    const piped = anOk({
      pretty: rows("a\tb"),
      next: { commands: [DEPLOY] },
      warnings: ["careful"],
      footer: "See also",
    });

    it("writes the rendering alone to stdout", async () => {
      const { run, written } = aRig();

      await offTerminal(async () => {
        return new Presenter(run).present(piped);
      });

      expect(written).toEqual(["a\tb"]);
    });

    it("writes the next steps beside it on stderr", async () => {
      const { run, aside } = aRig();

      await offTerminal(async () => {
        return new Presenter(run).present(piped);
      });

      expect(aside[0]).toContain("Next:");
    });

    it("writes the warnings beside it on stderr", async () => {
      const { run, aside } = aRig();

      await offTerminal(async () => {
        return new Presenter(run).present(piped);
      });

      expect(aside.join("\n")).toContain("careful");
    });

    it("writes the footer beside it on stderr", async () => {
      const { run, aside } = aRig();

      await offTerminal(async () => {
        return new Presenter(run).present(piped);
      });

      expect(aside.at(-1)).toBe("\nSee also");
    });
  });

  describe("a run that draws a chain", () => {
    it("closes the chain on the ending", async ({ terminal }) => {
      const { run, written } = aRig({
        wizard: true,
        ui: new Ui({ interactive: true, force: false }, "wizard"),
      });

      new Presenter(run).present(anOk());

      expect(terminal.plain()).toContain(TITLE);
      expect(written).toEqual([]);
    });
  });

  describe("a run whose command ended itself", () => {
    it("writes the rendering as it is, on a terminal too", async ({ terminal }) => {
      const ui = new Ui({ interactive: false, force: false }, "wizard");
      ui.ending({ title: "Already said", sections: [] });
      const { run, written } = aRig({ wizard: true, ui });
      terminal.tty(true);

      new Presenter(run).present(anOk({ pretty: prose(OWN) }));

      expect(written).toEqual([OWN]);
    });
  });

  describe("a command that is not a wizard, off a terminal", () => {
    it("writes the rendering as it is, with the footer after it", async () => {
      const { run, written } = aRig();

      await offTerminal(async () => {
        return new Presenter(run).present(anOk({ pretty: prose(OWN), footer: "See also" }));
      });

      expect(written).toEqual([OWN, "\nSee also"]);
    });

    it("writes nothing for an empty rendering", async () => {
      const { run, written } = aRig();

      await offTerminal(async () => {
        return new Presenter(run).present(anOk({ pretty: prose("") }));
      });

      expect(written).toEqual([]);
    });
  });

  describe("a wizard", () => {
    it("writes its ending where a person at a terminal would have it drawn", async () => {
      const { run, written } = aRig({ wizard: true });

      await offTerminal(async () => {
        return new Presenter(run).present(anOk({ pretty: prose(OWN) }));
      });

      expect(written.join("\n")).toContain(TITLE);
    });

    it("does not write its rendering in place of the ending", async () => {
      const { run, written } = aRig({ wizard: true });

      await offTerminal(async () => {
        return new Presenter(run).present(anOk({ pretty: prose(OWN) }));
      });

      expect(written.join("\n")).not.toContain(OWN);
    });

    it("ends on the command overview", async () => {
      const { run, written } = aRig({
        wizard: true,
      });

      await offTerminal(async () => {
        return new Presenter(run).present(anOk({ next: { commands: [DEPLOY] } }));
      });

      expect(written.join("\n")).toContain("Explore all commands:");
    });
  });

  describe("under --json", () => {
    it("writes nothing to stdout", async () => {
      Output.settle({ json: true, color: false });
      const { run, written } = aRig({ wizard: true });

      await offTerminal(async () => {
        return new Presenter(run).present(anOk({ pretty: prose(OWN) }));
      });

      expect(written).toEqual([]);
    });

    it("still returns the envelope", async () => {
      Output.settle({ json: true, color: false });
      const { run } = aRig();

      const envelope = await offTerminal(async () => {
        return new Presenter(run).present(anOk());
      });

      expect(envelope).toMatchObject({ status: "ok", data: { id: "rel_1", title: TITLE } });
    });
  });

  describe("the envelope", () => {
    it("is ok for a success, with the options the run settled", async () => {
      const { run } = aRig();

      const envelope = await offTerminal(async () => {
        return new Presenter(run).present(anOk({ warnings: ["careful"] }));
      });

      expect(envelope).toMatchObject({
        status: "ok",
        cli_version: VERSION,
        command: "deploy",
        warnings: ["careful"],
      });
    });

    it("is skipped for a skip, with its reason and commands", async () => {
      const { run } = aRig();

      const envelope = await offTerminal(async () => {
        return new Presenter(run).present({
          status: "skipped",
          reason: "nothing-to-do",
          summary: { title: "Nothing to do", sections: [] },
          next: { commands: [DEPLOY] },
        });
      });

      expect(envelope).toMatchObject({ status: "skipped", reason: "nothing-to-do" });
    });
  });

  describe("the server the run ran on", () => {
    it("is named in the ending when it is not the default one", async () => {
      const { run, written } = aRig({ wizard: true, meta: aMeta(OTHER_SERVER) });

      await offTerminal(async () => {
        return new Presenter(run).present(anOk());
      });

      expect(written.join("\n")).toContain("acme.example.com");
    });

    it("is left out of the ending of a dry run, which spoke to no server", async () => {
      const { run, written } = aRig({ wizard: true, dryRun: true, meta: aMeta(OTHER_SERVER) });

      await offTerminal(async () => {
        return new Presenter(run).present(anOk());
      });

      expect(written.join("\n")).not.toContain("acme.example.com");
    });
  });

  describe("the skills offer", () => {
    it("is made when the run changed something and the offer is still open", async ({ dir }) => {
      vi.stubEnv("XDG_CONFIG_HOME", dir);
      const { run, written } = aRig({ wizard: true, skillsOffered: true });

      await offTerminal(async () => {
        return new Presenter(run).present(anOk());
      });

      expect(written.join("\n")).toContain(SKILLS_OFFER);
    });

    it("is not made when the offer has been made before", async ({ dir }) => {
      vi.stubEnv("XDG_CONFIG_HOME", dir);
      const { run, written } = aRig({ wizard: true, skillsOffered: false });

      await offTerminal(async () => {
        return new Presenter(run).present(anOk());
      });

      expect(written.join("\n")).not.toContain(SKILLS_OFFER);
    });

    it("is kept for a later run when this one skipped", async ({ dir }) => {
      vi.stubEnv("XDG_CONFIG_HOME", dir);
      const { run, written } = aRig({ wizard: true, skillsOffered: true });

      await offTerminal(async () => {
        return new Presenter(run).present({
          status: "skipped",
          reason: "nothing-to-do",
          summary: { title: "Nothing to do", sections: [] },
        });
      });

      expect(written.join("\n")).not.toContain(SKILLS_OFFER);
    });
  });
});
