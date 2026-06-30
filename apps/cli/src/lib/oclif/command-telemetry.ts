import type { Properties } from "../telemetry";
import { ciFlag } from "../telemetry/dimensions/ci-flag";
import { ciProvider } from "../telemetry/dimensions/ci-provider";
import { country } from "../telemetry/dimensions/country";
import { hostAgent } from "../telemetry/dimensions/host-agent";
import { invocationChannel } from "../telemetry/dimensions/invocation-channel";
import { operatingSystem } from "../telemetry/dimensions/operating-system";
import { serverKind } from "./server-kind";
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

type DeviceFacts = {
  readonly osLabel: string;
  readonly countryCode: string | undefined;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly nodeVersion: string;
  readonly cliVersion: string;
};

/**
 * Process-stable device facts shared by both the event bag and the user
 * profile, so the two never disagree on the same install's OS/arch/version.
 */
function deviceFacts(meta: GlobalOptions): DeviceFacts {
  return {
    osLabel: operatingSystem.value(process.platform),
    countryCode: country.value(undefined),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    cliVersion: meta.cliVersion,
  };
}

function eventDeviceProperties(meta: GlobalOptions): Properties {
  const facts = deviceFacts(meta);
  return {
    $os: facts.osLabel,
    mp_country_code: facts.countryCode,
    os: facts.platform,
    arch: facts.arch,
    node_version: facts.nodeVersion,
    cli_version: facts.cliVersion,
  };
}

function profileDeviceProperties(meta: GlobalOptions): Properties {
  const facts = deviceFacts(meta);
  return {
    $os: facts.osLabel,
    $country_code: facts.countryCode,
    os: facts.platform,
    arch: facts.arch,
    node_version: facts.nodeVersion,
    cli_version: facts.cliVersion,
  };
}

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
  invocationId: string,
  extra: Properties = {},
): Properties {
  const { env } = meta;
  return {
    ...extra,
    ...eventDeviceProperties(meta),
    ip: 0,
    invocation_id: invocationId,
    command: meta.command,
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
    ...profileDeviceProperties(meta),
    $name: `${label} · ${distinctId.slice(0, 8)}`,
    host_agent: agent,
  };
}
