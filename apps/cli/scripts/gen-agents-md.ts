import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { EXIT_CODES } from "../src/lib/errors";
import { COMMANDS, type CommandSpec, type FlagSpec } from "../src/commands/registry";
import { ENVELOPE_SCHEMA_VERSION } from "../src/commands/capabilities";

const here = dirname(fileURLToPath(import.meta.url));
const agentsTarget = join(here, "..", "AGENTS.md");
const BEGIN = "<!-- generated:capabilities:begin -->";
const END = "<!-- generated:capabilities:end -->";

async function main() {
  const generated = renderGeneratedBlock();
  await writeContract(agentsTarget, generated, handwrittenHeader());
}

function renderGeneratedBlock(): string {
  const lines: string[] = [BEGIN];
  lines.push("");
  lines.push(`Envelope schema version: \`${ENVELOPE_SCHEMA_VERSION}\`. Every envelope carries \`cli_version\`, \`command\`, \`source\` at the top level.`);
  lines.push("");
  lines.push("## Commands");
  lines.push("");
  lines.push("| Command | Summary | Agent status |");
  lines.push("|---|---|---|");
  for (const spec of COMMANDS) {
    lines.push(`| \`zitadel ${spec.name}\` | ${escapePipe(spec.summary)} | ${spec.agent_status} |`);
  }
  lines.push("");
  for (const spec of COMMANDS) {
    lines.push(renderCommand(spec));
    lines.push("");
  }
  lines.push("## Exit codes");
  lines.push("");
  lines.push("| Code | Error code(s) |");
  lines.push("|---:|---|");
  const reverse = new Map<number, string[]>();
  for (const [errorCode, exit] of Object.entries(EXIT_CODES)) {
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

function renderCommand(spec: CommandSpec): string {
  const lines: string[] = [];
  lines.push(`### \`zitadel ${spec.name}\``);
  lines.push("");
  lines.push(spec.summary);
  if (spec.notes) {
    lines.push("");
    lines.push(`> ${spec.notes}`);
  }
  lines.push("");
  lines.push(`Usage: \`${spec.usage}\``);
  lines.push("");
  lines.push("| Flag | Type | Description |");
  lines.push("|---|---|---|");
  for (const flag of spec.flags) {
    lines.push(`| ${flagToken(flag)} | \`${flag.type}\` | ${escapePipe(flag.description)} |`);
  }
  return lines.join("\n");
}

function flagToken(flag: FlagSpec): string {
  const parts = [`\`--${flag.name}\``];
  if (flag.alias) parts.push(`\`-${flag.alias}\``);
  return parts.join(" / ");
}

function escapePipe(value: string): string {
  return value.replace(/\|/g, "\\|");
}

async function writeContract(target: string, generated: string, header: string): Promise<void> {
  const existing = await readFile(target, "utf8").catch(() => "");
  const next = mergeGenerated(existing, generated, header);
  if (next === existing) return;
  await writeFile(target, next);
  process.stderr.write(`Wrote ${target}\n`);
}

function mergeGenerated(existing: string, generated: string, header: string): string {
  if (!existing) return `${header}\n\n${generated}\n`;
  if (existing.includes(BEGIN) && existing.includes(END)) {
    const after = existing.slice(existing.indexOf(END) + END.length);
    return `${header}\n\n${generated}${after}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }
  return `${header}\n\n${generated}\n`;
}

function handwrittenHeader(): string {
  return `# Zitadel CLI Agent Contract

Agents should run \`zitadel <command> --non-interactive --json\` and read the JSON envelope. The sections below are generated from the CLI registry at build time; do not edit them by hand.

## Required Agent Flags

\`\`\`sh
npx zitadel@latest <command> --non-interactive --json
\`\`\`

Use \`--cwd <path>\` when acting outside the current working directory. Discover commands and flags with:

\`\`\`sh
npx zitadel@latest capabilities --json
npx zitadel@latest help <command> --json
\`\`\`

Agents should prefer \`next_commands\` over free-text hints.

## Golden Path

The supported POC path is Next.js App Router setup, local mock/dev auth, config plan/apply, human claim handoff, claim-status refresh, and production apply after claim.

Setup creates \`zitadel.json\`, \`.zitadel/secret\`, schema/flow/locale resources under \`.zitadel/\`, browser-safe env metadata, and framework routes that mount \`ZitadelFlow\`. Project and preview secrets stay out of browser runtime.

## Claim Boundary

Agents do not claim projects. \`zitadel claim\` returns a human \`claim_url\`; after the human completes it, agents may run \`zitadel claim status --challenge-id <id>\` to refresh local claimed state.

## Renderer Direction

Generated routes use \`ZitadelFlow({ purpose, projectId, issuer, environment })\` so the future \`<zitadel-flow>\` web component can replace the React shim without changing the app-level contract.`;
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
