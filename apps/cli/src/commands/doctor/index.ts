import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { Flags } from "@oclif/core";
import consola from "consola";

import { createZitadelClient } from "../../lib/api-client";
import { claimAction, claimCommand, claimWindowClosedAction } from "../../lib/claim-state";
import { type Environment, resolveEnvironment } from "../../lib/environment";
import { ZitadelError } from "../../lib/errors";
import { serverLogAction } from "../../lib/journey-guidance";
import {
  dockerRuntimeGuidance,
  dockerUnavailableMessage,
} from "../../lib/local-server/docker-guidance";
import type { LocalServers, ManagedRuntimeProcess } from "../../lib/local-server/processes";
import {
  DEFAULT_LOCAL_SERVER_PORT,
  assertLocalStateWritable,
  checkLocalServerHealth,
  defaultLocalServerImageForCliVersion,
  localServerUrl,
  readNearestRuntimeMetadata,
  type RuntimeBackend,
  type RuntimeMetadata,
} from "../../lib/local-server/runtime";
import { LocalServer } from "../../lib/local-server/server";
import { BaseCommand, CommandGroups, type JsonEnvelope, nonBlankString } from "../../lib/oclif";
import { environmentFlags, environmentSelectorSuffix } from "../../lib/oclif/environment-flags";
import { createOrca } from "../../lib/orca";
import { resolveCwd } from "../../lib/paths";
import {
  hasZitadelConfig,
  hasZitadelSecret,
  readProjectServer,
  readZitadelConfig,
  readZitadelSecret,
} from "../../lib/project";
import { listenersForPort } from "../../lib/prober/ports";
import { SANITY_CHECKS, type CheckContext, type CheckOutcome } from "./checks";
import {
  type EnvironmentSelector,
  portableSuggestions,
  projectCommand,
  shellCommand,
  type SuggestedCommand,
  unscopedCommand,
} from "../../lib/suggestion";
import { nextCommandsData } from "../../lib/oclif/envelope";

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
  static override group = CommandGroups.project;
  static override groupOrder = 3;
  static override flags = {
    fix: Flags.boolean({ description: "Repair missing files and stale managed wiring." }),
    image: nonBlankString({ description: "Container image to check." }),
    port: Flags.integer({
      description: "Local HTTP port to check. Defaults to the port this directory's server uses.",
    }),
    runtime: Flags.string({
      description: "Local runtime backend.",
      options: ["binary", "docker"],
    }),
    // Doctor's local-runtime checks are about the machine, but with `--env` /
    // `--env-file` it also verifies the environment a command would connect to:
    // the same flags every EnvironmentCommand takes, resolved the same way.
    ...environmentFlags,
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Doctor);
    // The local server this directory uses: the one `zitadel start` ran here,
    // or in the nearest parent, as setup and `console` find it. An unreadable
    // record only costs the port hint; the read below reports it.
    const startDir = resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined);
    const hint = await readNearestRuntimeMetadata(startDir).catch(() => undefined);
    const port = flags.port ?? hint?.runtime.port ?? DEFAULT_LOCAL_SERVER_PORT;
    await this.toMeta(flags, { resolveServer: false, source: localServerUrl(port) });
    const { cwd, dryRun } = this.meta;
    const nearest = await readNearestRuntimeMetadata(cwd);
    const existingRuntime = nearest?.runtime;
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
    const runtimeChecks = await runLocalRuntimeChecks(
      nearest?.dir ?? cwd,
      existingRuntime,
      runtimeBackend,
      image,
      port,
      this.localServers(),
    );
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
    const environmentChecks = await runEnvironmentChecks({
      cwd,
      env: this.meta.env,
      envName: typeof flags.env === "string" ? flags.env : undefined,
      envFile: typeof flags["env-file"] === "string" ? flags["env-file"] : undefined,
      serverFlag: typeof flags.server === "string" ? flags.server : undefined,
    });
    const checks = [...runtimeChecks, ...projectChecks, ...environmentChecks];
    const failed = checks.filter((check) => check.status === "fail");
    const warnings = checks.filter((check) => check.status === "warn");
    // `doctor` is not an EnvironmentCommand but honours --env/--env-file/--server
    // to check a chosen environment, so a suggested rerun of a failed check has
    // to carry that same selection or it would check the default project.
    const cwdFlag = typeof flags.cwd === "string" ? flags.cwd : undefined;
    const serverFlag = typeof flags.server === "string" ? flags.server : undefined;
    const selector = environmentSelectorSuffix({
      cwd: cwdFlag,
      envFile: typeof flags["env-file"] === "string" ? flags["env-file"] : undefined,
      envName: typeof flags.env === "string" ? flags.env : undefined,
      server: typeof flags.server === "string" ? flags.server : undefined,
    });
    // The claim check reads the local `.zitadel/secret`, which is setup's
    // project, so a claim is suggested only pinned to the file setup wrote for
    // it, as setup's own claim suggestion is: `--env-file` outranks the
    // process environment and the other `.env` files, which a bare claim
    // would read first and could name another project. Without a file that
    // names that very project nothing a command can carry selects it, so the
    // advice says so instead. The server is the project's own, from
    // `zitadel.json` where the claim check read it, not this run's `--server`.
    const projectId = await secretProjectId(cwd);
    // A `zitadel.json` that does not parse is the config check's to report,
    // not a reason for doctor itself to fail before it reports anything.
    const projectServer = hasConfig
      ? await readZitadelConfig(cwd).then(readProjectServer, () => serverFlag)
      : serverFlag;
    // A bare claim resolves as this shell does, so it is offered unpinned only
    // when that resolution lands on the very project the check read.
    const bareResolves =
      projectId !== undefined &&
      (await resolveEnvironment({ cwd, env: this.meta.env }).then(
        (environment) => environment.values.ZITADEL_PROJECT_ID?.value === projectId,
        () => false,
      ));
    const claimSelector = (await namesProject(
      join(cwd, ".env.development.local"),
      Promise.resolve(projectId),
    ))
      ? environmentSelectorSuffix({
          cwd: cwdFlag,
          envFile: ".env.development.local",
          server: projectServer,
        })
      : bareResolves
        ? environmentSelectorSuffix({ cwd: cwdFlag, server: projectServer })
        : undefined;
    const warningAdvice = advisoryForWarnings(
      warnings,
      this.meta.cliVersion,
      claimSelector,
      selector,
    );
    // A server that is running is one a sign-in or a request can fail
    // against, and its log is where the reason is.
    const serving =
      existingRuntime !== undefined &&
      runtimeChecks.find((check) => check.name === "runtime")?.status === "pass";
    const nextActions = [
      ...(warningAdvice?.nextActions ?? []),
      ...(serving ? [serverLogAction(this.meta.cliVersion)] : []),
    ];
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
      ...(nextActions.length > 0 ? { next_actions: nextActions } : {}),
      ...(warningAdvice ? nextCommandsData(warningAdvice.nextCommands) : {}),
    };

    if (failed.length > 0) {
      const advice = failureAdvice(
        failed,
        image,
        port,
        this.meta.cliVersion,
        selector,
        nearest !== undefined && nearest.dir !== cwd ? nearest.dir : undefined,
      );
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
        details:
          advice.suggestedArgs === undefined
            ? data
            : { ...data, suggested_args: advice.suggestedArgs },
      });
    }

    return this.emit({
      status: "ok",
      data,
      warnings: warnings.map((warning) => `${warning.name}: ${warning.message}`),
    });
  }
}

export function failureAdvice(
  failed: CheckOutcome[],
  image: string,
  port: number,
  cliVersion: string,
  // The invocation's --env/--env-file/--server suffix. Appended only to the
  // retries that resolve the environment (the env-connect failure and the
  // project `--fix`); the local-runtime remedies — docker, port, image,
  // state-dir — are machine checks the selector would only clutter.
  selector: EnvironmentSelector,
  runtimeDir?: string,
): { hint: string; nextCommands: SuggestedCommand[]; suggestedArgs?: string[][] } {
  const failedNames = new Set(failed.map((check) => check.name));

  if (failedNames.has("server-binary")) {
    return {
      hint: "The Zitadel server npm package is not available. Reinstall the CLI package, then retry.",
      nextCommands: [unscopedCommand("doctor", cliVersion)],
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
      nextCommands: [shellCommand(`docker pull ${image}`), unscopedCommand("doctor", cliVersion)],
    };
  }

  if (failedNames.has("state-dir")) {
    return {
      hint: "The local Zitadel state directory is not writable. Fix directory permissions, then rerun `zitadel doctor`.",
      nextCommands: [unscopedCommand("doctor", cliVersion)],
    };
  }

  if (failedNames.has("port")) {
    const fallbackPort = port === DEFAULT_LOCAL_SERVER_PORT ? port + 1 : DEFAULT_LOCAL_SERVER_PORT;
    const stopCommand = unscopedCommand("stop --all", cliVersion);
    const retryCommand = unscopedCommand("doctor", cliVersion);
    const alternatePortCommand = unscopedCommand(
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
    // `start` and `reset` act on their working directory, so a runtime found
    // in a parent is named explicitly. The directory comes from the file
    // system and quoting differs between POSIX shells, PowerShell and cmd.exe,
    // so a path that needs quoting leaves the strings out and the argument
    // lists in `details.suggested_args` carry the recovery.
    const at = runtimeDir === undefined ? [] : ["--cwd", runtimeDir];
    const suggestedArgs = [
      ["start", ...at],
      ["reset", "--force", ...at],
    ];
    const nextCommands = portableSuggestions(suggestedArgs, cliVersion);
    return {
      hint:
        "Existing local runtime metadata was found, but the local Zitadel server is not healthy. Start it again or reset stale local data." +
        (nextCommands.length === 0
          ? ` The runtime is in ${runtimeDir ?? "the working directory"}, a directory that needs shell quoting, so no command is printed; run \`zitadel doctor --json\` and use details.suggested_args for the exact arguments.`
          : ""),
      nextCommands,
      suggestedArgs,
    };
  }

  // A failure that surfaced as a typed CLI error carries its own remedy —
  // e.g. the framework floor's upgrade hint. That beats the generic --fix
  // advice below, which cannot repair an unsupported version.
  const typed = failed.find((check) => check.code !== undefined && check.hint !== undefined);
  if (typed?.hint !== undefined) {
    return { hint: typed.hint, nextCommands: [projectCommand("doctor", selector, cliVersion)] };
  }

  if (failedNames.has("environment")) {
    return {
      hint: "The resolved environment could not connect. Check the server, project and credential it resolves with `zitadel env`, then rerun `zitadel doctor` with the same --env / --env-file.",
      nextCommands: [
        projectCommand("env", selector, cliVersion),
        projectCommand("doctor", selector, cliVersion),
      ],
    };
  }

  const hasProjectFailure = failed.some((check) => !LOCAL_RUNTIME_CHECK_NAMES.has(check.name));
  if (hasProjectFailure) {
    return {
      hint: `Run \`${projectCommand("doctor --fix", selector, cliVersion)}\` to re-apply missing managed files.`,
      nextCommands: [projectCommand("doctor --fix", selector, cliVersion)],
    };
  }

  return {
    hint: "Fix the reported checks, then rerun `zitadel doctor`.",
    nextCommands: [projectCommand("doctor", selector, cliVersion)],
  };
}

/**
 * The follow-ups doctor offers for its warnings: the Docker guidance, the claim
 * nudge, the managed-runtime review, a dependency remedy and the meta-schema
 * refresh.
 */
export function advisoryForWarnings(
  warnings: CheckOutcome[],
  cliVersion: string,
  /**
   * The selector for the local project, which is the one the claim check
   * reads, or nothing when no selector reaches it.
   */
  local: EnvironmentSelector | undefined,
  /** This run's selection, which a suggested rerun of doctor carries. */
  selector: EnvironmentSelector,
): { nextActions: string[]; nextCommands: SuggestedCommand[] } | undefined {
  const nextActions: string[] = [];
  const nextCommands: SuggestedCommand[] = [];
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
    if (local === undefined) {
      nextActions.push(
        "Claim this project with `zitadel claim` once .env.development.local sets ZITADEL_PROJECT_ID and ZITADEL_PROJECT_SECRET to the project in .zitadel/secret; until then claim would resolve a different project.",
      );
    } else {
      nextActions.push(
        claimWindowClosed(claimWarning)
          ? claimWindowClosedAction(cliVersion, local)
          : claimAction(cliVersion, undefined, local),
      );
      nextCommands.push(claimCommand(cliVersion, local));
    }
  }

  const managedRuntimeWarning = warnings.find(
    (check) => check.name === "managed-runtime-processes",
  );
  if (hasManagedRuntimeProcesses(managedRuntimeWarning)) {
    nextActions.push(
      "Review other host-wide CLI-managed local Zitadel runtimes before starting a new one.",
    );
    nextCommands.push(unscopedCommand("stop --all", cliVersion));
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

  if (hasRepairableMetaSchemas(warnings.find((check) => check.name === "meta-schemas"))) {
    nextActions.push(
      "Write this CLI version's editor schemas into .zitadel/meta/; editors and agents read the dialect from there.",
    );
    nextCommands.push(projectCommand("doctor --fix", selector, cliVersion));
  }

  if (nextActions.length === 0 && nextCommands.length === 0) {
    return undefined;
  }
  return { nextActions: unique(nextActions), nextCommands: unique(nextCommands) };
}

/**
 * Environment-aware checks, run only when `--env` / `--env-file` is given so a
 * plain `doctor` is unchanged (its default development environment is the local
 * server the runtime checks already cover). One authenticated `getProject`
 * against the resolved connection settles both questions at once: a response
 * proves the server is reachable, and that the resolved project exists and the
 * resolved credential can read it — the drift env resolution could introduce.
 *
 * Deliberately small: it does not re-run every sanity check against the remote
 * project (that would need the files the environment points at, which do not
 * exist locally), only the connection the environment resolves.
 */
async function runEnvironmentChecks(input: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  envName?: string;
  envFile?: string;
  serverFlag?: string;
}): Promise<CheckOutcome[]> {
  if (input.envName === undefined && input.envFile === undefined) {
    return [];
  }
  let environment: Environment;
  try {
    environment = await resolveEnvironment({
      cwd: input.cwd,
      env: input.env,
      envName: input.envName,
      envFile: input.envFile,
      serverFlag: input.serverFlag,
    });
  } catch (error) {
    return [
      {
        name: "environment",
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }
  const name = environment.name.value;
  return [
    await check(`environment`, `Resolved ${name} environment connects`, async () => {
      const server = environment.values.ZITADEL_URL?.value;
      const projectId = environment.values.ZITADEL_PROJECT_ID?.value;
      const token = environment.values.ZITADEL_PROJECT_SECRET?.value;
      if (server === undefined || projectId === undefined) {
        throw new Error(
          `ZITADEL_URL and ZITADEL_PROJECT_ID must resolve for the ${name} environment`,
        );
      }
      if (token === undefined) {
        throw new Error(
          `ZITADEL_PROJECT_SECRET must resolve to verify project ${projectId} on ${server}`,
        );
      }
      const project = await createZitadelClient({ baseUrl: server, token }).getProject(projectId);
      if (project.id !== projectId) {
        throw new Error(`${server} returned project ${project.id}, not the resolved ${projectId}`);
      }
      return `${server} is reachable and project ${projectId} matches`;
    }),
  ];
}

/**
 * The local runtime checks, against the server in `runtimeDir` (the directory
 * holding its `.zitadel/local` state, or the current directory when no server
 * was started yet).
 */
async function runLocalRuntimeChecks(
  runtimeDir: string,
  runtime: RuntimeMetadata | undefined,
  runtimeBackend: RuntimeBackend,
  image: string,
  port: number,
  servers: LocalServers,
): Promise<CheckOutcome[]> {
  const managedRuntimeCheck = await checkManagedRuntimeProcesses(runtime, servers);
  if (runtimeBackend === "binary") {
    return [
      await check("server-binary", "Server npm package is available", async () => {
        const version = LocalServer.assertBinaryAvailable();
        return `@zitadel/server ${version} is available`;
      }),
      await check(
        "state-dir",
        "Local state directory is writable",
        async () => {
          const probe = await assertLocalStateWritable(runtimeDir);
          return probe.checkedPath === probe.targetPath
            ? `${probe.targetPath} is writable`
            : `${probe.targetPath} can be created (${probe.checkedPath} is writable)`;
        },
        "warn",
      ),
      await check("port", `Port ${String(port)} is available`, () =>
        checkPortAvailability(runtime, port),
      ),
      await checkRuntime(runtime, runtimeBackend),
      managedRuntimeCheck,
    ];
  }

  const docker = await check(
    "docker-cli",
    "Docker is reachable",
    async () => {
      let result: Awaited<ReturnType<typeof LocalServer.dockerReachable>>;
      try {
        result = await LocalServer.dockerReachable();
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
              const source = await LocalServer.imageAvailable(image);
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
        const probe = await assertLocalStateWritable(runtimeDir);
        return probe.checkedPath === probe.targetPath
          ? `${probe.targetPath} is writable`
          : `${probe.targetPath} can be created (${probe.checkedPath} is writable)`;
      },
      "warn",
    ),
    await check("port", `Port ${String(port)} is available`, () =>
      checkPortAvailability(runtime, port),
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
  readonly port: number;
  readonly serverUrl: string;
  readonly listeners: Awaited<ReturnType<typeof listenersForPort>>;

  constructor(
    port: number,
    serverUrl: string,
    listeners: Awaited<ReturnType<typeof listenersForPort>>,
  ) {
    super(`Port ${String(port)} is already in use by ${formatListeners(listeners)}`);
    this.port = port;
    this.serverUrl = serverUrl;
    this.listeners = listeners;
  }
}

async function checkManagedRuntimeProcesses(
  runtime: RuntimeMetadata | undefined,
  servers: LocalServers,
): Promise<CheckOutcome> {
  const discovery = await servers.current();
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
  return processes.filter(
    (processInfo) => processInfo.pid !== runtime.pid && processInfo.ppid !== runtime.pid,
  );
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
      throw new Error(`${runtime.server_url} is not ready: /readyz did not answer ok`);
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
function remedyCommandOf(check: CheckOutcome | undefined): SuggestedCommand | undefined {
  if (check?.status !== "warn") {
    return undefined;
  }
  const details = check.details;
  if (typeof details !== "object" || details === null) {
    return undefined;
  }
  const remedy = (details as { remedy_command?: unknown }).remedy_command;
  return typeof remedy === "string" && remedy.length > 0 ? shellCommand(remedy) : undefined;
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

/**
 * Whether the meta-schemas warning lists a missing or outdated file, which
 * `--fix` writes. One the CLI cannot read only gets the warning's reason.
 */
function hasRepairableMetaSchemas(check: CheckOutcome | undefined): boolean {
  if (check?.status !== "warn") {
    return false;
  }
  const details = check.details as { missing?: unknown[]; outdated?: unknown[] } | undefined;
  return (details?.missing?.length ?? 0) + (details?.outdated?.length ?? 0) > 0;
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

function unique<T extends string>(values: T[]): T[] {
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

/** The project `.zitadel/secret` records, or nothing when it cannot be read. */
async function secretProjectId(cwd: string): Promise<string | undefined> {
  return (await hasZitadelSecret(cwd))
    ? readZitadelSecret(cwd).then(
        (secret) => secret.project_id,
        () => undefined,
      )
    : undefined;
}

/** Whether an env file sets `ZITADEL_PROJECT_ID` to this project. */
async function namesProject(
  path: string,
  projectId: Promise<string | undefined>,
): Promise<boolean> {
  const id = await projectId;
  if (id === undefined || !existsSync(path)) {
    return false;
  }
  // Read through the resolver, as `claim --env-file` would read it; the
  // process environment is left out, so only the file answers. The file must
  // carry the credential too: for one it lacks, a pinned claim would take
  // whatever secret the shell exports and send it along for this project.
  return resolveEnvironment({ cwd: dirname(path), env: {}, envFile: path }).then(
    ({ values }) =>
      values.ZITADEL_PROJECT_ID?.value === id && values.ZITADEL_PROJECT_SECRET !== undefined,
    () => false,
  );
}
