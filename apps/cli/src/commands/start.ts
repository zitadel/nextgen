import { Flags } from "@oclif/core";

import consola from "consola";

import { ZitadelError, toZitadelError } from "../lib/errors";
import { ensureLocalAdmin, type LocalAdmin } from "../lib/local-server/admin-credential";
import { consoleSignInUrl } from "../lib/local-server/sign-in";
import { BinaryLauncher } from "../lib/local-server/launchers/binary";
import { DockerLauncher } from "../lib/local-server/launchers/docker";
import {
  dockerRuntimeGuidance,
  dockerUnavailableMessage,
} from "../lib/local-server/docker-guidance";
import { EMPTY_SUMMARY, loadProjectEnv } from "../lib/local-server/env-vars";
import {
  DEFAULT_LOCAL_SERVER_PORT,
  PLATFORM_PROJECT_ID,
  defaultLocalServerImageForCliVersion,
  ensureContainerIdentity,
  ensureLocalState,
  localContainerName,
  localServerUrl,
  peekRuntimeMetadata,
  readRuntimeMetadata,
  type BinaryRuntimeMetadata,
  type DockerRuntimeMetadata,
  type RuntimeBackend,
  type RuntimeMetadata,
} from "../lib/local-server/runtime";
import {
  LocalServer,
  NoFreePortError,
  PortInUseError,
  ServerStartError,
  ServerStopError,
  type StopOutcome,
} from "../lib/local-server/server";
import { HttpHealth, RuntimeFileStore, TcpPorts } from "../lib/local-server/server-adapters";
import { BaseCommand, CommandGroups, type JsonEnvelope, nonBlankString } from "../lib/oclif";
import { resolveCwd } from "../lib/paths";
import { listenersForPort, type TcpListener } from "../lib/prober/ports";
import { publicCliCommand } from "../lib/public-cli";
import { reportWarning } from "../lib/warnings";

export default class Start extends BaseCommand {
  static override description = "Start a local Zitadel server.";
  static override group = CommandGroups.localServer;
  static override groupOrder = 1;
  static override flags = {
    image: nonBlankString({ description: "Container image to run." }),
    port: Flags.integer({
      description:
        "Local HTTP port. By default this directory keeps the port it had, or takes the first free one from 8080.",
    }),
    runtime: Flags.string({
      description: "Local runtime backend.",
      options: ["binary", "docker"],
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Start);
    const requestedPort = flags.port;
    // Where the server will be, as far as is known before one is chosen: the
    // port asked for, else the one this directory already has.
    const recorded = await peekRuntimeMetadata(
      resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined),
    );
    const port = requestedPort ?? recorded?.port ?? DEFAULT_LOCAL_SERVER_PORT;
    const serverUrl = localServerUrl(port);
    await this.toMeta(flags, { resolveServer: false, source: serverUrl });

    validatePort(port);
    const runtimeBackend = resolveRuntimeBackend({
      image: flags.image,
      runtime: flags.runtime,
      envImage: this.meta.env.ZITADEL_LOCAL_IMAGE,
    });
    assertRuntimeFlags(runtimeBackend, flags.image);
    this.recordTelemetry({ runtime: runtimeBackend });
    const image =
      flags.image ??
      this.meta.env.ZITADEL_LOCAL_IMAGE ??
      defaultLocalServerImageForCliVersion(this.meta.cliVersion);
    const containerName = localContainerName(this.meta.cwd);
    if (this.meta.dryRun) {
      return this.emit({
        status: "ok",
        data: {
          title: "Local Zitadel server start plan.",
          runtime: {
            backend: runtimeBackend,
            ...(runtimeBackend === "docker"
              ? {
                  container_name: containerName,
                  image,
                }
              : {}),
            port,
          },
          urls: {
            api: serverUrl,
            console: `${serverUrl}/ui/console/`,
            login: `${serverUrl}/ui/login/`,
          },
          next_commands: [publicCliCommand("start", this.meta.cliVersion)],
        },
      });
    }

    const paths = await ensureLocalState(this.meta.cwd);
    const existingRuntime = await readRuntimeMetadata(this.meta.cwd);
    // NEXTGEN_* variables from .env.local and .env are read before any runtime
    // is stopped and reach the new runtime through its environment only; see
    // env-vars.ts.
    const env = await loadProjectEnv(this.meta.cwd);
    // The developer exists on their own server from the first start: the
    // server imports the local admin, and the console signs them in by link.
    // The admin is a user of the platform project, so the two travel together:
    // a caller that opts out of the platform bootstrap (a test harness wanting
    // a bare single-project server) gets neither. The opt-out is read from the
    // same merged environment the server receives — the project's env files
    // over the shell — so a `false` in `.env.local` turns both off rather than
    // being overridden by the user file forcing the bootstrap back on.
    const serverEnv = { ...this.meta.env, ...env.values };
    const local = platformBootstrapEnabled(serverEnv)
      ? await ensureLocalAdmin(this.meta.cwd, serverEnv.NEXTGEN_SCHEMA_BUILTIN_PUBLIC_BASE)
      : undefined;

    if (runtimeBackend === "binary") {
      // A server another CLI release started serves that release's API, and
      // `setup` against it fails halfway, after the project exists. So a
      // running server is reused only when it is the version this CLI ships;
      // the Docker path compares the image for the same reason.
      const serverVersion = BinaryLauncher.bundledVersion();
      const otherRelease =
        existingRuntime?.backend === "binary" &&
        serverVersion !== undefined &&
        existingRuntime.server_version !== serverVersion
          ? existingRuntime
          : undefined;
      if (otherRelease && BinaryLauncher.isRunning(otherRelease.pid)) {
        consola.info(
          `Restarting the local Zitadel server on ${String(serverVersion)}: it ran ${otherRelease.server_version}. Its data stays.`,
        );
      }
      if (existingRuntime?.backend === "docker") {
        await stopExistingRuntime(existingRuntime);
      }
      return this.startAndReport(
        new LocalServer(
          {
            store: new RuntimeFileStore<BinaryRuntimeMetadata>(this.meta.cwd, "binary"),
            launcher: new BinaryLauncher({
              cliVersion: this.meta.cliVersion,
              dataDir: paths.dataDir,
              logPath: paths.logFile,
              env,
              userFile: local?.userFile,
            }),
            ports: new TcpPorts(),
            health: new HttpHealth(),
          },
          {
            port: requestedPort,
            reusable: (record) =>
              serverVersion === undefined || record.server_version === serverVersion,
          },
        ),
        local?.admin,
      );
    }

    await assertDockerAvailable(this.meta.cliVersion);
    if (existingRuntime?.backend === "binary") {
      await BinaryLauncher.stopPid(existingRuntime.pid);
    }
    return this.startAndReport(
      new LocalServer(
        {
          store: new RuntimeFileStore<DockerRuntimeMetadata>(this.meta.cwd, "docker"),
          launcher: new DockerLauncher({
            cliVersion: this.meta.cliVersion,
            containerName,
            image,
            dataDir: paths.dataDir,
            identity: await ensureContainerIdentity(this.meta.cwd, DockerLauncher.currentUser()),
            env,
            userFile: local?.userFile,
          }),
          ports: new TcpPorts(),
          health: new HttpHealth(),
        },
        { port: requestedPort, reusable: (record) => record.image === image },
      ),
      local?.admin,
    );
  }

  /** Starts (or finds running) the directory's server and reports it, whatever runs it. */
  private async startAndReport<R extends RuntimeMetadata>(
    server: LocalServer<R>,
    admin: LocalAdmin | undefined,
  ): Promise<JsonEnvelope> {
    let started: Awaited<ReturnType<typeof server.start>>;
    try {
      started = await server.start();
    } catch (error) {
      throw await startFailure(error, this.meta.cliVersion);
    }
    const { record, alreadyRunning } = started;
    return this.emit({
      status: "ok",
      data: readyData(
        record,
        alreadyRunning,
        this.meta.cliVersion,
        await consoleLoginFor(record.server_url, admin),
      ),
    });
  }
}

/**
 * Whether this start boots the platform project, and with it the local admin.
 * On by default; an explicit `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=false` opts
 * out, which is how a harness asks for a bare single-project instance.
 */
function platformBootstrapEnabled(env: NodeJS.ProcessEnv): boolean {
  if ((env.NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT ?? "true").toLowerCase() === "false") {
    return false;
  }
  // A server pinned to a project of its own cannot also bootstrap the platform
  // one — it refuses that combination at startup (cmd/server/config.go) — so the
  // pin wins and there is no local admin, rather than a start that cannot boot.
  const pinned = env.NEXTGEN_PLATFORM_PROJECT_ID;
  return !pinned || pinned === PLATFORM_PROJECT_ID;
}

/**
 * Mints a console sign-in link for the local admin. A failure (for
 * example a data directory from before the local admin existed) must not fail
 * the start itself, so it degrades to a warning with the fix. Without a local
 * admin there is nothing to sign in as, and the result carries no console.
 */
async function consoleLoginFor(
  serverUrl: string,
  admin: LocalAdmin | undefined,
): Promise<ConsoleLogin | undefined> {
  if (!admin) {
    return undefined;
  }
  try {
    const url = await consoleSignInUrl(serverUrl, admin);
    consola.log(`Console: signed in as ${admin.email}. Open this link (works once):`);
    consola.log(url);
    return { signed_in_as: admin.email, sign_in_url: url };
  } catch (error) {
    const reason = toZitadelError(error);
    reportWarning(`Could not create a console sign-in link: ${reason.message}`);
    return { signed_in_as: admin.email, error: reason.message, hint: reason.hint };
  }
}

type ConsoleLogin = {
  signed_in_as: string;
  sign_in_url?: string;
  error?: string;
  hint?: string;
};

function startupCleanupFailedError(
  error: unknown,
  stopResult: StopOutcome,
  cliVersion: string,
): ZitadelError {
  const startupError = toZitadelError(error);
  return new ZitadelError(
    startupError.code,
    `${startupError.message}; cleanup did not stop the spawned local runtime`,
    {
      hint: "Inspect the local runtime process and stop it manually, then rerun `zitadel start`.",
      nextCommands: unique([
        ...(startupError.nextCommands ?? []),
        publicCliCommand("stop --all", cliVersion),
        publicCliCommand("logs", cliVersion),
        publicCliCommand("reset --force", cliVersion),
      ]),
      details: {
        startup_error: {
          code: startupError.code,
          message: startupError.message,
          details: startupError.details,
        },
        stop_result: stopResult,
      },
    },
  );
}

async function assertDockerAvailable(cliVersion: string): Promise<void> {
  let result: Awaited<ReturnType<typeof DockerLauncher.available>>;
  try {
    result = await DockerLauncher.available();
  } catch (error) {
    throw dockerUnavailableError(error, cliVersion);
  }
  if (result.status !== 0) {
    throw dockerUnavailableError(result.stderr || "docker version failed", cliVersion);
  }
}

function dockerUnavailableError(error: unknown, cliVersion: string): ZitadelError {
  const advice = dockerRuntimeGuidance("start", cliVersion);
  return new ZitadelError("E_VALIDATION", "Docker is not reachable", {
    hint: advice.hint,
    nextCommands: advice.nextCommands,
    details: { message: dockerUnavailableMessage(error) },
  });
}

function readyData(
  metadata: RuntimeMetadata,
  alreadyRunning: boolean,
  cliVersion: string,
  console: ConsoleLogin | undefined,
) {
  return {
    title: alreadyRunning
      ? "Local Zitadel server is already running."
      : "Local Zitadel server is ready.",
    runtime: {
      backend: metadata.backend,
      ...(metadata.backend === "docker"
        ? {
            container_name: metadata.container_name,
            container_id: metadata.container_id,
            image: metadata.image,
          }
        : {
            pid: metadata.pid,
            log_path: metadata.log_path,
            server_package: metadata.server_package,
            server_version: metadata.server_version,
          }),
      port: metadata.port,
      data_dir: metadata.data_dir,
      env: metadata.env ?? EMPTY_SUMMARY,
    },
    urls: {
      api: metadata.server_url,
      console: `${metadata.server_url}/ui/console/`,
      login: `${metadata.server_url}/ui/login/`,
    },
    ...(console ? { console } : {}),
    next_actions: [
      ...(console?.sign_in_url
        ? [`Console: you are ${console.signed_in_as}. Open ${console.sign_in_url} (works once).`]
        : []),
      "Run setup in this directory or one inside it, so it finds this server's local admin; the CLI will detect the framework or ask when needed.",
      "Setup installs dependencies when needed; then start your app dev server.",
    ],
    next_commands: [
      publicCliCommand("setup --server local", cliVersion),
      // Only when a link could actually be minted: `zitadel console` mints
      // the same way, so suggesting it after a failure sends the caller at a
      // command that fails again.
      ...(console?.sign_in_url ? [publicCliCommand("console", cliVersion)] : []),
    ],
  };
}

/** Turns what the lifecycle threw into the error the command reports. */
async function startFailure(error: unknown, cliVersion: string): Promise<unknown> {
  if (error instanceof ServerStartError) {
    const record = error.record as RuntimeMetadata;
    const details =
      record.backend === "docker"
        ? { runtime: "docker", container_name: record.container_name }
        : { runtime: "binary", pid: record.pid, log_path: record.log_path };
    const reported =
      error.reason === "exited"
        ? serverExitedError(record.server_url, cliVersion, details, await logTailOf(record))
        : new ZitadelError("E_NETWORK", "Local Zitadel server did not become healthy", {
            hint: "Inspect the local runtime logs, then reset the local runtime if needed.",
            nextCommands: [
              publicCliCommand("logs", cliVersion),
              publicCliCommand("reset --force", cliVersion),
            ],
            details: { ...details, server_url: record.server_url },
          });
    return error.cleanup.status === "failed"
      ? startupCleanupFailedError(reported, error.cleanup, cliVersion)
      : reported;
  }
  if (error instanceof ServerStopError) {
    return new ZitadelError("E_VALIDATION", "Existing local Zitadel server did not stop", {
      hint: "Stop the existing local runtime manually, then rerun start.",
      details: { runtime: error.record, stop_result: error.outcome },
    });
  }
  if (error instanceof PortInUseError) {
    const url = localServerUrl(error.port);
    // Who holds the port is only for the message, so it can afford to wait for `lsof`.
    const listeners = await listenersForPort(error.port, { timeoutMs: 5000 });
    return portInUseError(error.port, url, listeners, cliVersion);
  }
  if (error instanceof NoFreePortError) {
    return new ZitadelError("E_PORT_IN_USE", error.message, {
      hint: "Free a port, or choose one with --port.",
      nextCommands: [publicCliCommand("start --port 9080", cliVersion)],
      details: { first_port: error.firstPort },
    });
  }
  return error;
}

/** The end of the server's own log, when there is one to read. */
async function logTailOf(record: RuntimeMetadata): Promise<string | undefined> {
  try {
    return record.backend === "docker"
      ? await DockerLauncher.readLogs(record.container_name, 40)
      : await BinaryLauncher.readLogs(record.log_path, 40);
  } catch {
    return undefined;
  }
}

function portInUseError(
  port: number,
  serverUrl: string,
  listeners: ReadonlyArray<TcpListener>,
  cliVersion: string,
): ZitadelError {
  const fallbackPort = port === DEFAULT_LOCAL_SERVER_PORT ? port + 1 : DEFAULT_LOCAL_SERVER_PORT;
  return new ZitadelError("E_PORT_IN_USE", `Port ${String(port)} is already in use`, {
    hint: `Stop the process using ${serverUrl}, run \`zitadel stop --all\` for managed local runtimes, or choose another port.`,
    nextCommands: [
      publicCliCommand("stop --all", cliVersion),
      publicCliCommand(`start --port ${String(fallbackPort)}`, cliVersion),
    ],
    details: { port, server_url: serverUrl, listeners },
  });
}

function serverExitedError(
  serverUrl: string,
  cliVersion: string,
  details: Record<string, unknown>,
  logTail: string | undefined,
): ZitadelError {
  return new ZitadelError(
    "E_NETWORK",
    "Local Zitadel server process exited before becoming healthy",
    {
      hint: "Inspect the local runtime logs, then retry after fixing the startup error.",
      nextCommands: [
        publicCliCommand("logs", cliVersion),
        publicCliCommand("reset --force", cliVersion),
      ],
      details: { ...details, server_url: serverUrl, ...(logTail ? { log_tail: logTail } : {}) },
    },
  );
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ZitadelError("E_VALIDATION", `Invalid port ${String(port)}`, {
      hint: "Use a TCP port between 1 and 65535.",
    });
  }
}

function resolveRuntimeBackend(input: {
  runtime: unknown;
  image: string | undefined;
  envImage: string | undefined;
}): RuntimeBackend {
  if (input.runtime === "binary" || input.runtime === "docker") {
    return input.runtime;
  }
  if (input.image || input.envImage) {
    return "docker";
  }
  return "binary";
}

function assertRuntimeFlags(runtime: RuntimeBackend, image: string | undefined): void {
  if (runtime === "binary" && image) {
    throw new ZitadelError("E_VALIDATION", "--image requires --runtime docker", {
      hint: "Use `zitadel start --runtime docker --image <tag>`, or omit --image for the npm binary runtime.",
    });
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function stopExistingRuntime(runtime: RuntimeMetadata | undefined): Promise<void> {
  if (!runtime) {
    return;
  }
  if (runtime.backend === "binary") {
    const stopResult = await BinaryLauncher.stopPid(runtime.pid);
    if (stopResult.status === "failed") {
      throw new ZitadelError("E_VALIDATION", "Existing local Zitadel server did not stop", {
        hint: "Stop the existing local runtime manually, then rerun start.",
        details: { runtime, stop_result: stopResult },
      });
    }
    return;
  }
  await DockerLauncher.remove(runtime.container_name);
}
