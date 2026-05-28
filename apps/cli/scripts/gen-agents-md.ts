import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Config, type Command } from "@oclif/core";

import { EXIT_CODES } from "../src/lib/errors";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const agentsTarget = join(root, "AGENTS.md");
const PKG_NAME = "@zitadel-nextgen/cli";
const BEGIN = "<!-- generated:contract:begin -->";
const END = "<!-- generated:contract:end -->";

/**
 * Golden-path ordering for the commands table. Anything not listed here is
 * appended alphabetically, so adding a command never breaks generation — it
 * just lands at the end until someone slots it into the intended order.
 */
const COMMAND_ORDER = ["setup", "plan", "apply", "doctor", "status", "eject"];

async function main(): Promise<void> {
  const config = await Config.load(root);
  const commands = ourCommands(config);
  const generated = renderGeneratedBlock(commands);
  await writeContract(agentsTarget, generated, handwrittenHeader());
}

/**
 * The CLI's own commands, with alias entries (e.g. `uninstall` for `eject`) and
 * hidden commands removed, sorted by the golden path. oclif surfaces each alias
 * as its own loadable, so we drop any command whose id is another command's
 * alias to avoid listing the same command twice.
 */
function ourCommands(config: Config): Command.Loadable[] {
  const mine = config.commands.filter((c) => c.pluginName === PKG_NAME && !c.hidden);
  const aliases = new Set(mine.flatMap((c) => c.aliases));
  const canonical = mine.filter((c) => !aliases.has(c.id));
  return canonical.sort((a, b) => {
    const ai = COMMAND_ORDER.indexOf(a.id);
    const bi = COMMAND_ORDER.indexOf(b.id);
    if (ai === -1 && bi === -1) {
      return a.id.localeCompare(b.id);
    }
    if (ai === -1) {
      return 1;
    }
    if (bi === -1) {
      return -1;
    }
    return ai - bi;
  });
}

function renderGeneratedBlock(commands: Command.Loadable[]): string {
  const lines: string[] = [BEGIN];
  lines.push("");
  lines.push("Every envelope carries `cli_version`, `command`, `source` at the top level.");
  lines.push("");
  lines.push("## Commands");
  lines.push("");
  lines.push("| Command | Summary |");
  lines.push("|---|---|");
  for (const command of commands) {
    lines.push(`| \`zitadel ${command.id}\` | ${escapePipe(summaryOf(command))} |`);
  }
  lines.push("");
  for (const command of commands) {
    lines.push(renderCommand(command));
    lines.push("");
  }
  lines.push("## Exit codes");
  lines.push("");
  lines.push("| Code | Error code(s) |");
  lines.push("|---:|---|");
  const reverse = new Map<number, string[]>();
  for (const [errorCode, exit] of Object.entries(EXIT_CODES) as Array<[string, number]>) {
    const list = reverse.get(exit) ?? [];
    list.push(errorCode);
    reverse.set(exit, list);
  }
  for (const [exit, codes] of [...reverse.entries()].sort(([a], [b]) => a - b)) {
    lines.push(`| ${exit} | ${codes.map((c) => `\`${c}\``).join(", ")} |`);
  }
  lines.push("");
  lines.push("## Server resolution");
  lines.push("");
  lines.push("Precedence (highest wins):");
  lines.push("");
  lines.push("1. `--server <url|mock>` flag");
  lines.push("2. `ZITADEL_API_BASE` env var");
  lines.push("3. `zitadel.json#environments.<env>.server`");
  lines.push("4. `zitadel.json#server`");
  lines.push("5. Default: `https://api.zitadel.cloud`");
  lines.push("");
  lines.push("The envelope `source` reports the resolved value (a URL or the literal `mock`).");
  lines.push("");
  lines.push(END);
  return lines.join("\n");
}

function renderCommand(command: Command.Loadable): string {
  const lines: string[] = [];
  lines.push(`### \`zitadel ${command.id}\``);
  lines.push("");
  lines.push(summaryOf(command));
  if (command.aliases.length > 0) {
    lines.push("");
    lines.push(`Aliases: ${command.aliases.map((a) => `\`zitadel ${a}\``).join(", ")}`);
  }
  lines.push("");
  lines.push("| Flag | Type | Description |");
  lines.push("|---|---|---|");
  for (const flag of sortedFlags(command)) {
    lines.push(
      `| ${flagToken(flag)} | \`${flagType(flag)}\` | ${escapePipe(flag.description ?? "")} |`,
    );
  }
  return lines.join("\n");
}

function summaryOf(command: Command.Loadable): string {
  return command.summary ?? command.description ?? "";
}

/**
 * Visible flags for a command, alphabetised by long name. Hidden flags are
 * dropped so the contract only documents the public surface.
 */
function sortedFlags(command: Command.Loadable): Command.Flag.Cached[] {
  return Object.values(command.flags)
    .filter((flag) => !flag.hidden)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function flagType(flag: Command.Flag.Cached): string {
  if (flag.type === "boolean") {
    return "boolean";
  }
  return flag.multiple ? "string[]" : "string";
}

function flagToken(flag: Command.Flag.Cached): string {
  const parts = [`\`--${flag.name}\``];
  if (flag.char) {
    parts.push(`\`-${flag.char}\``);
  }
  return parts.join(" / ");
}

function escapePipe(value: string): string {
  return value.replace(/\|/g, "\\|");
}

async function writeContract(target: string, generated: string, header: string): Promise<void> {
  const existing = await readFile(target, "utf8").catch(() => "");
  const next = mergeGenerated(existing, generated, header);
  if (next === existing) {
    return;
  }
  await writeFile(target, next);
  process.stderr.write(`Wrote ${target}\n`);
}

function mergeGenerated(existing: string, generated: string, header: string): string {
  if (!existing) {
    return `${header}\n\n${generated}\n`;
  }
  if (existing.includes(BEGIN) && existing.includes(END)) {
    const after = existing.slice(existing.indexOf(END) + END.length);
    return `${header}\n\n${generated}${after}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }
  return `${header}\n\n${generated}\n`;
}

function handwrittenHeader(): string {
  return `# Zitadel CLI Agent Contract

Agents should run \`zitadel <command> --non-interactive --json\` and read the JSON envelope. This file is generated by \`apps/cli/scripts/gen-agents-md.ts\` from the oclif command metadata; do not edit it by hand.

## Required Agent Flags

\`\`\`sh
npx zitadel@latest <command> --non-interactive --json
\`\`\`

Use \`--cwd <path>\` when acting outside the current working directory. Discover commands and flags with:

\`\`\`sh
npx zitadel@latest --help
npx zitadel@latest <command> --help
\`\`\`

Agents should prefer \`next_commands\` over free-text hints.

## Maintainer Notes

This file is packaged with the CLI and is generated from the oclif command metadata. When changing commands, flags, envelope fields, server resolution, or renderer behavior, update the command classes and tests first, then run \`corepack pnpm nx run @zitadel-nextgen/cli:gen:agents-md\`.

Do not edit the generated contract block in this file by hand.

## Golden Path

The supported POC path is Next.js App Router setup, local mock/dev auth, and config plan/apply.

Setup creates \`zitadel.json\`, \`.zitadel/secret\`, schema and flow resources under \`.zitadel/\`, browser-safe env metadata, and framework routes that mount \`ZitadelFlow\`. Project and preview secrets stay out of browser runtime.

## Renderer Direction

Generated routes use \`ZitadelFlow({ purpose, projectId, issuer, environment })\` so the future \`<zitadel-flow>\` web component can replace the React shim without changing the app-level contract.

## CLI vs. Runtime API

This CLI manages the dev-owned shape of a Zitadel deployment: schemas and flows. For per-customer-org configuration (e.g. a B2B customer's own SSO), end-user CRUD, or any unbounded set, route to the runtime Admin/Org API instead — not \`zitadel\` commands or \`.zitadel/\` files. Subordinate config (claim mappings, redirect URIs, role bindings) lives wherever its parent resource lives. See \`docs/design/cli/README.md\` § *What lives in \`.zitadel/\`* for the ownership rule and the resource-by-resource split.`;
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
