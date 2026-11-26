import { resolve } from "node:path";

import { Cmd } from "@/lib/cmd";
import { PM } from "@/lib/pm";
import {
  LocalServerAdminMalformedError,
  LocalServerAdminNotFoundError,
  LocalServerAdminUnreadableError,
  LocalServerDockerFailedError,
  LocalServerDockerMissingError,
  LocalServerLaunchFailedError,
  LocalServerNotRespondingElsewhereError,
  LocalServerNotRespondingError,
  LocalServerNotRunningError,
  LocalServerNotStartedError,
  LocalServerPackageMissingError,
  LocalServerPlatformMissingError,
  LocalServerPortBusyError,
  LocalServerPortFullError,
  LocalServerProcessesUnlistableError,
  LocalServerRecordMalformedError,
  LocalServerSessionRefusedError,
  LocalServerStartCleanupFailedError,
  LocalServerStartExitedError,
  LocalServerStartTimeoutError,
  LocalServerStopAllFailedError,
} from "@/lib/server";
import { shellCommand, type Suggested, suggestedCommandOf } from "@/lib/suggestion";
import { CliPackage } from "@/lib/upgrade";

import { type Advice, derived, type Wording } from "./wording";

/** How a run is refused when no local server was started in the folder or a parent. */
const NOT_RUNNING_ADVICE = {
  hint: "No local server has been started in this directory or a parent. Run `zitadel start`, or name a server another directory started with --server <url>.",
  next: [
    {
      id: "start",
    },
  ],
} as const satisfies Advice;

/** How a run is refused when the local server a parent folder started does not answer. */
const NOT_RESPONDING_ELSEWHERE_ADVICE = {
  hint: "No healthy local server responded at {serverUrl}. It was started in {directory}, so run `zitadel start --cwd {directory}` to bring it back.",
  next: ["{start}"],
  details: {
    server_url: "{serverUrl}",
    suggested_args: "{suggestedArgs}",
  },
} as const satisfies Advice;

/** How a run is refused when the local server this folder started does not answer. */
const NOT_RESPONDING_ADVICE = {
  hint: "No healthy local server responded at {serverUrl}. Run `zitadel start` to bring it back.",
  next: [
    {
      id: "start",
    },
  ],
} as const satisfies Advice;

/** How a run is refused when this folder's server has never been started. */
const NOT_STARTED_ADVICE = {
  hint: "Run `zitadel start` first.",
  next: [
    {
      id: "start",
    },
  ],
} as const satisfies Advice;

/** How a run is refused when the runtime record of a folder is not in the shape it is written in. */
const RECORD_MALFORMED_ADVICE = {
  hint: "{advice}",
  next: ["{reset}", "{start}"],
  details: {
    suggested_args: "{suggestedArgs}",
  },
} as const satisfies Advice;

/** How a run is refused when the local admin's credential cannot be read. */
const ADMIN_UNREADABLE_ADVICE = {
  hint: "Check that {quotedPath} is readable by you; `zitadel start` writes it owner-only.",
  details: {
    path: "{path}",
    cause: "{failure}",
  },
} as const satisfies Advice;

/** How a run is refused when the local admin's credential is not in the shape it is written in. */
const ADMIN_MALFORMED_ADVICE = {
  hint: "Delete {quotedPath} and run `zitadel reset --force`, then `zitadel start`. Both are needed: reset keeps the file, and deleting it alone leaves the server holding the old password.",
  next: ["{remove}", "{reset}", "{start}"],
  details: {
    path: "{path}",
    cause: "{failure}",
    suggested_args: "{suggestedArgs}",
  },
} as const satisfies Advice;

/** How a run is refused when the local server cannot find its local admin. */
const ADMIN_NOT_FOUND_ADVICE = {
  hint: "Check `zitadel logs` first: a server that failed the lookup reports it the same way. If the logs show no error, the local data directory predates the local admin — `zitadel reset --force` deletes the local data so `zitadel start` can import it again.",
  next: [
    {
      id: "logs",
    },
  ],
} as const satisfies Advice;

/** How a run is refused when the local server refused the admin's session. */
const SESSION_REFUSED_ADVICE = {
  hint: "Check `zitadel logs` for why the local server refused the admin's session.",
} as const satisfies Advice;

/** How a run is refused when the server npm package cannot be found. */
const PACKAGE_MISSING_ADVICE = {
  hint: "Reinstall @zitadel/cli so npm can install @zitadel/server and its platform package.",
  next: ["{reinstall}"],
  details: {
    package: "{package}",
    message: "{failure}",
  },
} as const satisfies Advice;

/** How a run is refused when the server binary was found but could not be launched. */
const LAUNCH_FAILED_ADVICE = {
  hint: "Check that the server binary exists and can be run, or reinstall @zitadel/cli.",
  next: ["{reinstall}"],
  details: {
    command: "{command}",
    message: "{failure}",
  },
} as const satisfies Advice;

/** How a run is refused when a command it ran with Docker failed. */
const DOCKER_FAILED_ADVICE = {
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
} as const satisfies Advice;

/** How a run is refused when Docker, which the managed local runtime needs, does not answer. */
const DOCKER_MISSING_ADVICE = {
  hint: "Docker is required only for the managed local runtime (`zitadel start` and `--server local`). Start Docker, then retry; or target a remote server with `--server <url>`.",
  next: [
    {
      id: "doctor",
    },
  ],
} as const satisfies Advice;

/** How a run is refused when the local server does not host the platform project. */
const PLATFORM_MISSING_ADVICE = {
  hint: "Stop it, then start it again so it boots with the platform project and the local admin.",
  next: [
    {
      id: "stop",
    },
    {
      id: "start",
    },
  ],
} as const satisfies Advice;

/** How a run is refused when some of the managed local servers did not stop. */
const STOP_ALL_FAILED_ADVICE = {
  hint: "Inspect the failed process IDs and stop them manually, then rerun `zitadel stop --all`.",
  details: {
    supported: true,
    results: "{results}",
  },
} as const satisfies Advice;

/** How a run is refused when every port it would try is held. */
const PORT_FULL_ADVICE = {
  hint: "Free a port, or pick one with `zitadel start --port <port>`.",
} as const satisfies Advice;

/** How a run is refused when the port it was asked for is held. */
const PORT_BUSY_ADVICE = {
  hint: "Stop whatever holds the port, or pick another with `zitadel start --port <port>`.",
} as const satisfies Advice;

/**
 * How a run is refused when the server it started did not become ready and
 * stopping it failed too, so it may still be running with nothing recording it.
 */
const START_CLEANUP_FAILED_ADVICE = {
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
} as const satisfies Advice;

/** How a run is refused when the server it started did not become ready. */
const START_FAILED_ADVICE = {
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
} as const satisfies Advice;

/** How a run is refused when the record cannot be read and the machine's processes cannot be listed. */
const PROCESSES_UNLISTABLE_ADVICE = {
  hint: "The local runtime record is damaged and this machine cannot list its processes, so reset cannot tell whether a server still runs on the data. Stop the local Zitadel server yourself, then run `zitadel reset --force` again.",
  details: {
    error: "{failure}",
  },
} as const satisfies Advice;

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

/** How the errors of `@/lib/server` are advised on, each for exactly its class. */
export const SERVER_WORDINGS: readonly Wording[] = [
  [LocalServerNotRunningError, NOT_RUNNING_ADVICE],
  derived(LocalServerNotRespondingElsewhereError, NOT_RESPONDING_ELSEWHERE_ADVICE, (error) => {
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
  [LocalServerNotRespondingError, NOT_RESPONDING_ADVICE],
  [LocalServerNotStartedError, NOT_STARTED_ADVICE],
  derived(LocalServerRecordMalformedError, RECORD_MALFORMED_ADVICE, (error, cwd) => {
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
  derived(LocalServerAdminUnreadableError, ADMIN_UNREADABLE_ADVICE, (error) => {
    return {
      values: {
        quotedPath: Cmd.quote(error.path),
      },
    };
  }),
  derived(LocalServerAdminMalformedError, ADMIN_MALFORMED_ADVICE, (error, cwd) => {
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
  [LocalServerAdminNotFoundError, ADMIN_NOT_FOUND_ADVICE],
  [LocalServerSessionRefusedError, SESSION_REFUSED_ADVICE],
  derived(LocalServerPackageMissingError, PACKAGE_MISSING_ADVICE, () => {
    return {
      next: {
        reinstall: REINSTALL,
      },
    };
  }),
  derived(LocalServerLaunchFailedError, LAUNCH_FAILED_ADVICE, () => {
    return {
      next: {
        reinstall: REINSTALL,
      },
    };
  }),
  derived(LocalServerDockerFailedError, DOCKER_FAILED_ADVICE, (error) => {
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
  [LocalServerDockerMissingError, DOCKER_MISSING_ADVICE],
  [LocalServerPlatformMissingError, PLATFORM_MISSING_ADVICE],
  [LocalServerStopAllFailedError, STOP_ALL_FAILED_ADVICE],
  [LocalServerPortFullError, PORT_FULL_ADVICE],
  [LocalServerPortBusyError, PORT_BUSY_ADVICE],
  [LocalServerStartCleanupFailedError, START_CLEANUP_FAILED_ADVICE],
  [LocalServerStartExitedError, START_FAILED_ADVICE],
  [LocalServerStartTimeoutError, START_FAILED_ADVICE],
  [LocalServerProcessesUnlistableError, PROCESSES_UNLISTABLE_ADVICE],
];
