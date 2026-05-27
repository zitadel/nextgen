import type { CliIO, GlobalOptions } from "../io/output";
import { ok } from "../io/output";
import { EXIT_CODES } from "../lib/errors";
import { listRenderers } from "../renderers/registry";
import {
  KNOWN_FIELD_ANNOTATIONS,
  KNOWN_MFA_VALUES,
  KNOWN_UNIQUE_VALUES,
  KNOWN_VERIFY_VALUES,
} from "../schema/annotations";
import { listNamedPresets } from "../schema/default";
import { BANNED_ATTRIBUTE_PREFIX, BANNED_FILTERS, BANNED_TAGS } from "../templates/validate";
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
        agent: agentSupport(spec.agent_status),
        mock_behavior: mockBehavior(spec.agent_status),
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
        precedence: [
          "--server flag",
          "ZITADEL_API_BASE env",
          "zitadel.json#environments.<env>.server",
          "zitadel.json#server",
          "default",
        ],
      },
      resource_directories: [
        { kind: "schema", dir: ".zitadel/schemas" },
        { kind: "flow-definition", dir: ".zitadel/flows" },
        { kind: "template", dir: ".zitadel/templates" },
        { kind: "idp", dir: ".zitadel/idps" },
        { kind: "app", dir: ".zitadel/apps" },
      ],
      renderers: listRenderers(),
      template_security: {
        banned_filters: BANNED_FILTERS,
        banned_tags: BANNED_TAGS,
        banned_attribute_prefix: BANNED_ATTRIBUTE_PREFIX,
      },
      schema_vocabulary: {
        field_annotations: KNOWN_FIELD_ANNOTATIONS,
        x_verify_values: KNOWN_VERIFY_VALUES,
        x_mfa_values: KNOWN_MFA_VALUES,
        x_unique_values: KNOWN_UNIQUE_VALUES,
        presets: listNamedPresets(),
      },
    },
    opts,
  );
}

function agentSupport(status: string): "supported" | "experimental" | "unsupported" {
  if (status === "experimental") return "experimental";
  if (status.startsWith("supported")) return "supported";
  return "unsupported";
}

function mockBehavior(status: string): "complete" | "partial" | "none" {
  if (status === "supported-mock-default") return "partial";
  if (status === "supported") return "none";
  return "none";
}
