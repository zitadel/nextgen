import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Plugin } from "@oclif/core";
import { describe, expect } from "vitest";

import { COMMAND_GROUPS } from "@/cli/commands/groups";
import { it } from "@tests/fixtures";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import {
  expectedPublicCliCommand,
  parseJson,
  runCliForTest,
  stripAnsi,
} from "@tests/helpers/run-cli";

/**
 * The root screen, byte for byte. Issue #1248 specified the shape, and #2263 the
 * groups: named for what a developer is doing, one row per family of commands.
 */
const ROOT_HELP = `Manage your Zitadel project and local identity server from the command line.

Usage
  zitadel <command> [flags]

Run a command below. Use \`zitadel <command> --help\` to see its options.

Getting started
  setup            Create a Zitadel project and scaffold local auth
  claim            Claim this project to make it permanent
  doctor           Verify local runtime and project state
  skills           Give coding agents the Zitadel skills
  tests            Add end-to-end tests of the sign-in

Local server
  start            Start a local Zitadel server
  stop             Stop the local Zitadel server
  status           Summarize the local Zitadel server and project state
  logs             Show local Zitadel server logs
  console          Open the console of the server the project uses
  reset            Delete the local Zitadel server runtime and data
  eject            Remove managed files and local Zitadel state

Users and access
  user             Create and manage users
  team             Create and manage teams
  grant            Manage access grants
  session          View and revoke sessions

Sign-in
  auth-method      Configure how users sign in
  idp              Manage identity provider connections
  schema           View user schemas
  branding         Manage the login branding
  flow-definition  View login flows
  policy           View and test policies

Project settings
  project          View and update projects
  env              Show and bind environments
  origin           Manage the project's allowed origins
  variable         Manage project variables
  upgrade          Upgrade this project to the latest Zitadel release

Releases
  deploy           Apply your local configuration to Zitadel
  preview          Deploy and manage pull-request preview URLs
  pull             Rebuild your .zitadel/ files from a release
  release          Build and manage releases
  deployment       Deploy releases and roll them back

API and events
  event            View events
  api              Call any operation of the Zitadel API
  resources        List the resources this CLI manages

CLI
  commands         List all zitadel commands
  search           Search for a command
  autocomplete     Display autocomplete installation instructions
  version          Show the CLI version
  which            Show which plugin a command is in

Flags
  -h, --help  Show help for command
  --version   Show zitadel version

Examples
  $ zitadel setup --framework next
  $ zitadel start
  $ zitadel doctor
`;

/**
 * A package root laid out as the published tarball is: `package.json`, `dist`,
 * and an `oclif.manifest.json` generated the way `build` (`oclif manifest`)
 * generates it, so oclif loads commands from the manifest instead of scanning
 * `dist/commands`. `node_modules` is linked so the plugins resolve.
 *
 * @param root - The empty directory to lay the package out in.
 * @returns The manifest's path and the package root.
 */
async function stagePublishedPackage(
  root: string,
): Promise<{ manifestPath: string; root: string }> {
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
    const { exitCode, stdout } = await runCliForTest(["schema", "--help"]);

    expect(exitCode).toBe(0);
    expect(stripAnsi(stdout)).toContain("schema list");
  });

  it("shows a noun's help when asked under its plural", async () => {
    const { stdout } = await runCliForTest(["schemas", "--help"]);

    expect(stripAnsi(stdout)).toContain("USAGE\n  $ zitadel schema COMMAND");
  });

  it("shows a command's help as it is declared when asked under its noun's plural", async () => {
    const { stdout } = await runCliForTest(["schemas", "list", "--help"]);

    expect(stripAnsi(stdout)).toContain("USAGE\n  $ zitadel schema list");
  });

  it("lists no plural among a noun's commands", async () => {
    const { stdout } = await runCliForTest(["schema", "--help"]);

    expect(stripAnsi(stdout)).not.toContain("schemas ");
  });

  it.each([
    { label: "a command", argv: ["claim", "--help"] },
    { label: "a family of commands", argv: ["user", "--help"] },
  ])("ends the help for $label with where to find every command", async ({ argv }) => {
    const { exitCode, stdout } = await runCliForTest(argv);

    expect(exitCode).toBe(0);
    expect(stripAnsi(stdout).trimEnd().split("\n").slice(-2)).toEqual([
      "Explore all commands:",
      `  ${expectedPublicCliCommand("")}`,
    ]);
  });

  it("keeps each family of commands in one group, and describes it with a topic", async () => {
    const { stdout } = await runCliForTest(["commands", "--json"]);
    const commands = (
      parseJson(stdout) as Array<{
        id: string;
        aliases: string[];
        pluginName?: string;
        group?: string;
      }>
    )
      .filter((command) => command.pluginName === "@zitadel/cli")
      .filter((command) => !command.aliases.includes(command.id));
    const groupsOf = new Map<string, Set<string | undefined>>();
    for (const command of commands.filter((candidate) => candidate.id.includes(":"))) {
      const [family = command.id] = command.id.split(":");
      groupsOf.set(family, (groupsOf.get(family) ?? new Set()).add(command.group));
    }
    const { oclif } = JSON.parse(await readFile(join(cliPackageRoot, "package.json"), "utf8")) as {
      oclif: { topics: Record<string, { description?: string }> };
    };

    expect([...groupsOf].filter(([, groups]) => groups.size > 1).map(([family]) => family)).toEqual(
      [],
    );
    expect([...groupsOf.keys()].filter((family) => !oclif.topics[family]?.description)).toEqual([]);
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
  it("renders the same groups when commands load from oclif.manifest.json", async ({ dir }) => {
    const { root } = await stagePublishedPackage(dir);

    const { exitCode, stdout, stderr } = await runCliForTest(["--help"], {}, root);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stripAnsi(stdout)).toBe(ROOT_HELP);
  });

  it("reads the groups from the manifest, not from dist", async ({ dir }) => {
    const { manifestPath, root } = await stagePublishedPackage(dir);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      commands: Record<string, { group?: string; groupOrder?: number }>;
    };
    expect(manifest.commands.setup).toMatchObject({ group: "Getting started", groupOrder: 1 });
    // A manifest that lost the statics is what a regression would ship; the
    // screen must visibly change, proving the manifest is what was rendered.
    delete manifest!.commands.setup!.group;
    delete manifest!.commands.setup!.groupOrder;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const { stdout } = await runCliForTest(["--help"], {}, root);

    const text = stripAnsi(stdout);
    expect(text).not.toContain("Getting started\n  setup ");
    expect(text).toMatch(/CLI\n(?:.*\n)* {2}setup {2}/);
  });
});
