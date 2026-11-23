import { type RuntimeKind, ZitadelRuntime } from "@/lib/server";
import type { Properties } from "@/lib/telemetry";
import { installedFromPackage, resolveChannel } from "@/lib/telemetry/config";
import { ciFlag } from "@/lib/telemetry/dimensions/ci-flag";
import { ciProvider } from "@/lib/telemetry/dimensions/ci-provider";
import { country } from "@/lib/telemetry/dimensions/country";
import { hostAgent } from "@/lib/telemetry/dimensions/host-agent";
import { invocationChannel } from "@/lib/telemetry/dimensions/invocation-channel";
import { operatingSystem } from "@/lib/telemetry/dimensions/operating-system";
import type { GlobalOptions } from "@/lib/oclif/types";

/**
 * CLI-specific telemetry glue: the only place that turns a {@link GlobalOptions}
 * invocation into the property bags the generic `Telemetry` client sends,
 * keeping `lib/telemetry` free of CLI coupling.
 */

export const CLI_COMMAND_STARTED = "cli_command_started";
export const CLI_COMMAND_COMPLETED = "cli_command_completed";
export const CLI_COMMAND_FAILED = "cli_command_failed";

/**
 * The properties the Vercel Web Analytics copy of a command's lifecycle events
 * keeps, in priority order, the header first: the intake takes 8. The
 * command's own headline ranks after `host_agent`, so on a failed run, where
 * `reason` fills the eighth place, it takes `non_interactive`'s.
 *
 * @param dimension - The one fact of its own the command keeps, if it has one.
 * @returns The property names the copy keeps.
 */
export function vercelEventKeys(dimension?: string): readonly string[] {
  return [
    "surface",
    "cli_version",
    "server_kind",
    "command",
    "status",
    "reason",
    "host_agent",
    ...(dimension === undefined ? [] : [dimension]),
    "non_interactive",
  ];
}

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

/**
 * The device facts of an event or of the install's profile, which name the
 * country differently (`mp_country_code` on an event, `$country_code` on the
 * profile).
 */
function deviceProperties(
  meta: GlobalOptions,
  countryKey: "mp_country_code" | "$country_code",
): Properties {
  const facts = deviceFacts(meta);
  return {
    $os: facts.osLabel,
    [countryKey]: facts.countryCode,
    os: facts.platform,
    arch: facts.arch,
    node_version: facts.nodeVersion,
    cli_version: facts.cliVersion,
  };
}

/**
 * Whether the CLI runs from an installed package, which cannot change within a
 * process.
 */
const INSTALL_SOURCE = installedFromPackage() ? "package" : "source";

/**
 * Build the dimensions shared by every lifecycle event, merged with any
 * per-command `extra`. They include the header every Zitadel component sends,
 * as `docs/product-analytics-events.yaml` defines it. The allow-list: only
 * enums, booleans, counts, and versions cross the boundary — never URLs,
 * project ids, file paths, emails, or secrets. `extra` is spread first so the
 * canonical base dimensions always win; callers order their own extras so
 * reserved lifecycle fields win over command props. `serverKind` is what kind
 * of server the run talked to (cloud, self-hosted, local), as the command's base
 * works it out from its address.
 */
export function commandEventProperties(
  meta: GlobalOptions,
  serverKind: RuntimeKind | "none",
  invocationId: string,
  extra: Properties = {},
): Properties {
  const { env } = meta;
  const host = hostAgent.value(env);
  return {
    ...extra,
    surface: "cli",
    environment: resolveChannel(env),
    install_source: INSTALL_SOURCE,
    ...deviceProperties(meta, "mp_country_code"),
    ip: 0,
    invocation_id: invocationId,
    command: meta.command,
    non_interactive: meta.nonInteractive,
    is_tty: meta.isTTY,
    is_ci: ciFlag.value(env),
    ci_provider: ciProvider.value(env),
    host_agent: host,
    is_agent: isAgent(host),
    invocation_channel: invocationChannel.value(env),
    dry_run: meta.dryRun,
    force: meta.force,
    server_kind: serverKind,
  };
}

/**
 * Whether a host is a coding agent: any the detector recognised, not an editor's
 * terminal or an unknown one. It says where the CLI ran, never who typed.
 *
 * @param host - The `host_agent` value.
 * @returns Whether it is a coding agent.
 */
function isAgent(host: string): boolean {
  return host !== "vscode" && host !== "unknown";
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
    ...deviceProperties(meta, "$country_code"),
    $name: `${label} · ${distinctId.slice(0, 8)}`,
    host_agent: agent,
    is_agent: isAgent(agent),
    invocation_channel: invocationChannel.value(meta.env),
    install_source: INSTALL_SOURCE,
  };
}

/**
 * What an install's profile says only once: the version it began on, which
 * lets a cohort ask who installed which version.
 *
 * @param version - The version the install began on, when it began on one that records it.
 * @returns The facts to write where the profile does not have them yet.
 */
export function firstSeenProperties(version?: string): Properties {
  if (version === undefined) {
    return {};
  }

  return { first_cli_version: version };
}

/**
 * The kind of server a run is about, or `none` for a command that talks to no
 * server and so has no address.
 *
 * @param source - The run's server address, empty when it names none.
 * @returns The kind.
 */
export function serverKindOf(source: string): RuntimeKind | "none" {
  return source === "" ? "none" : ZitadelRuntime.fromUrl(source).kind;
}
