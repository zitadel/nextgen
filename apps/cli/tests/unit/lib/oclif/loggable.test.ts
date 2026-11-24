import { Command, Config } from "@oclif/core";
import { describe, expect } from "vitest";

import { Loggable } from "@/lib/oclif/loggable";
import { warnings } from "@/lib/ui";
import { it } from "@tests/fixtures";
import { cliPackageRoot } from "@tests/helpers/oclif-build";

/**
 * A command with only the logging, its methods reachable from a test.
 */
class Saying extends Loggable(Command) {
  /**
   * Does nothing, as a command that only says things.
   */
  public async run(): Promise<void> {}

  /**
   * Says a statement of fact.
   *
   * @param text - What to say.
   */
  public saysInfo(text: string): void {
    this.info(text);
  }

  /**
   * Says a failure.
   *
   * @param text - What to say.
   */
  public saysFail(text: string): void {
    this.fail(text);
  }

  /**
   * Says detail nobody asked for.
   *
   * @param args - What to say.
   */
  public saysDebug(...args: unknown[]): void {
    this.debug(...args);
  }
}

/**
 * A command with the logging, built against the CLI's own config.
 *
 * @returns The command.
 */
async function aSayingCommand(): Promise<Saying> {
  return new Saying([], await Config.load(cliPackageRoot));
}

describe("Loggable", () => {
  it("says a statement of fact through the logger", async ({ recorded }) => {
    const command = await aSayingCommand();

    command.saysInfo("Adding the production environment");

    expect(recorded.said).toEqual([{ level: "info", text: "Adding the production environment" }]);
  });

  it("says a failure through the logger", async ({ recorded }) => {
    const command = await aSayingCommand();

    command.saysFail("could not reach the server");

    expect(recorded.said).toEqual([{ level: "fail", text: "could not reach the server" }]);
  });

  it("says debug detail through the logger, formatted as console formats it", async ({
    recorded,
  }) => {
    const command = await aSayingCommand();

    command.saysDebug("asset probe failed:", "boom", 3);

    expect(recorded.said).toEqual([{ level: "debug", text: "asset probe failed: boom 3" }]);
  });

  it("reports a warning, which --json carries in the result, and gives back what it was given", async () => {
    warnings.take();
    const command = await aSayingCommand();

    const given = command.warn("the flow was edited by hand");

    expect(given).toBe("the flow was edited by hand");
    expect(warnings.take()).toEqual(["the flow was edited by hand"]);
  });

  it("reports the message of an error it is given as a warning", async () => {
    warnings.take();
    const command = await aSayingCommand();

    command.warn(new Error("deprecated flag"));

    expect(warnings.take()).toEqual(["deprecated flag"]);
  });
});
