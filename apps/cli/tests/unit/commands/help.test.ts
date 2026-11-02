import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Plugin } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { COMMAND_GROUPS } from "../../../src/lib/oclif/groups";
import { cliPackageRoot } from "../../helpers/oclif-build";
import {
  expectedPublicCliCommand,
  parseJson,
  runCliForTest,
  stripAnsi,
} from "../../helpers/run-cli";

/**
 * The root screen, byte for byte. Issue #1248 specified the shape, and #2263 the
 * groups: named for what a developer is doing, one row per family of commands.
 */
const ROOT_HELP = `Manage your Zitadel project and local identity server from the command line.

Usage
  zitadel <command> [flags]

Run a command below. Use \`zitadel <command> --help\` to see its options.

Getting started
  setup             Create a Zitadel project and scaffold local auth
  start             Start a local Zitadel server
  status            Summarize the local Zitadel server and project state
  claim             Claim this project to make it permanent
  skills            Give coding agents the Zitadel skills

Local development
  console           Open the local console, signed in as the local admin
  logs              Show local Zitadel server logs
  stop              Stop the local Zitadel server
  reset             Delete the local Zitadel server runtime and data
  eject             Remove managed files and local Zitadel state

Users and teams
  users             Create and manage users
  teams             Create and manage teams
  grants            Manage access grants

Authentication
  auth-method       Configure how users sign in
  idps              Manage identity provider connections
  sessions          View and revoke sessions

Configuration and releases
  deploy            Apply your local configuration to Zitadel
  preview           Deploy and manage pull-request preview URLs
  pull              Rebuild your .zitadel/ files from a release
  branding          Manage the login branding
  deployment        Deploy releases and roll them back
  env               Show and bind environments
  flow-definitions  View login flows
  origin            Manage the project's allowed origins
  policies          View and test policies
  projects          View and update projects
  release           Build and manage releases
  schemas           View user schemas
  test              Check that parts of the project are set up correctly
  variable          Manage project variables

Diagnostics and utilities
  doctor            Verify local runtime and project state
  api               Call any operation of the Zitadel API
  autocomplete      Display autocomplete installation instructions
  commands          List all zitadel commands
  events            View events
  resources         List the resources this CLI manages
  search            Search for a command
  version           Show the CLI version
  which             Show which plugin a command is in

Flags
  --help      Show help for command
  --version   Show zitadel version

Examples
  $ zitadel setup --framework next
  $ zitadel start
  $ zitadel doctor
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

  it.each([
    { label: "a command", argv: ["claim", "--help"] },
    { label: "a family of commands", argv: ["users", "--help"] },
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
    expect(manifest.commands.setup).toMatchObject({ group: "Getting started", groupOrder: 1 });
    // A manifest that lost the statics is what a regression would ship; the
    // screen must visibly change, proving the manifest is what was rendered.
    delete manifest!.commands.setup!.group;
    delete manifest!.commands.setup!.groupOrder;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const { stdout } = await runCliForTest(["--help"], {}, root);

    const text = stripAnsi(stdout);
    expect(text).not.toContain("Getting started\n  setup ");
    expect(text).toMatch(/Diagnostics and utilities\n(?:.*\n)* {2}setup {2}/);
  });
});
