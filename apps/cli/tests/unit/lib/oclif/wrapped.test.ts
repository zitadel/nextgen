import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Config, Plugin } from "@oclif/core";
import { describe, expect } from "vitest";

import { ZitadelError } from "@/lib/errors";
import { BaseCommand } from "@/lib/oclif";
import { Wrapped } from "@/lib/oclif/wrapped";
import { it } from "@tests/fixtures";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { parseJson, runCliForTest } from "@tests/helpers/run-cli";

const PLUGIN = "plugin-on-disk";

/**
 * A wrapped command that stands in for a plugin command of the given id, and
 * says nothing of its own.
 */
function wrapping(id: string, plugin: string): new (argv: string[], config: Config) => BaseCommand {
  return class Standing extends Wrapped(BaseCommand) {
    static override id = id;
    static override readonly wrapsPlugin = plugin;
    static override strict = false;

    /**
     * Prints nothing, so the run's only output is the envelope.
     */
    public override log(): void {}
  };
}

/**
 * Lays a plugin on disk whose commands are the given sources, and loads it
 * into the CLI's own config under {@link PLUGIN}.
 *
 * @param dir - An empty directory to lay the plugin in.
 * @param commands - Each command's file name and its `run` body.
 * @returns The CLI's config, with the plugin registered.
 */
async function withPlugin(dir: string, commands: Record<string, string>): Promise<Config> {
  await mkdir(join(dir, "commands"));
  await mkdir(join(dir, "node_modules", "@oclif"), { recursive: true });
  await symlink(
    join(cliPackageRoot, "node_modules", "@oclif", "core"),
    join(dir, "node_modules", "@oclif", "core"),
  );
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: PLUGIN,
      version: "1.0.0",
      type: "module",
      oclif: { commands: "./commands" },
    }),
  );
  for (const [name, body] of Object.entries(commands)) {
    await writeFile(
      join(dir, "commands", `${name}.js`),
      `import { Command } from "@oclif/core";\nexport default class extends Command {\n  async run() {\n    ${body}\n  }\n}\n`,
    );
  }
  const config = await Config.load(cliPackageRoot);
  const plugin = new Plugin({ root: dir, type: "user" });
  await plugin.load();
  config.plugins.set(PLUGIN, plugin);

  return config;
}

describe("WrappedCommand", () => {
  it("drops the global flags the plugin's own command refuses", async () => {
    const result = await runCliForTest([
      "version",
      "--non-interactive",
      "--no-telemetry",
      "--json",
    ]);

    expect(result).toSucceed();
    expect(parseJson(result.stdout)).toMatchObject({
      status: "ok",
      command: "version",
    });
  });

  it("hands the plugin the flags it declares", async () => {
    const result = await runCliForTest(["commands", "--hidden", "--json"]);

    expect(parseJson(result.stdout)).toMatchObject({
      data: {
        result: expect.arrayContaining([expect.objectContaining({ id: "deployments:list" })]),
      },
    });
  });

  it("answers a list the plugin returned as the envelope's data.result", async () => {
    const result = await runCliForTest(["commands", "--json"]);

    expect(parseJson(result.stdout)).toMatchObject({ data: { result: expect.any(Array) } });
  });

  it("answers what a plugin printed, when it returned nothing, as data.output", async () => {
    const result = await runCliForTest(["help", "--json"]);

    expect(parseJson(result.stdout)).toMatchObject({ data: { output: expect.any(String) } });
  });

  it("answers a failure of the plugin's own command without the framework's error object", async () => {
    const result = await runCliForTest(["help", "nonexist", "--json"]);

    expect(result).toFailWith("E_VALIDATION");
    expect(parseJson(result.stdout)).not.toHaveProperty("details");
  });

  it("answers a flag the plugin refuses as the failure envelope", async () => {
    const result = await runCliForTest(["commands", "--sort", "bogus", "--json"]);

    expect(result).toFailWith("E_VALIDATION");
  });

  it("answers E_NOT_IMPLEMENTED when the plugin has no command of that name", async ({ dir }) => {
    const config = await withPlugin(dir, { present: "return;" });
    const Missing = wrapping("absent", PLUGIN);

    await expect(new Missing(["--json"], config).run()).rejects.toMatchObject({
      code: "E_NOT_IMPLEMENTED",
      message: `The ${PLUGIN} plugin has no absent command`,
    });
  });

  it("answers E_NOT_IMPLEMENTED when no such plugin is installed", async () => {
    const config = await Config.load(cliPackageRoot);
    const Missing = wrapping("anything", "no-such-plugin");

    await expect(new Missing(["--json"], config).run()).rejects.toMatchObject({
      code: "E_NOT_IMPLEMENTED",
    });
  });

  it("reports a plugin command's failure in its own words, without the error object", async ({
    dir,
  }) => {
    const config = await withPlugin(dir, { failing: 'throw new Error("plugin broke");' });
    const Failing = wrapping("failing", PLUGIN);

    const failure = await new Failing(["--json"], config).run().catch((error: unknown) => {
      return error;
    });

    expect(failure).toBeInstanceOf(ZitadelError);
    expect(failure).toMatchObject({ message: "plugin broke" });
    expect(failure).not.toHaveProperty("oclif");
  });

  it("does not hang a plugin command that waits for its write to be flushed", async ({ dir }) => {
    const config = await withPlugin(dir, {
      waiting: 'await new Promise((resolve) => process.stdout.write("held\\n", resolve));',
    });
    const Waiting = wrapping("waiting", PLUGIN);

    const envelope = await new Waiting(["--json"], config).run();

    expect(envelope).toMatchObject({
      status: "ok",
      data: { output: "held" },
    });
  });
});
