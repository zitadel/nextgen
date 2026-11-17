import type { Properties } from "@/lib/telemetry";
import { ciFlag } from "@/lib/telemetry/dimensions/ci-flag";
import { ciProvider } from "@/lib/telemetry/dimensions/ci-provider";
import { country } from "@/lib/telemetry/dimensions/country";
import { hostAgent } from "@/lib/telemetry/dimensions/host-agent";
import { invocationChannel } from "@/lib/telemetry/dimensions/invocation-channel";
import { operatingSystem } from "@/lib/telemetry/dimensions/operating-system";
import { Server } from "@/lib/server";
import type { GlobalOptions } from "./types";

/**
 * CLI-specific telemetry glue: the only place that turns a {@link GlobalOptions}
 * invocation into the property bags the generic `Telemetry` client sends,
 * keeping `lib/telemetry` free of CLI coupling.
 */

export const CLI_COMMAND_STARTED = "cli_command_started";
export const CLI_COMMAND_COMPLETED = "cli_command_completed";
export const CLI_COMMAND_FAILED = "cli_command_failed";

export const ACTION_COMPLETED = "action_completed";
export const ACTION_FAILED = "action_failed";

/**
 * What a command's success or failure reports as an action event, by command
 * id. A command not listed reports none.
 */
export const COMMAND_ACTIONS: ReadonlyMap<string, Properties> = new Map<string, Properties>([
  ["user:create", { action: "create", resource_type: "user" }],
  ["user:update", { action: "update", resource_type: "user" }],
  ["user:delete", { action: "delete", resource_type: "user" }],
  ["team:create", { action: "create", resource_type: "team" }],
  ["team:update", { action: "update", resource_type: "team" }],
  ["team:deactivate", { action: "deactivate", resource_type: "team" }],
  ["grant:create", { action: "create", resource_type: "grant" }],
  ["grant:delete", { action: "delete", resource_type: "grant" }],
  ...(["password", "passkey", "sso"] as const).flatMap((method) => {
    return (["enable", "disable"] as const).map((action): [string, Properties] => {
      return [
        `auth-method:${method}:${action}`,
        { action, resource_type: "authentication_method", method, entry_point: "standalone" },
      ];
    });
  }),
  ["deploy", { action: "deploy", resource_type: "deployment" }],
  ["deployment:create", { action: "redeploy", resource_type: "deployment" }],
  ["deployment:rollback", { action: "rollback", resource_type: "deployment" }],
]);

/**
 * The dimensions a command records that an action event carries too.
 */
const ACTION_DIMENSIONS = [
  "access_level",
  "test_mode",
  "test_result",
  "changed_configuration_types",
  "stage",
] as const;

/**
 * The properties of the action event a command's outcome reports, or
 * `undefined` when the command reports none.
 *
 * @param command - The command id.
 * @param recorded - What the command recorded as it ran.
 * @param outcome - What the outcome adds: its duration, and its error code when it failed.
 * @returns The event's own properties, before the run's common ones.
 */
export function actionProperties(
  command: string,
  recorded: Properties,
  outcome: Properties,
): Properties | undefined {
  const action = COMMAND_ACTIONS.get(command);
  if (action === undefined) {
    return undefined;
  }
  const dimensions = Object.fromEntries(
    ACTION_DIMENSIONS.map((name) => {
      return [name, recorded[name]];
    }),
  );
  return { ...dimensions, ...action, ...outcome };
}

/**
 * The one dimension of its own a command's Vercel Web Analytics copy keeps, by
 * command id; the rest go to Mixpanel only.
 */
export const VERCEL_COMMAND_DIMENSIONS: ReadonlyMap<string, string> = new Map([
  ["setup", "framework"],
  ["claim", "claim_outcome"],
  ["doctor", "failed_checks"],
  ["api", "operation"],
  ["start", "runtime"],
]);

/**
 * The properties the Vercel Web Analytics copy of `command`'s lifecycle events
 * keeps, in priority order, the header first: the intake takes 8. The
 * command's own dimension ranks after `host_agent`, so on a failed run, where
 * `reason` fills the eighth place, it takes `non_interactive`'s.
 */
export function vercelEventKeys(command: string): readonly string[] {
  const dimension = VERCEL_COMMAND_DIMENSIONS.get(command);
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
 * per-command `extra`. They include the header every Zitadel component sends,
 * as `docs/product-analytics-events.yaml` defines it. The allow-list: only
 * enums, booleans, counts, and versions cross the boundary — never URLs,
 * project ids, file paths, emails, or secrets. `extra` is spread first so the
 * canonical base dimensions always win; callers order their own extras so
 * reserved lifecycle fields win over command props.
 */
export function commandEventProperties(
  meta: GlobalOptions,
  invocationId: string,
  extra: Properties = {},
): Properties {
  const { env } = meta;
  return {
    ...extra,
    surface: "cli",
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
    server_kind: Server.at(meta.source).kind,
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
