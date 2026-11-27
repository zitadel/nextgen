import { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { BaseCommand } from "@/cli/core";
import type { CommandResult } from "@/cli/core";
import { cliPackageRoot } from "@tests/helpers/oclif-build";

const config = await Config.load(cliPackageRoot);

/**
 * A command that answers before its run is admitted when the words it was run
 * with say so, and records whether `execute` ran.
 */
class Early extends BaseCommand {
  /** Whether the command's work ran. */
  public executed = false;

  /**
   * Answers early when the first word is `early`.
   *
   * @returns The early result, or nothing.
   */
  protected override async answeredEarly(): Promise<CommandResult | undefined> {
    if (!this.argv.includes("early")) {
      return undefined;
    }

    return { status: "ok", data: { early: true }, summary: { title: "Early", sections: [] } };
  }

  /**
   * The command's work.
   *
   * @returns The result.
   */
  protected async execute(): Promise<CommandResult> {
    this.executed = true;

    return { status: "ok", data: { early: false }, summary: { title: "Done", sections: [] } };
  }
}

/** The command, run as the CLI runs it, with `words` after the flags every run takes. */
function command(...words: string[]): Early {
  return new Early(words, config);
}

describe("answeredEarly", () => {
  it("emits the result a command answers before its run is admitted", async () => {
    const early = command("early");

    const envelope = await early.run();

    expect(envelope).toMatchObject({ status: "ok", data: { early: true } });
  });

  it("never runs the work of a command that answered early", async () => {
    const early = command("early");

    await early.run();

    expect(early.executed).toBe(false);
  });

  it("runs the work of a command that answered nothing", async () => {
    const early = command();

    const envelope = await early.run();

    expect(envelope).toMatchObject({ status: "ok", data: { early: false } });
    expect(early.executed).toBe(true);
  });
});
