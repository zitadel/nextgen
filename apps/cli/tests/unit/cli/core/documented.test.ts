import { Args, Command, Flags } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { Documented } from "@/cli/core/documented";
import { inputFlag } from "@/cli/core/input";
import { aConfigAt } from "@tests/helpers/suggestions";

/**
 * A command with one flag and one argument, which only reports the words it
 * would be run with.
 */
class Declaring extends Documented(Command) {
  static override args = {
    name: Args.string(),
  };
  static override flags = {
    limit: Flags.integer(),
    input: inputFlag,
  };

  /**
   * Never run.
   *
   * @returns Nothing, at once.
   */
  public run(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * The words after oclif's own setup, which is where the document is laid.
   *
   * @returns The words the command would parse.
   */
  public async words(): Promise<string[]> {
    await this.init();

    return this.argv;
  }
}

/**
 * The words a line is parsed as.
 *
 * @param argv - The line.
 * @returns The words after the document is laid under it.
 */
function parsedAs(argv: string[]): Promise<string[]> {
  return new Declaring(argv, aConfigAt("0.0.0-test")).words();
}

describe("Documented", () => {
  it("replaces the words the command parses with what the document says", async () => {
    expect(await parsedAs(["--input", '{"limit":2,"name":"n"}'])).toEqual(["--limit=2", "--", "n"]);
  });

  it("leaves a line without a document as it was", async () => {
    expect(await parsedAs(["--limit", "2"])).toEqual(["--limit", "2"]);
  });

  it("keeps a document it cannot use on the line, and does not throw", async () => {
    expect(await parsedAs(["--input", '{"nope":1}'])).toEqual(['--input={"nope":1}']);
  });
});
