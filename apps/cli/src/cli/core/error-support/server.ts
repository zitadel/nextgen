import { resolve } from "node:path";

import { Cmd } from "@/lib/cmd";
import { errorMessage } from "@/lib/errors";
import { PM } from "@/lib/pm";
import {
  LocalServerAdminMalformedError,
  LocalServerAdminNotFoundError,
  LocalServerAdminUnreadableError,
  LocalServerBusyError,
  LocalServerDockerFailedError,
  LocalServerDockerMissingError,
  LocalServerEnvUnreadableError,
  LocalServerLaunchFailedError,
  LocalServerNotRespondingElsewhereError,
  LocalServerNotRespondingError,
  LocalServerNotRunningError,
  LocalServerNotStartedError,
  LocalServerPackageMissingError,
  LocalServerPermitMismatchError,
  LocalServerPlatformMissingError,
  LocalServerPortBusyError,
  LocalServerPortFullError,
  LocalServerProcessDeniedError,
  LocalServerProcessesUnlistableError,
  LocalServerProcessGoneError,
  LocalServerProgramFailedError,
  LocalServerRecordMalformedError,
  LocalServerRecordUnreadableError,
  LocalServerSessionRefusedError,
  LocalServerStartCleanupFailedError,
  LocalServerStartFailedError,
  LocalServerStopAllFailedError,
  LocalServerStopError,
  LocalServerUrlInvalidError,
  ZitadelRuntime,
} from "@/lib/server";
import { shellCommand, type Suggested, suggestedCommandOf } from "@/lib/suggestion";
import { CliPackage } from "@/lib/upgrade";

import type { Refusal } from "@/cli/core/refusal";
import { derived, type Wording } from "./wording";

/** How a run is refused when no local server was started in the folder or a parent. */
const NOT_RUNNING_REFUSAL = {
  message: "{message}",
  hint: "No local server has been started in this directory or a parent. Run `zitadel start`, or name a server another directory started with --server <url>.",
  next: [
    {
      id: "start",
    },
  ],
} as const satisfies Refusal;

/** How a run is refused when the local server a parent folder started does not answer. */
const NOT_RESPONDING_ELSEWHERE_REFUSAL = {
  message: "{message}",
  hint: "No healthy local server responded at {serverUrl}. It was started in {directory}, so run `zitadel start --cwd {directory}` to bring it back.",
  next: ["{start}"],
  details: {
    server_url: "{serverUrl}",
    suggested_args: "{suggestedArgs}",
  },
} as const satisfies Refusal;

/** How a run is refused when the local server this folder started does not answer. */
const NOT_RESPONDING_REFUSAL = {
  message: "{message}",
  hint: "No healthy local server responded at {serverUrl}. Run `zitadel start` to bring it back.",
  next: [
    {
      id: "start",
    },
  ],
} as const satisfies Refusal;

/** How a run is refused when this folder's server has never been started. */
const NOT_STARTED_REFUSAL = {
  message: "{message}",
  hint: "Run `zitadel start` first.",
  next: [
    {
      id: "start",
    },
  ],
} as const satisfies Refusal;

/** How a run is refused when the runtime record of a folder cannot be read. */
const RECORD_UNREADABLE_REFUSAL = {
  message: "{message}",
  hint: "Check that {quotedPath} and its directory are readable by you.",
  details: {
    path: "{path}",
    cause: "{failure}",
  },
} as const satisfies Refusal;

/** How a run is refused when the runtime record of a folder is not in the shape it is written in. */
const RECORD_MALFORMED_REFUSAL = {
  message: "{message}",
  hint: "{advice}",
  next: ["{reset}", "{start}"],
  details: {
    suggested_args: "{suggestedArgs}",
  },
} as const satisfies Refusal;

/** How a run is refused when the local admin's credential cannot be read. */
const ADMIN_UNREADABLE_REFUSAL = {
  message: "{message}",
  hint: "Check that {quotedPath} is readable by you; `zitadel start` writes it owner-only.",
  details: {
    path: "{path}",
    cause: "{failure}",
  },
} as const satisfies Refusal;

/** How a run is refused when the local admin's credential is not in the shape it is written in. */
const ADMIN_MALFORMED_REFUSAL = {
  message: "{message}",
  hint: "Delete {quotedPath} and run `zitadel reset --force`, then `zitadel start`. Both are needed: reset keeps the file, and deleting it alone leaves the server holding the old password.",
  next: ["{remove}", "{reset}", "{start}"],
  details: {
    path: "{path}",
    cause: "{failure}",
    suggested_args: "{suggestedArgs}",
  },
} as const satisfies Refusal;

/** How a run is refused when the local server cannot find its local admin. */
const ADMIN_NOT_FOUND_REFUSAL = {
  message: "{message}",
  hint: "Check `zitadel logs` first: a server that failed the lookup reports it the same way. If the logs show no error, the local data directory predates the local admin — `zitadel reset --force` deletes the local data so `zitadel start` can import it again.",
  next: [
    {
      id: "logs",
    },
  ],
} as const satisfies Refusal;

/** How a run is refused when the local server refused the admin's session. */
const SESSION_REFUSED_REFUSAL = {
  message: "{message}",
  hint: "Check `zitadel logs` for why the local server refused the admin's session.",
} as const satisfies Refusal;

/** How a run is refused when an environment file the server reads cannot be read. */
const ENV_UNREADABLE_REFUSAL = {
  message: "{message}",
  hint: "The file {quotedPath} exists but could not be read; fix its permissions or remove it.",
  details: {
    path: "{path}",
    message: "{failure}",
  },
} as const satisfies Refusal;

/** How a run is refused when the server npm package cannot be found. */
const PACKAGE_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Reinstall @zitadel/cli so npm can install @zitadel/server and its platform package.",
  next: ["{reinstall}"],
  details: {
    package: "{package}",
    message: "{failure}",
  },
} as const satisfies Refusal;

/** How a run is refused when the server binary was found but could not be launched. */
const LAUNCH_FAILED_REFUSAL = {
  message: "{message}",
  hint: "Check that the server binary exists and can be run, or reinstall @zitadel/cli.",
  next: ["{reinstall}"],
  details: {
    command: "{command}",
    message: "{failure}",
  },
} as const satisfies Refusal;

/** How a run is refused when a command it ran with Docker failed. */
const DOCKER_FAILED_REFUSAL = {
  message: "{message}",
  hint: "Check that Docker is installed, running, and reachable from this shell.",
  next: [
    {
      id: "doctor",
    },
  ],
  details: {
    command: "{command}",
    stderr: "{stderr}",
    cause: "{original}",
  },
} as const satisfies Refusal;

/** How a run is refused when Docker, which the managed local runtime needs, does not answer. */
const DOCKER_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Docker is required only for the managed local runtime (`zitadel start` and `--server local`). Start Docker, then retry; or target a remote server with `--server <url>`.",
  next: [
    {
      id: "doctor",
    },
  ],
} as const satisfies Refusal;

/** How a run is refused when another start in the folder still holds its lock. */
const BUSY_REFUSAL = {
  message: "{message}",
  hint: "Wait for it to finish, or delete {quotedLockFile} if no start is running.",
} as const satisfies Refusal;

/** How a run is refused when the local server does not host the platform project. */
const PLATFORM_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Stop it, then start it again so it boots with the platform project and the local admin.",
  next: [
    {
      id: "stop",
    },
    {
      id: "start",
    },
  ],
} as const satisfies Refusal;

/** How a run is refused when some of the managed local servers did not stop. */
const STOP_ALL_FAILED_REFUSAL = {
  message: "{message}",
  hint: "Inspect the failed process IDs and stop them manually, then rerun `zitadel stop --all`.",
  details: {
    supported: true,
    results: "{results}",
  },
} as const satisfies Refusal;

/** How a run is refused when every port it would try is held. */
const PORT_FULL_REFUSAL = {
  message: "{message}",
  hint: "Free a port, or pick one with `zitadel start --port <port>`.",
} as const satisfies Refusal;

/** How a run is refused when the port it was asked for is held. */
const PORT_BUSY_REFUSAL = {
  message: "{message}",
  hint: "Stop whatever holds the port, or pick another with `zitadel start --port <port>`.",
} as const satisfies Refusal;

/**
 * How a run is refused when the server it started did not become ready and
 * stopping it failed too, so it may still be running with nothing recording it.
 */
const START_CLEANUP_FAILED_REFUSAL = {
  message: "{message}",
  hint: "Inspect the local runtime process and stop it manually, then rerun `zitadel start`.",
  next: [
    {
      id: "logs",
    },
    {
      id: "reset",
      flags: {
        force: true,
      },
    },
    {
      id: "stop",
      flags: {
        all: true,
      },
    },
  ],
  details: {
    runtime: "{runtime}",
    pid: "{pid}",
    log_path: "{logPath}",
    container_name: "{containerName}",
  },
} as const satisfies Refusal;

/** How a run is refused when the server it started did not become ready. */
const START_FAILED_REFUSAL = {
  message: "{message}",
  hint: "Read `zitadel logs` for why the server did not become healthy, then run `zitadel start` again.",
  next: [
    {
      id: "logs",
    },
    {
      id: "start",
    },
  ],
  details: {
    runtime: "{runtime}",
    pid: "{pid}",
    log_path: "{logPath}",
    container_name: "{containerName}",
  },
} as const satisfies Refusal;

/** How a run is refused when the record cannot be read and the machine's processes cannot be listed. */
const PROCESSES_UNLISTABLE_REFUSAL = {
  message: "{message}",
  hint: "The local runtime record is damaged and this machine cannot list its processes, so reset cannot tell whether a server still runs on the data. Stop the local Zitadel server yourself, then run `zitadel reset --force` again.",
  details: {
    error: "{failure}",
  },
} as const satisfies Refusal;

/** How a reset is refused when its permit is for another folder. */
const PERMIT_MISMATCH_REFUSAL = {
  message: "{message}",
  hint: "A reset acts on one folder only. Run it from the folder whose server you mean to reset.",
} as const satisfies Refusal;

/** How a run is refused when a server it had to stop was still running afterwards. */
const STOP_REFUSAL = {
  message: "{message}",
  hint: "Inspect the local runtime process and stop it manually, then rerun the command.",
} as const satisfies Refusal;

/** How a server address that is not an http(s) URL is refused. */
const URL_INVALID_REFUSAL = {
  message: "{message}",
  hint: "Use a URL like {example}.",
} as const satisfies Refusal;

/** How a program the CLI ran to read the machine failed. */
const PROGRAM_FAILED_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How a process the CLI was to stop that is not there is refused. */
const PROCESS_GONE_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How a process the operating system will not let the CLI signal is refused. */
const PROCESS_DENIED_REFUSAL = {
  message: "Permission denied: {refused}",
  hint: "Check file permissions or run with the right user.",
  details: {
    original: "{original}",
  },
} as const satisfies Refusal;

/** The command that reinstalls the CLI, which brings the server binary with it. */
const REINSTALL = suggestedCommandOf(PM.named("npm").add([`${CliPackage.NAME}@latest`]));

/** The hint for a malformed record in the run's own folder. */
const RECORD_MALFORMED_HERE = "Run `zitadel reset --force`, then `zitadel start`.";

/** The hint for a malformed record in another folder than the run's. */
const RECORD_MALFORMED_ELSEWHERE =
  "Reset the local runtime, then start it again, each with the --cwd of the directory that holds it.";

/**
 * The reset and start that replace a folder's local state, aimed at that folder
 * when it is not the run's, with the arguments that spell them.
 *
 * @param directory - The folder that holds the state.
 * @param cwd - The folder the run acts on.
 * @returns Whether the folder is another, the follow-ups, and their arguments when it is.
 */
function replacement(
  directory: string,
  cwd: string,
): Readonly<{
  elsewhere: boolean;
  reset: Suggested;
  start: Suggested;
  suggestedArgs: readonly (readonly string[])[] | undefined;
}> {
  if (resolve(directory) === resolve(cwd)) {
    return {
      elsewhere: false,
      reset: {
        id: "reset",
        flags: {
          force: true,
        },
      },
      start: {
        id: "start",
      },
      suggestedArgs: undefined,
    };
  }
  return {
    elsewhere: true,
    reset: {
      id: "reset",
      flags: {
        force: true,
        cwd: directory,
      },
    },
    start: {
      id: "start",
      flags: {
        cwd: directory,
      },
    },
    suggestedArgs: [
      ["reset", "--force", "--cwd", directory],
      ["start", "--cwd", directory],
    ],
  };
}

/** How the errors of `@/lib/server` are worded, most specific class first. */
export const SERVER_WORDINGS: readonly Wording[] = [
  [LocalServerNotRunningError, NOT_RUNNING_REFUSAL],
  derived(LocalServerNotRespondingElsewhereError, NOT_RESPONDING_ELSEWHERE_REFUSAL, (error) => {
    return {
      values: {
        directory: Cmd.quote(error.directory),
        suggestedArgs: [["start", "--cwd", error.directory]],
      },
      next: {
        start: {
          id: "start",
          flags: {
            cwd: error.directory,
          },
        },
      },
    };
  }),
  [LocalServerNotRespondingError, NOT_RESPONDING_REFUSAL],
  [LocalServerNotStartedError, NOT_STARTED_REFUSAL],
  derived(LocalServerRecordUnreadableError, RECORD_UNREADABLE_REFUSAL, (error) => {
    return {
      values: {
        quotedPath: Cmd.quote(error.path),
      },
    };
  }),
  derived(LocalServerRecordMalformedError, RECORD_MALFORMED_REFUSAL, (error, cwd) => {
    const { elsewhere, reset, start, suggestedArgs } = replacement(error.directory, cwd);
    return {
      values: {
        advice: elsewhere ? RECORD_MALFORMED_ELSEWHERE : RECORD_MALFORMED_HERE,
        suggestedArgs,
      },
      next: {
        reset,
        start,
      },
    };
  }),
  derived(LocalServerAdminUnreadableError, ADMIN_UNREADABLE_REFUSAL, (error) => {
    return {
      values: {
        quotedPath: Cmd.quote(error.path),
      },
    };
  }),
  derived(LocalServerAdminMalformedError, ADMIN_MALFORMED_REFUSAL, (error, cwd) => {
    const { reset, start, suggestedArgs } = replacement(error.directory, cwd);
    return {
      values: {
        quotedPath: Cmd.quote(error.path),
        suggestedArgs,
      },
      next: {
        remove: shellCommand("rm", Cmd.quote(error.path)),
        reset,
        start,
      },
    };
  }),
  [LocalServerAdminNotFoundError, ADMIN_NOT_FOUND_REFUSAL],
  [LocalServerSessionRefusedError, SESSION_REFUSED_REFUSAL],
  derived(LocalServerEnvUnreadableError, ENV_UNREADABLE_REFUSAL, (error) => {
    return {
      values: {
        quotedPath: Cmd.quote(error.path),
      },
    };
  }),
  derived(LocalServerPackageMissingError, PACKAGE_MISSING_REFUSAL, () => {
    return {
      next: {
        reinstall: REINSTALL,
      },
    };
  }),
  derived(LocalServerLaunchFailedError, LAUNCH_FAILED_REFUSAL, () => {
    return {
      next: {
        reinstall: REINSTALL,
      },
    };
  }),
  derived(LocalServerDockerFailedError, DOCKER_FAILED_REFUSAL, (error) => {
    // Docker's stderr says why it failed; only a run that printed none reports what was raised.
    if (error.stderr === undefined) {
      return {};
    }
    return {
      values: {
        original: undefined,
      },
    };
  }),
  [LocalServerDockerMissingError, DOCKER_MISSING_REFUSAL],
  derived(LocalServerBusyError, BUSY_REFUSAL, (error) => {
    return {
      values: {
        quotedLockFile: Cmd.quote(error.lockFile),
      },
    };
  }),
  [LocalServerPlatformMissingError, PLATFORM_MISSING_REFUSAL],
  [LocalServerStopAllFailedError, STOP_ALL_FAILED_REFUSAL],
  [LocalServerPortFullError, PORT_FULL_REFUSAL],
  [LocalServerPortBusyError, PORT_BUSY_REFUSAL],
  [LocalServerStartCleanupFailedError, START_CLEANUP_FAILED_REFUSAL],
  [LocalServerStartFailedError, START_FAILED_REFUSAL],
  [LocalServerProcessesUnlistableError, PROCESSES_UNLISTABLE_REFUSAL],
  [LocalServerPermitMismatchError, PERMIT_MISMATCH_REFUSAL],
  [LocalServerStopError, STOP_REFUSAL],
  derived(LocalServerUrlInvalidError, URL_INVALID_REFUSAL, () => {
    return {
      values: {
        example: ZitadelRuntime.DEFAULT,
      },
    };
  }),
  [LocalServerProgramFailedError, PROGRAM_FAILED_REFUSAL],
  [LocalServerProcessGoneError, PROCESS_GONE_REFUSAL],
  derived(LocalServerProcessDeniedError, PROCESS_DENIED_REFUSAL, (error) => {
    return {
      values: {
        refused: errorMessage(error.cause),
      },
    };
  }),
];
