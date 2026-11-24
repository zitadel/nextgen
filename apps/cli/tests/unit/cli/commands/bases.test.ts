import { describe, expect, it } from "vitest";

import { ChangeCommand, ProjectCommand, ReadCommand, RemoveCommand } from "@/cli/commands/bases";

/** What a base's name promises of the flags and questions a command built on it has. */
type Promised = Readonly<{
  /** Whether the command takes `--dry-run`. */
  dryRun: boolean;
  /** Whether the command takes `--force`. */
  force: boolean;
  /** Whether the command may ask a question. */
  asks: boolean;
}>;

/** A base's `baseFlags` and prototype, which are what its composition leaves a command. */
type Base = Readonly<{
  baseFlags: Record<string, unknown>;
  prototype: object;
}>;

const READS: Promised = { dryRun: false, force: false, asks: false };
const CHANGES: Promised = { dryRun: true, force: false, asks: false };
const REMOVES: Promised = { dryRun: true, force: true, asks: false };

const BASES: ReadonlyArray<readonly [string, Base, Promised]> = [
  ["ProjectCommand", ProjectCommand, READS],
  ["ReadCommand", ReadCommand, READS],
  ["ChangeCommand", ChangeCommand, CHANGES],
  ["RemoveCommand()", RemoveCommand(), REMOVES],
];

describe("the named bases", () => {
  it.each(BASES)(
    "%s takes --dry-run, --force and questions as its name promises",
    (_name, base, promised) => {
      expect("dry-run" in base.baseFlags).toBe(promised.dryRun);
      expect("force" in base.baseFlags).toBe(promised.force);
      expect("ask" in base.prototype).toBe(promised.asks);
    },
  );

  it.each(BASES)("%s takes --server, which every base is about a server for", (_name, base) => {
    expect(base.baseFlags).toHaveProperty("server");
  });

  it("gives --force the sentence a remove base is given", () => {
    const flags = RemoveCommand("Remove the thing without asking.").baseFlags;

    expect(flags.force).toMatchObject({ description: "Remove the thing without asking." });
  });

  it("gives --force a sentence of its own when none is given", () => {
    expect(RemoveCommand().baseFlags.force).toMatchObject({
      description: expect.stringContaining("Skip the confirmation"),
    });
  });
});
