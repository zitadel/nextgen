import { ZitadelError, toZitadelError } from "../../errors";
import { publicCliCommand } from "../../public-cli";
import { listenersForPort, type TcpListener } from "../../prober/ports";
import { dockerRuntimeGuidance, dockerUnavailableMessage } from "../docker-guidance";
import { DEFAULT_LOCAL_SERVER_PORT, localServerUrl, type RuntimeMetadata } from "../runtime";
import { BinaryLauncher } from "./binary-launcher";
import { DockerLauncher } from "./docker-launcher";
import {
  NoFreePortError,
  PortInUseError,
  ServerStartError,
  ServerStopError,
  type StopOutcome,
} from "./lifecycle";

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

export async function assertDockerAvailable(cliVersion: string): Promise<void> {
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

/** Turns what the lifecycle threw into the error the command reports. */
export async function startFailure(error: unknown, cliVersion: string): Promise<unknown> {
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
