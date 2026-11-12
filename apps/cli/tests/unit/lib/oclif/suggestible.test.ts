import { Config } from "@oclif/core";
import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { BaseCommand } from "@/lib/oclif/base";
import { EnvironmentCommand } from "@/lib/oclif/environment-command";
import { Suggestible } from "@/lib/oclif/suggestible";
import { cliPackageRoot } from "@tests/helpers/oclif-build";

/** Suggests commands and keeps the directory alone as its selector, as `start` does. */
class DirectoryProbe extends Suggestible(BaseCommand) {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  async probe(args: string) {
    const { flags } = await this.parse(DirectoryProbe);
    await this.toMeta(flags);
    return this.suggest(args);
  }
}

/** Suggests commands and carries the environment selector, as `deploy` does. */
class EnvironmentProbe extends EnvironmentCommand {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  async probe(args: string) {
    const { flags } = await this.parse(EnvironmentProbe);
    await this.toMeta(flags);
    return this.suggest(args);
  }
}

const config = await Config.load(cliPackageRoot);

describe("Suggestible.suggest", () => {
  it("carries only the directory to a command that takes no environment selector", async ({
    dir,
  }) => {
    const suggested = await new EnvironmentProbe(["--cwd", dir, "--env", "staging"], config).probe(
      "setup",
    );

    expect(suggested).toMatch(new RegExp(`setup --cwd ${dir}$`));
    expect(suggested).not.toContain("--env");
  });

  it("carries the environment selector to a command that takes one", async ({ dir }) => {
    const suggested = await new EnvironmentProbe(["--cwd", dir, "--env", "staging"], config).probe(
      "deploy -m x",
    );

    expect(suggested).toMatch(new RegExp(`deploy -m x --env staging --cwd ${dir}$`));
  });

  it("leaves the directory off when none was typed", async () => {
    const suggested = await new DirectoryProbe([], config).probe("setup");

    expect(suggested).toMatch(/setup$/);
  });

  it("falls back to the command's own selector for a command it does not know", async ({ dir }) => {
    const suggested = await new EnvironmentProbe(["--cwd", dir, "--env", "staging"], config).probe(
      "nonesuch thing",
    );

    expect(suggested).toMatch(new RegExp(`nonesuch thing --env staging --cwd ${dir}$`));
  });

  it("keeps the directory alone as the selector of a command that resolves no environment", async ({
    dir,
  }) => {
    const suggested = await new DirectoryProbe(["--cwd", dir], config).probe("deploy -m x");

    expect(suggested).toMatch(new RegExp(`deploy -m x --cwd ${dir}$`));
  });
});
