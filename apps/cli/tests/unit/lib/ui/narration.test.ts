import { stripAnsi } from "consola/utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { consola } from "consola";

import { MARK } from "../../../../src/lib/ui/marks";
import { Narration } from "../../../../src/lib/ui/narration";

/** A chain that collects what was narrated into it, as `mark text`. */
class Collected {
  readonly lines: string[] = [];

  narrate(symbol: string, text: string): void {
    this.lines.push(`${stripAnsi(symbol)} ${text}`);
  }
}

/** A narration installed on consola, torn down however the test ends. */
const bridged = (): { chain: Collected; narration: Narration } => {
  const chain = new Collected();
  const narration = new Narration(chain);
  narration.install();
  installed.push(narration);
  return { chain, narration };
};

const installed: Narration[] = [];
let level = 0;

beforeEach(() => {
  // Off a terminal consola reports warnings and above only, which would hide
  // the very lines the bridge exists to redraw.
  level = consola.level;
  consola.level = 5;
});

afterEach(() => {
  for (const narration of installed.splice(0)) {
    narration.restore();
  }
  consola.level = level;
});

describe("Narration", () => {
  it("draws the lines a command still writes with consola into the chain", () => {
    const { chain } = bridged();

    consola.info("Looking for a project");

    expect(chain.lines).toEqual([`${stripAnsi(MARK.info)} Looking for a project`]);
  });

  it("gives each consola level the mark that level deserves", () => {
    const { chain } = bridged();

    consola.success("Done");
    consola.warn("Careful");
    consola.error("Broken");

    expect(chain.lines.map((line) => line.split(" ")[0])).toEqual(
      [MARK.done, MARK.warning, MARK.failed].map(stripAnsi),
    );
  });

  it("says nothing for a line that is only whitespace", () => {
    const { chain } = bridged();

    consola.info("   ");

    expect(chain.lines).toEqual([]);
  });

  it("drops the blank lines a command padded its message with", () => {
    const { chain } = bridged();

    consola.info("\n\nLooking for a project");

    expect(chain.lines).toEqual([`${stripAnsi(MARK.info)} Looking for a project`]);
  });

  it("is installed once, however many times it is asked", () => {
    const { narration } = bridged();
    narration.install();
    narration.restore();

    expect(narration.installed).toBe(false);
  });

  it("gives consola its own reporters back, so the next command starts clean", () => {
    const before = [...consola.options.reporters];
    const { narration, chain } = bridged();

    narration.restore();
    consola.info("after the command ended");

    expect(consola.options.reporters).toEqual(before);
    expect(chain.lines).toEqual([]);
  });

  it("restores nothing when it was never installed", () => {
    const before = [...consola.options.reporters];

    new Narration(new Collected()).restore();

    expect(consola.options.reporters).toEqual(before);
  });
});
