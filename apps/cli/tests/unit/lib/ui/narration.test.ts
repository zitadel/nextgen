import { stripVTControlCharacters as stripAnsi } from "node:util";
import { describe, expect, onTestFinished } from "vitest";

import { it } from "@tests/fixtures";
import { log } from "@/lib/ui";
import { MARK } from "@/lib/ui/marks";
import { Narration } from "@/lib/ui/narration";

/** A chain that collects what was narrated into it, as `mark text`. */
class Collected {
  readonly lines: string[] = [];
  readonly chained: boolean;

  constructor(chained = true) {
    this.chained = chained;
  }

  narrate(symbol: string, text: string): void {
    this.lines.push(`${stripAnsi(symbol)} ${text}`);
  }
}

/** A narration installed as the sink, torn down however the test ends. */
const drawn = (chain = new Collected(), options: { debug?: boolean; silent?: boolean } = {}) => {
  const narration = new Narration(chain);
  narration.install(options);
  onTestFinished(() => {
    narration.restore();
  });
  return { chain, narration };
};

describe("Narration", () => {
  it("draws what a command says into the chain", () => {
    const { chain } = drawn();

    log.info("Looking for a project");

    expect(chain.lines).toEqual([`${stripAnsi(MARK.info)} Looking for a project`]);
  });

  it("gives each level the mark that level deserves", () => {
    const { chain } = drawn();

    log.done("Done");
    log.warn("Careful");
    log.fail("Broken");
    log.start("Working");

    expect(chain.lines.map((line) => line.split(" ")[0])).toEqual(
      [MARK.done, MARK.warning, MARK.failed, MARK.started].map(stripAnsi),
    );
  });

  it("draws a blank line as it was written, so a note keeps its spacing", () => {
    const { chain } = drawn();

    log.info("");

    expect(chain.lines).toEqual([`${stripAnsi(MARK.info)} `]);
  });

  it("draws nothing when it is silent, which is what --json asks for", () => {
    const { chain } = drawn(new Collected(), { silent: true });

    log.info("a statement");
    log.warn("a warning");
    log.fail("a failure");

    expect(chain.lines).toEqual([]);
  });

  it("keeps debug detail back unless it was asked for", () => {
    const quiet = drawn();
    log.debug("an internal detail");
    quiet.narration.restore();

    const loud = drawn(new Collected(), { debug: true });
    log.debug("an internal detail");

    expect([quiet.chain.lines, loud.chain.lines.length]).toEqual([[], 1]);
  });

  it("is installed once, however many times it is asked", () => {
    const { narration } = drawn();
    narration.install();
    narration.restore();

    expect(narration.installed).toBe(false);
  });

  it("stops drawing when restored, so the next command starts clean", () => {
    const { narration, chain } = drawn();

    narration.restore();
    log.info("after the command ended");

    expect(chain.lines).toEqual([]);
  });

  it("restores nothing when it was never installed", () => {
    expect(() => {
      new Narration(new Collected()).restore();
    }).not.toThrow();
  });
  describe("when no chain is drawn", () => {
    it("writes a progress line on a terminal", ({ terminal }) => {
      terminal.tty(true);
      drawn(new Collected(false));

      log.progress("GET https://example.test/");

      expect(terminal.plain()).toContain("GET https://example.test/");
    });

    it("leaves a progress line out off a terminal, so stdout holds only what a script reads", ({
      terminal,
    }) => {
      terminal.tty(false);
      drawn(new Collected(false));

      log.progress("GET https://example.test/");

      expect(terminal.plain()).toBe("");
    });

    it.for<[string, () => void]>([
      ["info", () => log.info("a statement")],
      ["done", () => log.done("a result")],
      ["start", () => log.start("a beginning")],
      ["plain", () => log.plain("a link")],
    ])(
      "still writes a %s line off a terminal, which can be the command's answer",
      ([, say], { terminal }) => {
        terminal.tty(false);
        drawn(new Collected(false));

        say();

        expect(terminal.plain()).not.toBe("");
      },
    );

    it("draws a progress line into a chain on a terminal", ({ terminal }) => {
      terminal.tty(true);
      const { chain } = drawn();

      log.progress("Waiting for the browser step to finish");

      expect(chain.lines).toEqual([
        `${stripAnsi(MARK.started)} Waiting for the browser step to finish`,
      ]);
    });

    it("leaves a progress line out of a chain off a terminal", ({ terminal }) => {
      terminal.tty(false);
      const { chain } = drawn();

      log.progress("Waiting for the browser step to finish");

      expect(chain.lines).toEqual([]);
    });
  });
});
