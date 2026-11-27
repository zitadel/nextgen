import { Config, Flags } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { EFFECT } from "@/cli/core/effect";
import { BaseCommand } from "@/cli/core";
import { Destructive } from "@/cli/core/destructive";
import { Previewable } from "@/cli/core/previewable";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import type { CommandResult } from "@/cli/core";

/**
 * A command that changes something, recording which of its two methods ran.
 */
class Changing extends Previewable(BaseCommand) {
  /** The command's id, as oclif names it. */
  public static override readonly id: string = "thing:set";

  /** The flags the command takes of its own. */
  public static override readonly flags = { name: Flags.string() };

  /** Which of the two methods ran, in order. */
  public readonly ran: string[] = [];

  /**
   * @param argv - The words the command is run with.
   */
  constructor(argv: string[]) {
    super(argv, {
      version: "1.2.3",
      runHook: async () => ({ successes: [], failures: [] }),
    } as unknown as Config);
  }

  /**
   * Says what it would do.
   *
   * @returns The dry run's envelope.
   */
  protected async preview(): Promise<CommandResult> {
    this.ran.push("preview");

    return { status: "ok", data: {}, summary: { title: "Done", sections: [] } };
  }

  /**
   * Does it.
   *
   * @returns The run's envelope.
   */
  protected async apply(): Promise<CommandResult> {
    this.ran.push("apply");

    return { status: "ok", data: {}, summary: { title: "Done", sections: [] } };
  }

  /**
   * Settles the run's context and runs the command's work, as `run` does.
   *
   * @param dryRun - Whether `--dry-run` was given.
   */
  public async work(dryRun: boolean): Promise<void> {
    await this.toMeta({ "no-telemetry": true, "dry-run": dryRun }, { source: "mock" });
    await this.execute({ flags: {}, args: {}, argv: [] } as never);
  }
}

/**
 * A command that changes nothing, which is built on nothing of this mixin.
 */
abstract class Reading extends BaseCommand {}

describe("Previewable", () => {
  it("declares --dry-run, which a command that changes nothing does not take", () => {
    expect(Changing.baseFlags).toHaveProperty("dry-run");
    expect(Reading.baseFlags).not.toHaveProperty("dry-run");
  });

  it("answers a dry run with its preview and never applies", async () => {
    const command = new Changing([]);

    await command.work(true);

    expect(command.ran).toEqual(["preview"]);
  });

  it("applies when it is not a dry run and never previews", async () => {
    const command = new Changing([]);

    await command.work(false);

    expect(command.ran).toEqual(["apply"]);
  });

  it("says what it does to the world, for a mixin that needs a command that changes it", () => {
    expect(new Changing([])[EFFECT]).toBe("changes");
  });
});

const config = await Config.load(cliPackageRoot);

/** A command that previews and removes, standing for `variable rm`, to ask for its real run. */
class Removing extends Destructive(Previewable(BaseCommand)) {
  /** The command's id, as oclif names it. */
  public static override readonly id: string = "variable:rm";

  /** The words after the command's name are its arguments, whatever they are. */
  public static override strict = false;

  /**
   * Says what it would do.
   *
   * @returns Nothing: a probe never runs it.
   */
  protected async preview(): Promise<never> {
    throw new Error("unused");
  }

  /**
   * Does it.
   *
   * @returns Nothing: a probe never runs it.
   */
  protected async apply(): Promise<never> {
    throw new Error("unused");
  }

  /**
   * The real run this dry run offers next.
   *
   * @param adding - What the real run is given on top.
   * @returns The command.
   */
  async real(adding?: { force?: true }) {
    const { flags } = await this.parse(Removing);
    await this.toMeta(flags);

    return this.realRun(adding);
  }
}

describe("Previewable.realRun", () => {
  it("drops --dry-run from the run it offers", async () => {
    const real = await new Removing(["API_URL", "--dry-run"], config).real();

    expect(real).toMatch(/variable rm API_URL$/);
  });

  it("adds --force only when asked", async () => {
    const real = await new Removing(["API_URL", "--dry-run"], config).real({ force: true });

    expect(real).toMatch(/variable rm API_URL --force$/);
  });
});

describe("Previewable at compile time", () => {
  it("does not compile without a preview and an apply", () => {
    // @ts-expect-error a command that takes --dry-run must say what it would do and do it
    class Missing extends Previewable(BaseCommand) {}

    expect(Missing).toBeDefined();
  });

  it("does not compile with an execute of its own", () => {
    class Own extends Previewable(BaseCommand) {
      protected async preview(): Promise<CommandResult> {
        return { status: "ok", data: {}, summary: { title: "Done", sections: [] } };
      }

      protected async apply(): Promise<CommandResult> {
        return { status: "ok", data: {}, summary: { title: "Done", sections: [] } };
      }

      // @ts-expect-error execute is the mixin's: it picks preview or apply
      protected async execute(): Promise<CommandResult> {
        return { status: "ok", data: {}, summary: { title: "Done", sections: [] } };
      }
    }

    expect(Own).toBeDefined();
  });
});
