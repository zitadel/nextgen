import { consola } from "consola";

import { runAddSchema } from "./commands/add-schema";
import { runAppAdd, runAppList, runAppRemove, runAppShow } from "./commands/app";
import { runApply } from "./commands/apply";
import { runCapabilities } from "./commands/capabilities";
import { runDeployConnect, runDeployStatus } from "./commands/deploy";
import { runDoctor } from "./commands/doctor";
import { runEject } from "./commands/eject";
import { runHelp } from "./commands/help";
import { runSetup } from "./commands/setup";
import { runStatus } from "./commands/status";
import { hasZitadelConfig } from "./detect/state";
import type { CliIO, GlobalOptions } from "./io/output";
import { defaultIO, skipped, writeError } from "./io/output";
import { toZitadelError, ZitadelError } from "./lib/errors";
import { resolveCwd } from "./lib/paths";
import { CLI_VERSION } from "./lib/version";
import { resolveServer, DEFAULT_SERVER } from "./platform/resolve-server";

export async function runCli(argv = process.argv.slice(2), io: CliIO = defaultIO): Promise<number> {
  const parsed = parseArgs(argv, io);

  if (isVersionRequest(parsed)) {
    io.stdout.write(`${CLI_VERSION}\n`);
    return 0;
  }

  let meta: GlobalOptions | undefined;
  try {
    meta = await buildGlobalOptions(parsed, io);
    if (isHelpRequest(parsed)) {
      const target = parsed.positionals.slice(parsed.positionals[0] === "help" ? 1 : 0).join(" ");
      await runHelp(io, meta, target || undefined);
      return 0;
    }
    await dispatch(parsed, io, meta);
    return 0;
  } catch (error) {
    const zitadelError = toZitadelError(error);
    const opts = meta ?? fallbackMeta(parsed, io);
    writeError(io, zitadelError, opts);
    return zitadelError.exitCode;
  }
}

async function dispatch(parsed: ParsedArgs, io: CliIO, global: GlobalOptions): Promise<void> {
  const [command, subcommand] = parsed.positionals;
  if (!command) {
    if (await hasZitadelConfig(global.cwd)) {
      await runStatus(io, global);
    } else {
      await setupOrSkipped(parsed, io, global);
    }
    return;
  }

  switch (command) {
    case "setup":
      await runSetup(io, setupOptions(parsed, global));
      return;
    case "apply":
      await runApply(io, {
        ...global,
        environment: stringOpt(parsed, "environment"),
        platform: stringOpt(parsed, "platform"),
      });
      return;
    case "plan":
      await runApply(io, {
        ...global,
        dryRun: true,
        planOnly: true,
        environment: stringOpt(parsed, "environment"),
        platform: stringOpt(parsed, "platform"),
      });
      return;
    case "doctor":
      await runDoctor(io, { ...global, fix: boolOpt(parsed, "fix") });
      return;
    case "deploy":
      if (subcommand === "connect") {
        await runDeployConnect(io, {
          ...withSubcommand(global, "deploy connect"),
          platform: stringOpt(parsed, "platform"),
          environment: stringOpt(parsed, "environment"),
          manual: boolOpt(parsed, "manual"),
        });
        return;
      }
      if (subcommand === "status") {
        await runDeployStatus(io, {
          ...withSubcommand(global, "deploy status"),
          platform: stringOpt(parsed, "platform"),
          environment: stringOpt(parsed, "environment"),
          manual: boolOpt(parsed, "manual"),
        });
        return;
      }
      break;
    case "add":
      if (subcommand === "schema") {
        await runAddSchema(io, {
          ...withSubcommand(global, "add schema"),
          addField: multiOpt(parsed, "addField"),
          addFieldJson: multiOpt(parsed, "addFieldJson"),
          removeField: multiOpt(parsed, "removeField"),
          preset: multiOpt(parsed, "preset"),
        });
        return;
      }
      break;
    case "schema":
      if (subcommand === "add") {
        await runAddSchema(io, {
          ...withSubcommand(global, "schema add"),
          addField: multiOpt(parsed, "addField"),
          addFieldJson: multiOpt(parsed, "addFieldJson"),
          removeField: multiOpt(parsed, "removeField"),
          preset: multiOpt(parsed, "preset"),
        });
        return;
      }
      break;
    case "app": {
      const appGlobal = withSubcommand(global, `app ${subcommand ?? ""}`.trim());
      if (subcommand === "add") {
        await runAppAdd(io, {
          ...appGlobal,
          slug: stringOpt(parsed, "slug"),
          displayName: stringOpt(parsed, "displayName"),
          protocol: stringOpt(parsed, "protocol"),
          preset: stringOpt(parsed, "preset"),
          clientType: stringOpt(parsed, "clientType"),
          role: stringOpt(parsed, "role"),
          redirectUri: multiOpt(parsed, "redirectUri"),
          postLogoutRedirectUri: multiOpt(parsed, "postLogoutRedirectUri"),
          metadataUrl: stringOpt(parsed, "metadataUrl"),
          entityId: stringOpt(parsed, "entityId"),
          fromFile: stringOpt(parsed, "fromFile"),
        });
        return;
      }
      if (subcommand === "list") {
        await runAppList(io, appGlobal);
        return;
      }
      if (subcommand === "show") {
        await runAppShow(io, appGlobal, parsed.positionals[2]);
        return;
      }
      if (subcommand === "remove") {
        await runAppRemove(io, appGlobal, parsed.positionals[2]);
        return;
      }
      break;
    }
    case "capabilities":
      await runCapabilities(io, global);
      return;
    case "status":
      await runStatus(io, global);
      return;
    case "help":
      await runHelp(io, global, parsed.positionals.slice(1).join(" ") || undefined);
      return;
    case "eject":
    case "uninstall":
      await runEject(io, {
        ...withSubcommand(global, "eject"),
        force: boolOpt(parsed, "force") ?? global.force,
      });
      return;
  }

  throw new ZitadelError("E_VALIDATION", `Unknown command "${parsed.positionals.join(" ")}"`, {
    hint: "Run `zitadel help` to see available commands.",
    nextCommands: ["zitadel help"],
  });
}

async function setupOrSkipped(parsed: ParsedArgs, io: CliIO, global: GlobalOptions): Promise<void> {
  if (await hasPackageJsonWithNext(global.cwd)) {
    await runSetup(io, setupOptions(parsed, global));
    return;
  }
  skipped(
    io,
    "no-framework-detected",
    global,
    {
      cwd: global.cwd,
      detected: null,
    },
    ["zitadel help setup", "zitadel setup --framework next --cwd <path>"],
  );
}

async function hasPackageJsonWithNext(cwd: string): Promise<boolean> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try {
    const contents = await readFile(join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(contents) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    return Boolean(
      (pkg.dependencies && "next" in pkg.dependencies) ||
      (pkg.devDependencies && "next" in pkg.devDependencies),
    );
  } catch {
    return false;
  }
}

function setupOptions(parsed: ParsedArgs, global: GlobalOptions) {
  return {
    ...global,
    framework: stringOpt(parsed, "framework"),
    userFields: stringOpt(parsed, "userFields"),
    authMethod: stringOpt(parsed, "authMethod"),
    renderer: stringOpt(parsed, "renderer"),
    skipDeployPlatform: boolOpt(parsed, "skipDeployPlatform"),
    manualDeploy: boolOpt(parsed, "manual"),
    noApply: boolOpt(parsed, "noApply"),
    platform: stringOpt(parsed, "platform"),
  };
}

function withSubcommand(global: GlobalOptions, command: string): GlobalOptions {
  return { ...global, command };
}

async function buildGlobalOptions(parsed: ParsedArgs, io: CliIO): Promise<GlobalOptions> {
  const cwd = resolveCwd(typeof parsed.options.cwd === "string" ? parsed.options.cwd : undefined);
  const command = resolveCommandName(parsed);
  const environment = stringOpt(parsed, "environment") ?? "development";
  const serverFlag = typeof parsed.options.server === "string" ? parsed.options.server : undefined;

  const source = await resolveServer({
    cwd,
    env: io.env,
    serverFlag,
    environment,
  });

  const verbose = Boolean(parsed.options.verbose);
  const debug = Boolean(parsed.options.debug);
  consola.level = debug ? 4 : verbose ? 3 : 2;

  return {
    cwd,
    json: Boolean(parsed.options.json),
    nonInteractive:
      Boolean(parsed.options.nonInteractive) || !io.isTTY || Boolean(parsed.options.json),
    dryRun: Boolean(parsed.options.dryRun),
    force: Boolean(parsed.options.force),
    command,
    cliVersion: CLI_VERSION,
    source: source.value,
    serverFlag,
    verbose,
    debug,
  };
}

function fallbackMeta(parsed: ParsedArgs, io: CliIO): GlobalOptions {
  const cwd = resolveCwd(typeof parsed.options.cwd === "string" ? parsed.options.cwd : undefined);
  return {
    cwd,
    json: Boolean(parsed.options.json),
    nonInteractive:
      Boolean(parsed.options.nonInteractive) || !io.isTTY || Boolean(parsed.options.json),
    dryRun: Boolean(parsed.options.dryRun),
    force: Boolean(parsed.options.force),
    command: resolveCommandName(parsed),
    cliVersion: CLI_VERSION,
    source: DEFAULT_SERVER,
    verbose: Boolean(parsed.options.verbose),
    debug: Boolean(parsed.options.debug),
  };
}

function resolveCommandName(parsed: ParsedArgs): string {
  const [head, next] = parsed.positionals;
  if (!head) return "(default)";
  if (head === "deploy" && (next === "connect" || next === "status")) return `deploy ${next}`;
  if (head === "add" && next === "schema") return "add schema";
  if (head === "schema" && next === "add") return "schema add";
  if (
    head === "app" &&
    (next === "add" || next === "list" || next === "show" || next === "remove")
  ) {
    return `app ${next}`;
  }
  if (head === "help") return "help";
  return head;
}

function isVersionRequest(parsed: ParsedArgs): boolean {
  return Boolean(parsed.options.version) || parsed.positionals[0] === "--version";
}

function isHelpRequest(parsed: ParsedArgs): boolean {
  if (parsed.options.help) return true;
  return parsed.positionals[0] === "help";
}

type ParsedArgs = {
  positionals: string[];
  options: Record<string, string | boolean | string[]>;
};

const shortFlags: Record<string, string> = {
  c: "cwd",
  j: "json",
  n: "nonInteractive",
  f: "force",
  h: "help",
  v: "version",
  e: "environment",
  s: "server",
};

function parseArgs(argv: string[], _io: CliIO): ParsedArgs {
  const options: Record<string, string | boolean | string[]> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      break;
    }

    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }

    const isLong = arg.startsWith("--");
    const raw = isLong ? arg.slice(2) : arg.slice(1);
    const [rawKey = "", inlineValue] = raw.split("=", 2);
    const canonical = isLong ? toCamel(rawKey) : toCamel(shortFlags[rawKey] ?? rawKey);
    const next = argv[index + 1];
    const value =
      inlineValue !== undefined
        ? inlineValue
        : next && !next.startsWith("-")
          ? ((index += 1), next)
          : true;
    setOption(options, canonical, value);
  }

  return { positionals, options };
}

function setOption(
  options: Record<string, string | boolean | string[]>,
  key: string,
  value: string | boolean,
): void {
  const existing = options[key];
  if (existing === undefined) {
    options[key] = value;
  } else if (Array.isArray(existing)) {
    existing.push(String(value));
  } else {
    options[key] = [String(existing), String(value)];
  }
}

function stringOpt(parsed: ParsedArgs, key: string): string | undefined {
  const value = parsed.options[key];
  return typeof value === "string" ? value : undefined;
}

function boolOpt(parsed: ParsedArgs, key: string): boolean | undefined {
  return parsed.options[key] === undefined ? undefined : Boolean(parsed.options[key]);
}

function multiOpt(parsed: ParsedArgs, key: string): string[] {
  const value = parsed.options[key];
  if (!value) return [];
  return Array.isArray(value) ? value : [String(value)];
}

function toCamel(value: string): string {
  if (value.startsWith("no-")) {
    return `no${value.slice(3).replace(/(^|-)([a-z])/g, (_match, _dash, char: string) => char.toUpperCase())}`;
  }
  return value.replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
}
