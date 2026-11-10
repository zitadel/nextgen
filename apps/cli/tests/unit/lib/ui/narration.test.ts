import { stripVTControlCharacters as stripAnsi } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { log } from "../../../../src/lib/log";
import { MARK } from "../../../../src/lib/ui/marks";
import { Narration } from "../../../../src/lib/ui/narration";

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

const installed: Narration[] = [];

/** A narration installed as the sink, torn down however the test ends. */
const drawn = (chain = new Collected(), options: { debug?: boolean } = {}) => {
  const narration = new Narration(chain);
  narration.install(options);
  installed.push(narration);
  return { chain, narration };
};

afterEach(() => {
  for (const narration of installed.splice(0)) {
    narration.restore();
  }
});

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
});
