import type { CliIO, GlobalOptions } from "../io/output";
import { ok } from "../io/output";
import { EXIT_CODES } from "../lib/errors";
import { COMMANDS } from "./registry";

export const ENVELOPE_SCHEMA_VERSION = 1;

export async function runCapabilities(io: CliIO, opts: GlobalOptions): Promise<void> {
  ok(
    io,
    {
      title: "Zitadel CLI capabilities",
      envelope_schema_version: ENVELOPE_SCHEMA_VERSION,
      commands: COMMANDS.map((spec) => ({
        name: spec.name,
        summary: spec.summary,
        usage: spec.usage,
        agent_status: spec.agent_status,
        notes: spec.notes,
        flags: spec.flags.map((flag) => ({
          name: flag.name,
          alias: flag.alias,
          type: flag.type,
          description: flag.description,
          default: flag.default,
        })),
      })),
      exit_codes: EXIT_CODES,
      error_codes: Object.keys(EXIT_CODES),
      envelope_fields: ["status", "cli_version", "command", "source"],
      server_defaults: {
        default_server: "https://api.zitadel.cloud",
        mock_sentinel: "mock",
        precedence: ["--server flag", "ZITADEL_API_BASE env", "zitadel.json#environments.<env>.server", "zitadel.json#server", "default"],
      },
    },
    opts,
  );
}
