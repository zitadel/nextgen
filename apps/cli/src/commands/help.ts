import type { CliIO, GlobalOptions } from "../io/output";
import { ok, writePretty } from "../io/output";
import { CLI_VERSION } from "../lib/version";
import { COMMANDS, findCommandSpec } from "./registry";

export async function runHelp(io: CliIO, opts: GlobalOptions, target?: string): Promise<void> {
  if (target) {
    return renderCommandHelp(io, opts, target);
  }
  return renderRootHelp(io, opts);
}

async function renderRootHelp(io: CliIO, opts: GlobalOptions): Promise<void> {
  if (opts.json) {
    ok(
      io,
      {
        title: "Zitadel CLI help",
        cli_version: CLI_VERSION,
        commands: COMMANDS.map((spec) => ({
          name: spec.name,
          summary: spec.summary,
          usage: spec.usage,
          agent_status: spec.agent_status,
          notes: spec.notes,
        })),
      },
      opts,
    );
    return;
  }

  writePretty(io, `zitadel ${CLI_VERSION}`);
  writePretty(io, "Agent-friendly Zitadel CLI. Ships JSON envelopes for agents and pretty output for humans.");
  writePretty(io, "");
  writePretty(io, "Usage: zitadel <command> [flags]");
  writePretty(io, "");
  writePretty(io, "Commands:");
  const width = Math.max(...COMMANDS.map((spec) => spec.name.length));
  for (const spec of COMMANDS) {
    writePretty(io, `  ${spec.name.padEnd(width)}  ${spec.summary}`);
  }
  writePretty(io, "");
  writePretty(io, "Flags are documented per command. Run `zitadel help <command>` for details.");
  writePretty(io, "Agents: run `zitadel capabilities --json` to introspect the full contract.");
}

async function renderCommandHelp(io: CliIO, opts: GlobalOptions, target: string): Promise<void> {
  const spec = findCommandSpec(target);
  if (!spec) {
    if (opts.json) {
      ok(io, { title: "unknown-command", target, commands: COMMANDS.map((command) => command.name) }, opts);
      return;
    }
    writePretty(io, `Unknown command "${target}". Run \`zitadel help\`.`);
    return;
  }

  if (opts.json) {
    ok(
      io,
      {
        title: `Help: zitadel ${spec.name}`,
        command: {
          name: spec.name,
          summary: spec.summary,
          usage: spec.usage,
          agent_status: spec.agent_status,
          notes: spec.notes,
          flags: spec.flags,
        },
      },
      opts,
    );
    return;
  }

  writePretty(io, `zitadel ${spec.name}`);
  writePretty(io, spec.summary);
  writePretty(io, "");
  writePretty(io, `Usage: ${spec.usage}`);
  if (spec.notes) {
    writePretty(io, "");
    writePretty(io, `Note: ${spec.notes}`);
  }
  writePretty(io, "");
  writePretty(io, "Flags:");
  const flagWidth = Math.max(...spec.flags.map((flag) => flagDisplay(flag).length));
  for (const flag of spec.flags) {
    const display = flagDisplay(flag);
    writePretty(io, `  ${display.padEnd(flagWidth)}  ${flag.description}`);
  }
}

function flagDisplay(flag: { name: string; alias?: string; type: string }): string {
  const base = flag.alias ? `-${flag.alias}, --${flag.name}` : `--${flag.name}`;
  if (flag.type === "boolean") return base;
  if (flag.type === "string[]") return `${base} <value>`;
  return `${base} <value>`;
}
