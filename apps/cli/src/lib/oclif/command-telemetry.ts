import type { Properties } from "../telemetry";
import { ciFlag, ciProvider, hostAgent, invocationChannel } from "../telemetry/env";
import { country, operatingSystem } from "../telemetry/geo";
import type { Property } from "../telemetry/property";
import type { GlobalOptions } from "./types";

/**
 * CLI-specific telemetry glue: the only place that turns a {@link GlobalOptions}
 * invocation into the property bags the generic `Telemetry` client sends,
 * keeping `lib/telemetry` free of CLI coupling.
 */

export const CLI_COMMAND_STARTED = "cli_command_started";
export const CLI_COMMAND_COMPLETED = "cli_command_completed";
export const CLI_COMMAND_FAILED = "cli_command_failed";

export const FIRST_RUN_NOTICE =
  "Zitadel CLI collects anonymous usage analytics to help improve the tool. " +
  "No personal data, project details, server URLs, or file contents are ever " +
  "collected. Opt out any time with DO_NOT_TRACK=1, ZITADEL_TELEMETRY=0, or " +
  "the --no-telemetry flag.";

/**
 * Buckets the resolved backend `source` into a coarse kind. The raw URL is never
 * emitted — it can carry an internal/self-hosted hostname — only which kind of
 * backend the command targeted.
 */
class ServerKind implements Property<string, "cloud" | "local" | "self_hosted" | "unknown"> {
  public value(source: string): "cloud" | "local" | "self_hosted" | "unknown" {
    if (source === "mock") {
      return "local";
    }
    try {
      const { hostname } = new URL(source);
      if (hostname.endsWith("zitadel.cloud")) {
        return "cloud";
      }
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
        return "local";
      }
      return "self_hosted";
    } catch {
      return "unknown";
    }
  }
}

export const serverKind = new ServerKind();

/**
 * Build the dimensions shared by every lifecycle event, merged with any
 * per-command `extra`. The allow-list: only enums, booleans, counts, and
 * versions cross the boundary — never URLs, project ids, file paths, emails, or
 * secrets. `extra` is spread first so the canonical base dimensions always win;
 * callers order their own extras so reserved lifecycle fields win over command
 * props.
 */
export function commandEventProperties(
  meta: GlobalOptions,
  sessionId: string,
  extra: Properties = {},
): Properties {
  const { env } = meta;
  return {
    ...extra,
    ip: 0,
    session_id: sessionId,
    command: meta.command,
    cli_version: meta.cliVersion,
    $os: operatingSystem.value(process.platform),
    $country_code: country.value(undefined),
    os: process.platform,
    arch: process.arch,
    node_version: process.versions.node,
    non_interactive: meta.nonInteractive,
    is_tty: meta.isTTY,
    is_ci: ciFlag.value(env),
    ci_provider: ciProvider.value(env),
    host_agent: hostAgent.value(env),
    invocation_channel: invocationChannel.value(env),
    dry_run: meta.dryRun,
    force: meta.force,
    server_kind: serverKind.value(meta.source),
  };
}

/**
 * Anonymous user-profile properties for this install, so the device appears
 * under Mixpanel "Users". Only non-PII device facts; `$name` is a readable,
 * non-identifying label that falls back to the OS when the host agent is
 * unknown. `$ip` is passed separately as a modifier by the caller.
 */
export function deviceProfileProperties(meta: GlobalOptions, distinctId: string): Properties {
  const agent = hostAgent.value(meta.env);
  const label = agent === "unknown" ? process.platform : agent;
  return {
    $name: `${label} · ${distinctId.slice(0, 8)}`,
    $os: operatingSystem.value(process.platform),
    $country_code: country.value(undefined),
    os: process.platform,
    arch: process.arch,
    node_version: process.versions.node,
    cli_version: meta.cliVersion,
    host_agent: agent,
  };
}
