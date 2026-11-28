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

/** A diff as a deploy's preparation hands it over: lines ending in a newline. */
const NOTICE = `${DIFF_HEADER}\n-    "min_length": 15\n+    "min_length": 16\n`;

/** A command that says a notice and ends on the lines narrating it left for its result. */
class Narrating extends BaseCommand {
  public static override readonly id = "narrating-test";

  protected async execute(): Promise<CommandResult> {
    const lines = this.narrate([NOTICE]);

    return { status: "ok", data: {}, summary: { title: "Done", sections: [], lines } };
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
});
