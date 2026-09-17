import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Plugin } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { COMMAND_GROUPS } from "../../../src/lib/oclif/groups";
import { cliPackageRoot } from "../../helpers/oclif-build";
import { parseJson, runCliForTest, stripAnsi } from "../../helpers/run-cli";

/** The root screen, byte for byte, as issue #1248 specifies it. */
const ROOT_HELP = `Manage your Zitadel project and local identity server from the command line.

Usage
  zitadel <command> [flags]

Project commands
  setup:          Create a Zitadel project and scaffold local auth
  claim:          Claim this project to make it permanent
  doctor:         Verify local runtime and project state
  eject:          Remove managed files and local Zitadel state

Local server commands
  start:          Start a local Zitadel server
  stop:           Stop the local Zitadel server
  status:         Summarize the local Zitadel server and project state
  logs:           Show local Zitadel server logs
  reset:          Delete the local Zitadel server runtime and data

Configuration commands
  plan:           Validate config without mutation and preview the sync diff
  apply:          Validate and upload repo config to the platform
  schemas list:   List revisions of a user-schema by objectType
  branding eject: Take ownership of the login template

Additional commands
  autocomplete:   Display autocomplete installation instructions
  commands:       List all zitadel commands
  search:         Search for a command
  version:        Show the CLI version
  which:          Show which plugin a command is in

Flags
  --help      Show help for command
  --version   Show zitadel version

Examples
  $ zitadel setup --framework next
  $ zitadel start
  $ zitadel doctor

Learn more
  Use \`zitadel <command> --help\` for more information about a command.
  Read the manual at https://zitadel.com/docs
`;

/**
 * A package root laid out as the published tarball is: `package.json`, `dist`,
 * and an `oclif.manifest.json` generated the way `prepack` (`oclif manifest`)
 * generates it, so oclif loads commands from the manifest instead of scanning
 * `dist/commands`. `node_modules` is linked so the plugins resolve.
 */
async function stagePublishedPackage(): Promise<{ manifestPath: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "zitadel-cli-published-"));
  await Promise.all([
    writeFile(join(root, "package.json"), await readFile(join(cliPackageRoot, "package.json"))),
    symlink(join(cliPackageRoot, "dist"), join(root, "dist")),
    symlink(join(cliPackageRoot, "node_modules"), join(root, "node_modules")),
  ]);
  const plugin = new Plugin({
    errorOnManifestCreate: true,
    ignoreManifest: true,
    respectNoCacheDefault: true,
    root: cliPackageRoot,
    type: "core",
  });
  await plugin.load();
  const manifestPath = join(root, "oclif.manifest.json");
  await writeFile(manifestPath, JSON.stringify(plugin.manifest, null, 2));
  return { manifestPath, root };
}

describe("root help", () => {
  it.each([
    { label: "no arguments", argv: [] },
    { label: "--help", argv: ["--help"] },
    { label: "help", argv: ["help"] },
  ])("groups the commands by purpose for $label", async ({ argv }) => {
    const { exitCode, stdout, stderr } = await runCliForTest(argv);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stripAnsi(stdout)).toBe(ROOT_HELP);
  });

  it("leaves per-command help to oclif", async () => {
    const { exitCode, stdout } = await runCliForTest(["claim", "--help"]);

    expect(exitCode).toBe(0);
    expect(stripAnsi(stdout)).toContain("USAGE\n  $ zitadel claim");
    expect(stripAnsi(stdout)).toContain("FLAGS");
    // The root screen's one-line clause is derived, not declared, so the
    // command's own description is still the full sentence.
    expect(stripAnsi(stdout)).toContain("Opens a browser to create an account or sign in.");
  });

  it("leaves topic help to oclif", async () => {
    const { exitCode, stdout } = await runCliForTest(["schemas", "--help"]);

    expect(exitCode).toBe(0);
    expect(stripAnsi(stdout)).toContain("schemas list");
  });

  it("requires every product command to declare a group", async () => {
    const { exitCode, stdout } = await runCliForTest(["commands", "--json"]);
    expect(exitCode).toBe(0);
    const groups: readonly string[] = COMMAND_GROUPS;
    const ungrouped = (
      parseJson(stdout) as Array<{
        id: string;
        aliases: string[];
        pluginName?: string;
        group?: unknown;
      }>
    )
      .filter((command) => command.pluginName === "@zitadel/cli")
      .filter((command) => !command.aliases.includes(command.id))
      .filter((command) => typeof command.group !== "string" || !groups.includes(command.group))
      .map((command) => command.id);

    expect(ungrouped).toEqual([]);
  });
});

describe("root help from the published manifest", () => {
  it("renders the same groups when commands load from oclif.manifest.json", async () => {
    const { root } = await stagePublishedPackage();

    const { exitCode, stdout, stderr } = await runCliForTest(["--help"], {}, root);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stripAnsi(stdout)).toBe(ROOT_HELP);
  });

  it("reads the groups from the manifest, not from dist", async () => {
    const { manifestPath, root } = await stagePublishedPackage();
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      commands: Record<string, { group?: string; groupOrder?: number }>;
    };
    expect(manifest.commands.setup).toMatchObject({ group: "Project commands", groupOrder: 1 });
    // A manifest that lost the statics is what a regression would ship; the
    // screen must visibly change, proving the manifest is what was rendered.
    delete manifest.commands.setup.group;
    delete manifest.commands.setup.groupOrder;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const { stdout } = await runCliForTest(["--help"], {}, root);

    const text = stripAnsi(stdout);
    expect(text).not.toContain("Project commands\n  setup:");
    expect(text).toMatch(/Additional commands\n(?:.*\n)* {2}setup: /);
  });
});
