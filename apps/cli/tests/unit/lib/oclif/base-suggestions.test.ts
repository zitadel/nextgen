import { Config, Flags } from "@oclif/core";
import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { BaseCommand } from "@/lib/oclif/base";
import { EnvironmentCommand } from "@/lib/oclif/environment-command";
import { WHAT_CHANGED } from "@/lib/suggestion";
import { cliPackageRoot } from "@tests/helpers/oclif-build";

/** Suggests commands and keeps the directory alone as its scope, as `start` does. */
class DirectoryProbe extends BaseCommand {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  /**
   * The suggestions this run makes once its flags are read.
   *
   * @returns What it suggests for `deploy` and for `setup`.
   */
  async probe() {
    const { flags } = await this.parse(DirectoryProbe);
    await this.toMeta(flags);
    return {
      deploy: this.suggest({ id: "deploy", flags: { message: WHAT_CHANGED } }),
      setup: this.suggest({ id: "setup" }),
    };
  }
}

/** Suggests commands and carries the environment selection, as `deploy` does. */
class EnvironmentProbe extends EnvironmentCommand {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  /**
   * The suggestions this run makes once its flags are read.
   *
   * @returns What it suggests for `deploy`, for `setup`, for `origin add` with
   *   an environment of its own, and for a deferred `logs`.
   */
  async probe() {
    const { flags } = await this.parse(EnvironmentProbe);
    await this.toMeta(flags);
    return {
      deploy: this.suggest({ id: "deploy", flags: { message: WHAT_CHANGED } }),
      setup: this.suggest({ id: "setup" }),
      origin: this.suggest({
        id: "origin:add",
        args: { pattern: "-weird" },
        flags: { kind: "primary", env: "staging" },
      }),
      deferred: this.suggest({ id: "variable:get", args: { name: "FOO" } }),
    };
  }
}

/** Resolves no environment, as the `auth-method` commands do, yet takes the flags. */
class FilesOnlyProbe extends EnvironmentCommand {
  static override meta = { resolveServer: false, environment: false };

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  /**
   * What this run suggests for `deploy` once its flags are read.
   *
   * @returns The suggestion.
   */
  async probe() {
    const { flags } = await this.parse(FilesOnlyProbe);
    await this.toMeta(flags, { resolveServer: false, environment: false });
    return this.suggest({ id: "deploy", flags: { dryRun: true } });
  }
}

/** Takes a switch named for what it turns off, as `claim --no-open` does. */
class SwitchProbe extends BaseCommand {
  public static override readonly id: string = "console";
  static override flags = {
    "no-open": Flags.boolean({ description: "Print the link instead of opening it." }),
  };

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  /**
   * This run again, as a dry run offers it.
   *
   * @returns The command.
   */
  async probe() {
    const { flags } = await this.parse(SwitchProbe);
    await this.toMeta(flags);
    return this.realRun();
  }
}

const config = await Config.load(cliPackageRoot);

describe("BaseCommand.suggest", () => {
  it("carries only the directory to a command that takes no environment", async ({ dir }) => {
    const { setup } = await new EnvironmentProbe(
      ["--cwd", dir, "--env", "production"],
      config,
    ).probe();

    expect(setup).toMatch(new RegExp(`setup --cwd ${dir}$`));
  });

  it("carries the environment selection to a command that takes one", async ({ dir }) => {
    const { deploy } = await new EnvironmentProbe(
      ["--cwd", dir, "--env", "production"],
      config,
    ).probe();

    expect(deploy).toMatch(
      new RegExp(`deploy --message '<what changed>' --env production --cwd ${dir}$`),
    );
  });

  it("lets a suggestion that chooses its own environment keep it", async ({ dir }) => {
    const { origin } = await new EnvironmentProbe(
      ["--cwd", dir, "--env", "production"],
      config,
    ).probe();

    expect(origin).toMatch(
      new RegExp(`origin add --kind primary --env staging --cwd ${dir} -- -weird$`),
    );
  });

  it("renders a deferred suggestion with the run's scope", async ({ dir }) => {
    const { deferred } = await new EnvironmentProbe(
      ["--cwd", dir, "--env", "production"],
      config,
    ).probe();

    expect(deferred).toMatch(new RegExp(`variable get FOO --env production --cwd ${dir}$`));
  });

  it("leaves the directory off when none was typed", async () => {
    const { setup } = await new DirectoryProbe([], config).probe();

    expect(setup).toMatch(/setup$/);
  });

  it("keeps the directory alone in a command that resolves no environment", async ({ dir }) => {
    const { deploy } = await new DirectoryProbe(["--cwd", dir], config).probe();

    expect(deploy).toMatch(new RegExp(`deploy --message '<what changed>' --cwd ${dir}$`));
  });

  it("carries the environment typed to a command that resolved none", async ({ dir }) => {
    const deploy = await new FilesOnlyProbe(
      ["--cwd", dir, "--env", "staging", "--server", "https://a.example"],
      config,
    ).probe();

    expect(deploy).toMatch(
      new RegExp(`deploy --dry-run --env staging --server https://a.example --cwd ${dir}$`),
    );
  });
});

describe("BaseCommand.rerun", () => {
  it("keeps a switch named for what it turns off", async () => {
    const real = await new SwitchProbe(["--no-open", "--dry-run"], config).probe();

    expect(real).toMatch(/console --no-open$/);
  });
});
