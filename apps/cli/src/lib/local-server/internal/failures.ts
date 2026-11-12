import { ZitadelError, toZitadelError } from "@/lib/errors";
import { distinct, suggestion } from "@/lib/suggestion";
import { listenersForPort, type TcpListener } from "@/lib/prober/ports";
import {
  dockerRuntimeGuidance,
  dockerUnavailableMessage,
} from "@/lib/local-server/docker-guidance";
import { DEFAULT_LOCAL_SERVER_PORT, localServerUrl } from "@/lib/local-server/runtime";
import { DockerLauncher } from "./docker-launcher";
import {
  NoFreePortError,
  PortInUseError,
  ServerStartError,
  ServerStopError,
  type StopOutcome,
} from "./lifecycle";

/**
 * Failures of a start, as the errors the commands report. The lifecycle throws
 * typed errors that know nothing about wording, hints or suggested commands;
 * this is where they become the messages a person or an agent acts on, so a
 * message can be changed without touching the lifecycle.
 */

/**
 * A failed start whose cleanup also failed: the server may still be running
 * with nothing recording it, so the error says how to find and stop it.
 */
function startupCleanupFailedError(error: unknown, stopResult: StopOutcome): ZitadelError {
  const startupError = toZitadelError(error);
  return new ZitadelError(
    startupError.code,
    `${startupError.message}; cleanup did not stop the spawned local runtime`,
    {
      hint: "Inspect the local runtime process and stop it manually, then rerun `zitadel start`.",
      nextCommands: distinct([
        ...(startupError.nextCommands ?? []),
        suggestion("stop", { flags: { all: true } }),
        suggestion("logs"),
        suggestion("reset", { flags: { force: true } }),
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

/**
 * Fails early, with the guidance for starting Docker, when the daemon does not
 * answer: better than a start that fails halfway with a raw `docker` error.
 */
export async function assertDockerAvailable(): Promise<void> {
  const result = await DockerLauncher.available().catch((error: unknown) => {
    throw dockerUnavailableError(error);
  });
  if (result.status !== 0) {
    throw dockerUnavailableError(result.stderr || "docker version failed");
  }
}

/** The error for a Docker daemon that is missing or not running. */
function dockerUnavailableError(error: unknown): ZitadelError {
  const advice = dockerRuntimeGuidance("start");
  return new ZitadelError("E_VALIDATION", "Docker is not reachable", {
    hint: advice.hint,
    nextCommands: [advice.check, suggestion(advice.retry)],
    details: { message: dockerUnavailableMessage(error) },
  });
}

/**
 * Turns what the lifecycle threw into the error the command reports; anything it
 * does not recognise is returned unchanged for the caller to throw. A start that
 * failed to become ready also carries what cleaning it up did, so a server that
 * could not be stopped is reported as such and not as a plain start failure.
 */
export async function startFailure(error: unknown): Promise<unknown> {
  if (error instanceof ServerStartError) {
    const { record, details } = error;
    const reported =
      error.reason === "exited"
        ? serverExitedError(record.server_url, details, error.logTail)
        : new ZitadelError("E_NETWORK", "Local Zitadel server did not become healthy", {
            hint: "Inspect the local runtime logs, then reset the local runtime if needed.",
            nextCommands: [suggestion("logs"), suggestion("reset", { flags: { force: true } })],
            details: {
              ...details,
              server_url: record.server_url,
              ...(error.logTail ? { log_tail: error.logTail } : {}),
            },
          });
    return error.cleanup.status === "failed"
      ? startupCleanupFailedError(reported, error.cleanup)
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
    return portInUseError(error.port, url, listeners);
  }
  if (error instanceof NoFreePortError) {
    return new ZitadelError("E_PORT_IN_USE", error.message, {
      hint: "Free a port, or choose one with --port.",
      nextCommands: [suggestion("start", { flags: { port: 9080 } })],
      details: { first_port: error.firstPort },
    });
  }
  return error;
}

/**
 * A port that was asked for, or every port tried, is held. `listeners` (who
 * holds it, from `lsof`) is only for the message: whether the port is held was
 * decided elsewhere, because a failed `lsof` reads as "nobody", and a message
 * may be wrong where a decision must not be.
 */
function portInUseError(
  port: number,
  serverUrl: string,
  listeners: ReadonlyArray<TcpListener>,
): ZitadelError {
  const fallbackPort = port === DEFAULT_LOCAL_SERVER_PORT ? port + 1 : DEFAULT_LOCAL_SERVER_PORT;
  return new ZitadelError("E_PORT_IN_USE", `Port ${String(port)} is already in use`, {
    hint: `Stop the process using ${serverUrl}, run \`zitadel stop --all\` for managed local runtimes, or choose another port.`,
    nextCommands: [
      suggestion("stop", { flags: { all: true } }),
      suggestion("start", { flags: { port: fallbackPort } }),
    ],
    details: { port, server_url: serverUrl, listeners },
  });
}

/**
 * A server that started and then exited before answering. `logTail` was read
 * before the failed start was cleaned up, because for a container cleaning up
 * removes the log, which is the only explanation of why it exited.
 */
function serverExitedError(
  serverUrl: string,
  details: Record<string, unknown>,
  logTail: string | undefined,
): ZitadelError {
  return new ZitadelError(
    "E_NETWORK",
    "Local Zitadel server process exited before becoming healthy",
    {
      hint: "Inspect the local runtime logs, then retry after fixing the startup error.",
      nextCommands: [suggestion("logs"), suggestion("reset", { flags: { force: true } })],
      details: { ...details, server_url: serverUrl, ...(logTail ? { log_tail: logTail } : {}) },
    },
  );
}

/** Removes repeats while keeping order, for suggested commands. */
