import type { Properties } from "../telemetry";
import { ciProvider, hostAgent, invocationChannel, isCi } from "../telemetry/env";
import { countryFromTimezone, osName } from "../telemetry/geo";
import type { GlobalOptions } from "./types";

/**
 * CLI-specific telemetry glue. This is the only place that knows how to turn a
 * {@link GlobalOptions} invocation into the property bags the generic
 * `Telemetry` client sends — keeping `lib/telemetry` free of any CLI coupling.
 */

/** Lifecycle event names. One pair of choke points in `BaseCommand` emits these. */
export const CLI_COMMAND_STARTED = "cli_command_started";
export const CLI_COMMAND_COMPLETED = "cli_command_completed";
export const CLI_COMMAND_FAILED = "cli_command_failed";

/** One-time notice shown on first run (interactive mode only). */
export const FIRST_RUN_NOTICE =
  "Zitadel CLI collects anonymous usage analytics to help improve the tool. " +
  "No personal data, project details, server URLs, or file contents are ever " +
  "collected. Opt out any time with DO_NOT_TRACK=1, ZITADEL_TELEMETRY=0, or " +
  "the --no-telemetry flag.";

/**
 * Coarse classification of the resolved platform `source`. We deliberately
 * never send the raw URL (it can carry an internal/self-hosted hostname) — only
 * which *kind* of backend the command targeted.
 */
export function serverKind(source: string): "cloud" | "local" | "self_hosted" | "unknown" {
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

/**
 * Build the dimensions shared by every lifecycle event from the invocation
 * context, merged with any per-command `extra`. This is the allow-list: only
 * enums, booleans, counts, and versions cross the boundary — never URLs,
 * project ids, file paths, emails, or secrets. `ip: 0` suppresses Mixpanel's
 * IP geolocation, and `$os`/`$country_code` populate the native columns
 * (country derived from the timezone, not the IP — so no city/region).
 */
export function commandEventProperties(
  meta: GlobalOptions,
  sessionId: string,
  extra: Properties = {},
): Properties {
  const { env } = meta;
  // `extra` is spread first so the canonical base dimensions below always win:
  // a command's per-event extras can never overwrite `command`, `cli_version`,
  // `session_id`, `server_kind`, etc. Callers order their own extras so reserved
  // lifecycle fields (status/duration_ms/…) win over free-form command props.
  return {
    ...extra,
    ip: 0,
    session_id: sessionId,
    command: meta.command,
    cli_version: meta.cliVersion,
    $os: osName(process.platform),
    $country_code: countryFromTimezone(),
    os: process.platform,
    arch: process.arch,
    node_version: process.versions.node,
    non_interactive: meta.nonInteractive,
    is_tty: meta.isTTY,
    is_ci: isCi(env),
    ci_provider: ciProvider(env),
    host_agent: hostAgent(env),
    invocation_channel: invocationChannel(env),
    dry_run: meta.dryRun,
    force: meta.force,
    server_kind: serverKind(meta.source),
  };
}

/**
 * Anonymous user-profile properties for this install, so the device shows up
 * under Mixpanel "Users". Only non-PII device facts; `$name` is a readable,
 * non-identifying label that falls back to the OS when the host agent is
 * unknown. `$ip` is passed separately as a modifier by the caller.
 */
export function deviceProfileProperties(meta: GlobalOptions, distinctId: string): Properties {
  const agent = hostAgent(meta.env);
  const label = agent === "unknown" ? process.platform : agent;
  return {
    $name: `${label} · ${distinctId.slice(0, 8)}`,
    $os: osName(process.platform),
    $country_code: countryFromTimezone(),
    os: process.platform,
    arch: process.arch,
    node_version: process.versions.node,
    cli_version: meta.cliVersion,
    host_agent: agent,
  };
}
