import { Flags } from "@oclif/core";
import consola from "consola";

import { claimAction, claimCommand, claimWindowClosedAction } from "../../lib/claim-state";
import { ZitadelError } from "../../lib/errors";
import { assertServerPackageAvailable } from "../../lib/local-server/binary";
import { dockerAvailable, imageAvailable } from "../../lib/local-server/docker";
import {
  dockerRuntimeGuidance,
  dockerUnavailableMessage,
} from "../../lib/local-server/docker-guidance";
import {
  discoverManagedRuntimeProcesses,
  type ManagedRuntimeProcess,
} from "../../lib/local-server/processes";
import {
  DEFAULT_LOCAL_SERVER_PORT,
  assertLocalStateWritable,
  checkLocalServerHealth,
  defaultLocalServerImageForCliVersion,
  localServerUrl,
  readRuntimeMetadata,
  type RuntimeBackend,
  type RuntimeMetadata,
} from "../../lib/local-server/runtime";
import { BaseCommand, type JsonEnvelope } from "../../lib/oclif";
import { createOrca } from "../../lib/orca";
import { hasZitadelConfig } from "../../lib/project";
import { listenersForPort } from "../../lib/prober/ports";
import { publicCliCommand } from "../../lib/public-cli";
import { SANITY_CHECKS, type CheckContext, type CheckOutcome } from "./checks";

const LOCAL_RUNTIME_CHECK_NAMES = new Set([
  "server-binary",
  "docker-cli",
  "image",
  "state-dir",
  "port",
  "runtime",
]);

/**
 * `zitadel doctor` — verify generated files and local state.
 *
 * Runs every registered {@link SANITY_CHECKS} entry and emits the aggregate
 * result; if any check fails it throws `E_VALIDATION` carrying the full check
 * details. With `--fix`, each check that did not pass — failed or warned —
 * first attempts its own repair (a no-op for checks with no safe automatic
 * remedy), then the battery re-runs.
 *
 * The `--fix` loop is best-effort: a repair that throws (e.g. a missing
 * prerequisite file the check itself would also flag) is logged at debug
 * level and skipped, not propagated — the post-fix re-verify still reports
 * whatever remains broken.
 */
export default class Doctor extends BaseCommand {
  static override description = "Verify local runtime and project state.";
  static override flags = {
    fix: Flags.boolean({ description: "Repair missing files and stale managed wiring." }),
    image: Flags.string({ description: "Container image to check." }),
    port: Flags.integer({ description: "Local HTTP port.", default: DEFAULT_LOCAL_SERVER_PORT }),
    runtime: Flags.string({
      description: "Local runtime backend.",
      options: ["binary", "docker"],
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Doctor);
    const port = flags.port ?? DEFAULT_LOCAL_SERVER_PORT;
    await this.toMeta(flags, { resolveServer: false, source: localServerUrl(port) });
    const { cwd, dryRun } = this.meta;
    const existingRuntime = await readRuntimeMetadata(cwd);
    const runtimeBackend = resolveRuntimeBackend({
      runtime: flags.runtime,
      image: flags.image,
      envImage: this.meta.env.ZITADEL_LOCAL_IMAGE,
      existingRuntime,
    });
    const image =
      flags.image ??
      this.meta.env.ZITADEL_LOCAL_IMAGE ??
      defaultLocalServerImageForCliVersion(this.meta.cliVersion);
    const runtimeChecks = await runLocalRuntimeChecks(cwd, runtimeBackend, image, port);
    const hasConfig = await hasZitadelConfig(cwd);
    const ctx: CheckContext = { cwd, orca: createOrca(), cliVersion: this.meta.cliVersion, dryRun };

    if (hasConfig && flags.fix) {
      const before = await Promise.all(SANITY_CHECKS.map((check) => check.run(ctx)));
      for (const [index, check] of SANITY_CHECKS.entries()) {
        // Repair warn-level drift too (e.g. a deleted presentation page):
        // fixes are restore-missing-only, so running one on a warning is safe.
        if (before[index]?.status === "pass") {
          continue;
        }
        try {
          await check.fix(ctx);
        } catch (error) {
          consola.debug(`doctor --fix: ${check.name} repair failed`, error);
        }
      }
    }

    const projectChecks = hasConfig
      ? await Promise.all(SANITY_CHECKS.map((check) => check.run(ctx)))
      : [];
    const checks = [...runtimeChecks, ...projectChecks];
    const failed = checks.filter((check) => check.status === "fail");
    const warnings = checks.filter((check) => check.status === "warn");
    const warningAdvice = advisoryForWarnings(warnings, this.meta.cliVersion);
    this.recordTelemetry({
      runtime: runtimeBackend,
      checks_total: checks.length,
      checks_failed: failed.length,
      checks_warn: warnings.length,
      failed_checks: failed.length > 0 ? failed.map((check) => check.name).join(",") : undefined,
    });
    const data = {
      title:
        failed.length > 0
          ? "Zitadel doctor found issues."
          : warnings.length > 0
            ? "Zitadel doctor passed with warnings."
            : "Zitadel doctor passed.",
      ok: failed.length === 0,
      runtime: runtimeBackend,
      ...(runtimeBackend === "docker" ? { image } : {}),
      port,
      project: {
        lifecycle: hasConfig ? "configured" : "not-configured",
      },
      checks,
      ...(warningAdvice
        ? {
            next_actions: warningAdvice.nextActions,
            next_commands: warningAdvice.nextCommands,
          }
        : {}),
    };

    if (failed.length > 0) {
      const advice = failureAdvice(failed, image, port, this.meta.cliVersion);
      // A check that failed with a typed CLI error advertises its own
      // category (e.g. the framework floor's E_UNSUPPORTED_PROJECT_SHAPE) —
      // surface that instead of the generic validation class so agents can
      // branch on it. The port check keeps its dedicated code first.
      const code = failed.some((check) => check.name === "port")
        ? "E_PORT_IN_USE"
        : (failed.find((check) => check.code !== undefined)?.code ?? "E_VALIDATION");
      throw new ZitadelError(code, "Zitadel doctor found issues", {
        hint: advice.hint,
        nextCommands: advice.nextCommands,
        details: data,
      });
    }

    return this.emit({
      status: "ok",
      data,
      warnings: warnings.map((warning) => `${warning.name}: ${warning.message}`),
    });
  }
}

function failureAdvice(
  failed: CheckOutcome[],
  image: string,
  port: number,
  cliVersion: string,
): { hint: string; nextCommands: string[] } {
  const failedNames = new Set(failed.map((check) => check.name));

  if (failedNames.has("server-binary")) {
    return {
      hint: "The Zitadel server npm package is not available. Reinstall the CLI package, then retry.",
      nextCommands: [publicCliCommand("doctor", cliVersion)],
    };
  }

  if (failedNames.has("docker-cli")) {
    const advice = dockerRuntimeGuidance("doctor", cliVersion);
    return {
      hint: advice.hint,
      nextCommands: advice.nextCommands,
    };
  }

  if (failedNames.has("image")) {
    return {
      hint: "The local Zitadel image is not available. Check Docker registry access, build it locally, or pass --image / ZITADEL_LOCAL_IMAGE.",
      nextCommands: [`docker pull ${image}`, publicCliCommand("doctor", cliVersion)],
    };
  }

  if (failedNames.has("state-dir")) {
    return {
      hint: "The local Zitadel state directory is not writable. Fix directory permissions, then rerun `zitadel doctor`.",
      nextCommands: [publicCliCommand("doctor", cliVersion)],
    };
  }

  if (failedNames.has("port")) {
    const fallbackPort = port === DEFAULT_LOCAL_SERVER_PORT ? port + 1 : DEFAULT_LOCAL_SERVER_PORT;
    const stopCommand = publicCliCommand("stop --all", cliVersion);
    const retryCommand = publicCliCommand("doctor", cliVersion);
    const alternatePortCommand = publicCliCommand(
      `doctor --port ${String(fallbackPort)}`,
      cliVersion,
    );
    return {
      hint:
        `Port ${String(port)} is already in use. Stop the process using it, ` +
        `run \`${stopCommand}\` for CLI-managed local runtimes, then rerun ` +
        `\`${retryCommand}\`; or choose another port with \`${alternatePortCommand}\`.`,
      nextCommands: [stopCommand, retryCommand, alternatePortCommand],
    };
  }

  if (failedNames.has("runtime")) {
    return {
      hint: "Existing local runtime metadata was found, but the local Zitadel server is not healthy. Start it again or reset stale local data.",
      nextCommands: [
        publicCliCommand("start", cliVersion),
        publicCliCommand("reset --force", cliVersion),
      ],
    };
  }

  // A failure that surfaced as a typed CLI error carries its own remedy —
  // e.g. the framework floor's upgrade hint. That beats the generic --fix
  // advice below, which cannot repair an unsupported version.
  const typed = failed.find((check) => check.code !== undefined && check.hint !== undefined);
  if (typed?.hint !== undefined) {
    return { hint: typed.hint, nextCommands: [publicCliCommand("doctor", cliVersion)] };
  }

  const hasProjectFailure = failed.some((check) => !LOCAL_RUNTIME_CHECK_NAMES.has(check.name));
  if (hasProjectFailure) {
    return {
      hint: `Run \`${publicCliCommand("doctor --fix", cliVersion)}\` to re-apply missing managed files.`,
      nextCommands: [publicCliCommand("doctor --fix", cliVersion)],
    };
  }

  return {
    hint: "Fix the reported checks, then rerun `zitadel doctor`.",
    nextCommands: [publicCliCommand("doctor", cliVersion)],
  };
}

function advisoryForWarnings(
  warnings: CheckOutcome[],
  cliVersion: string,
): { nextActions: string[]; nextCommands: string[] } | undefined {
  const nextActions: string[] = [];
  const nextCommands: string[] = [];
  if (warnings.some((check) => check.name === "docker-cli")) {
    const advice = dockerRuntimeGuidance("doctor", cliVersion);
    nextActions.push(...advice.nextActions);
    nextCommands.push(...advice.nextCommands);
  }

  const claimWarning = warnings.find((check) => check.name === "claim");
  if (claimWarning) {
    // The check classified the window (details.claimable). Once it looks
    // closed the advisory switches to reconciliation wording, but the claim
    // command stays suggested either way: the local record can be stale
    // (claimed from another machine reads detached), and the server checks
    // the grant before the window, so running claim is safe and answers
    // authoritatively.
    nextActions.push(
      claimWindowClosed(claimWarning) ? claimWindowClosedAction(cliVersion) : claimAction(cliVersion),
    );
    nextCommands.push(claimCommand(cliVersion));
  }

  const managedRuntimeWarning = warnings.find((check) => check.name === "managed-runtime-processes");
  if (hasManagedRuntimeProcesses(managedRuntimeWarning)) {
    nextActions.push(
      "Review other host-wide CLI-managed local Zitadel runtimes before starting a new one.",
    );
    nextCommands.push(publicCliCommand("stop --all", cliVersion));
  }

  const dependencyRemedy = remedyCommandOf(
    warnings.find((check) => check.name === "dependency-version"),
  );
  if (dependencyRemedy !== undefined) {
    nextActions.push(
      "Align the exactly-pinned @zitadel/* dependencies with the CLI version; scaffolded files and guidance target the CLI's train.",
    );
    nextCommands.push(dependencyRemedy);
  }

  if (nextActions.length === 0 && nextCommands.length === 0) {
    return undefined;
  }
  return { nextActions: unique(nextActions), nextCommands: unique(nextCommands) };
}

async function runLocalRuntimeChecks(
  cwd: string,
  runtimeBackend: RuntimeBackend,
  image: string,
  port: number,
): Promise<CheckOutcome[]> {
  const runtime = await readRuntimeMetadata(cwd);
  const managedRuntimeCheck = await checkManagedRuntimeProcesses(runtime);
  if (runtimeBackend === "binary") {
    return [
      await check("server-binary", "Server npm package is available", async () => {
        const version = await assertServerPackageAvailable();
        return `@zitadel/server ${version} is available`;
      }),
      await check(
        "state-dir",
        "Local state directory is writable",
        async () => {
          const probe = await assertLocalStateWritable(cwd);
          return probe.checkedPath === probe.targetPath
            ? `${probe.targetPath} is writable`
            : `${probe.targetPath} can be created (${probe.checkedPath} is writable)`;
        },
        "warn",
      ),
      await check(
        "port",
        `Port ${String(port)} is available`,
        () => checkPortAvailability(runtime, port),
      ),
      await checkRuntime(runtime, runtimeBackend),
      managedRuntimeCheck,
    ];
  }

  const docker = await check(
    "docker-cli",
    "Docker is reachable",
    async () => {
      let result: Awaited<ReturnType<typeof dockerAvailable>>;
      try {
        result = await dockerAvailable();
      } catch (error) {
        throw new Error(dockerUnavailableMessage(error), { cause: error });
      }
      if (result.status !== 0) {
        throw new Error(dockerUnavailableMessage(result.stderr || "docker version failed"));
      }
      return `Docker engine ${result.stdout.trim() || "available"}`;
    },
    "warn",
  );

  const imageCheck =
    docker.status === "pass"
      ? await check(
          "image",
          `Image ${image} is available`,
          async () => {
            try {
              const source = await imageAvailable(image);
              return source === "local"
                ? `Image ${image} is available locally`
                : `Image ${image} is available from the registry`;
            } catch (error) {
              throw new Error(imageUnavailableMessage(image, error), { cause: error });
            }
          },
          "warn",
        )
      : ({
          name: "image",
          status: "warn",
          message: "Skipped image check because Docker is not reachable.",
        } satisfies CheckOutcome);

  return [
    docker,
    imageCheck,
    await check(
      "state-dir",
      "Local state directory is writable",
      async () => {
        const probe = await assertLocalStateWritable(cwd);
        return probe.checkedPath === probe.targetPath
          ? `${probe.targetPath} is writable`
          : `${probe.targetPath} can be created (${probe.checkedPath} is writable)`;
      },
      "warn",
    ),
    await check(
      "port",
      `Port ${String(port)} is available`,
      () => checkPortAvailability(runtime, port),
    ),
    await checkRuntime(runtime, runtimeBackend),
    managedRuntimeCheck,
  ];
}

async function checkPortAvailability(
  runtime: RuntimeMetadata | undefined,
  port: number,
): Promise<string> {
  if (runtime?.port === port && (await checkLocalServerHealth(runtime.server_url))) {
    return `${runtime.server_url} is already healthy`;
  }
  const listeners = await listenersForPort(port);
  if (listeners.length > 0) {
    throw new PortInUseCheckError(port, localServerUrl(port), listeners);
  }
  return `Port ${String(port)} is available`;
}

class PortInUseCheckError extends Error {
  constructor(
    readonly port: number,
    readonly serverUrl: string,
    readonly listeners: Awaited<ReturnType<typeof listenersForPort>>,
  ) {
    super(`Port ${String(port)} is already in use by ${formatListeners(listeners)}`);
  }
}

async function checkManagedRuntimeProcesses(
  runtime: RuntimeMetadata | undefined,
): Promise<CheckOutcome> {
  const discovery = await discoverManagedRuntimeProcesses();
  if (!discovery.supported) {
    return {
      name: "managed-runtime-processes",
      status: "warn",
      message: "Managed local runtime process discovery is unavailable.",
      details: { supported: false, error: discovery.error },
    };
  }
  const processes = additionalManagedRuntimeProcesses(discovery.processes, runtime);
  if (processes.length === 0) {
    return {
      name: "managed-runtime-processes",
      status: "pass",
      message: "No additional host-wide managed local runtime processes found.",
      details: { supported: true, scope: "host", processes: [] },
    };
  }
  return {
    name: "managed-runtime-processes",
    status: "warn",
    message: `${String(processes.length)} other host-wide managed local runtime process${processes.length === 1 ? "" : "es"} found.`,
    details: { supported: true, scope: "host", processes },
  };
}

function additionalManagedRuntimeProcesses(
  processes: ReadonlyArray<ManagedRuntimeProcess>,
  runtime: RuntimeMetadata | undefined,
): ReadonlyArray<ManagedRuntimeProcess> {
  if (runtime?.backend !== "binary") {
    return processes;
  }
  return processes.filter((processInfo) => processInfo.pid !== runtime.pid && processInfo.ppid !== runtime.pid);
}

async function checkRuntime(
  runtime: { backend: RuntimeBackend; server_url: string } | undefined,
  runtimeBackend: RuntimeBackend,
): Promise<CheckOutcome> {
  return check("runtime", "Existing local runtime is healthy", async () => {
    if (!runtime) {
      return "No existing runtime metadata";
    }
    if (runtime.backend !== runtimeBackend) {
      throw new Error(
        `Existing local runtime uses ${runtime.backend}; run start --runtime ${runtimeBackend} to switch backends.`,
      );
    }
    if (!(await checkLocalServerHealth(runtime.server_url))) {
      throw new Error(`${runtime.server_url} did not respond to /healthz`);
    }
    return `${runtime.server_url} is healthy`;
  });
}

function formatListeners(listeners: Awaited<ReturnType<typeof listenersForPort>>): string {
  return listeners
    .map((listener) =>
      [listener.command ?? "unknown", listener.pid ? `pid ${String(listener.pid)}` : undefined]
        .filter(Boolean)
        .join(" "),
    )
    .join(", ");
}

/**
 * A warning may carry its own repair as `details.remedy_command` (today: the
 * dependency-version check's package-manager-aware exact-pin install).
 * Surfacing that string keeps the structured advisory identical to the
 * command quoted in the warning's prose.
 */
function remedyCommandOf(check: CheckOutcome | undefined): string | undefined {
  if (check?.status !== "warn") {
    return undefined;
  }
  const details = check.details;
  if (typeof details !== "object" || details === null) {
    return undefined;
  }
  const remedy = (details as { remedy_command?: unknown }).remedy_command;
  return typeof remedy === "string" && remedy.length > 0 ? remedy : undefined;
}

/**
 * Reads the claim check's window classification out of its details. Absent
 * or malformed details mean "not closed". The classification only selects
 * the advisory wording (deadline nudge vs reconciliation); the claim
 * command stays suggested either way, because the local record may be stale
 * and running claim lets the server answer authoritatively.
 */
function claimWindowClosed(check: CheckOutcome): boolean {
  const details = check.details;
  return (
    typeof details === "object" &&
    details !== null &&
    (details as { claimable?: unknown }).claimable === false
  );
}

function hasManagedRuntimeProcesses(check: CheckOutcome | undefined): boolean {
  if (!check || check.status !== "warn") {
    return false;
  }
  const details = check.details;
  return (
    typeof details === "object" &&
    details !== null &&
    "supported" in details &&
    (details as { supported?: unknown }).supported === true &&
    Array.isArray((details as { processes?: unknown }).processes) &&
    ((details as { processes?: unknown[] }).processes?.length ?? 0) > 0
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function resolveRuntimeBackend(input: {
  runtime: unknown;
  image: string | undefined;
  envImage: string | undefined;
  existingRuntime: { backend: RuntimeBackend } | undefined;
}): RuntimeBackend {
  if (input.runtime === "binary" || input.runtime === "docker") {
    return input.runtime;
  }
  if (input.existingRuntime) {
    return input.existingRuntime.backend;
  }
  if (input.image || input.envImage) {
    return "docker";
  }
  return "binary";
}

async function check(
  name: string,
  fallback: string,
  run: () => Promise<string>,
  failureStatus: "warn" | "fail" = "fail",
): Promise<CheckOutcome> {
  try {
    return { name, status: "pass", message: await run() };
  } catch (error) {
    if (error instanceof PortInUseCheckError) {
      return {
        name,
        status: failureStatus,
        message: error.message,
        details: {
          port: error.port,
          server_url: error.serverUrl,
          listeners: error.listeners,
        },
      };
    }
    return {
      name,
      status: failureStatus,
      message: error instanceof Error ? error.message : fallback,
    };
  }
}

function imageUnavailableMessage(image: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const suffix = detail.trim() ? ` (${detail.trim()})` : "";
  return `Image ${image} is not available to Docker${suffix}; \`zitadel start\` may need a pull or a different image.`;
}
