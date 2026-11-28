import { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { BaseCommand } from "@/cli/core";
import type { CommandResult } from "@/cli/core";
import { asTerminal, offTerminal } from "@tests/fixtures/terminal";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { printing } from "@tests/helpers/run-cli";

const config = await Config.load(cliPackageRoot);

/** The first line of the notice, which a reader should be shown once. */
const DIFF_HEADER = "diff --git a/.zitadel/policies/min.json b/.zitadel/policies/min.json";

/** The notice's last line, which the answer under it must not read as part of. */
const DIFF_END = '+    "min_length": 16';

/** A diff as a deploy's preparation hands it over: lines ending in a newline. */
const NOTICE = `${DIFF_HEADER}\n-    "min_length": 15\n${DIFF_END}\n`;

/** What the command answers under the notice, as a deploy says its release is live. */
const ANSWER = "Release r1 is now live.";

/**
 * A command that says a notice, then ends on the lines narrating it left for
 * its result and its answer under them, as a deploy does.
 */
class Narrating extends BaseCommand {
  public static override readonly id = "narrating-test";

  protected async execute(): Promise<CommandResult> {
    const lines = this.narrate([NOTICE]);

    return {
      status: "ok",
      data: {},
      summary: { title: "Done", sections: [], lines: [...lines, ANSWER] },
    };
  }
}

/** How many times `text` appears in `printed`. */
function timesIn(printed: string, text: string): number {
  return printed.split(text).length - 1;
}

describe("BaseCommand.narrate", () => {
  it.each([
    ["on a terminal", asTerminal],
    ["to a pipe", offTerminal],
  ])("shows a notice once %s", async (_where, at) => {
    const { stdout } = await printing(() => at(() => new Narrating([], config).run()));

    expect(timesIn(stdout, DIFF_HEADER)).toBe(1);
  });

  it("sets the answer apart from a notice it drew on a terminal", async () => {
    const { stdout } = await printing(() => asTerminal(() => new Narrating([], config).run()));

    expect(stdout).toContain(`${DIFF_END}\n\n${ANSWER}`);
  });
});
