import { Cmd } from "@/lib/cmd";
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
  LocalServerStartExitedError,
  LocalServerStartTimeoutError,
  LocalServerStopAllFailedError,
  LocalServerStopError,
  LocalServerUrlInvalidError,
  ZitadelRuntime,
} from "@/lib/server";
import { shellCommand, suggestedCommandOf } from "@/lib/suggestion";
import { CliPackage } from "@/lib/upgrade";

import type { Row } from "./row";

/** The folder a parent's record sits in, which is not the run's own. */
const PARENT = "/work";

/** The address every sampled record names. */
const SERVER_URL = "http://localhost:8080";

/** The runtime record of the run's folder. */
const RUNTIME_FILE = "/work/app/.zitadel/local/runtime.json";

/** The local admin file of the run's folder. */
const ADMIN_FILE = "/work/app/.zitadel/local/admin.json";

/** The local admin file of the parent folder. */
const PARENT_ADMIN_FILE = "/work/.zitadel/local/admin.json";

/** The env file the server reads. */
const ENV_FILE = "/work/app/.env";

/** The start lock of the run's folder. */
const LOCK_FILE = "/work/app/.zitadel/local/start.lock";

/** What reading a file the process may not read says. */
const EACCES_MESSAGE = `EACCES: permission denied, open '${RUNTIME_FILE}'`;

/** What the parser said of a broken admin file. */
const ADMIN_PARSE_MESSAGE = "Unexpected token 'x', \"x\" is not valid JSON";

/** What the server logged before it failed to start. */
const LOG_TAIL = 'level=fatal msg="database locked"\n';

/** The process the samples stop or signal. */
const PID = 4242;

/** The log of the sampled binary server. */
const LOG_PATH = "/work/app/.zitadel/local/server.log";

/** The record of the sampled binary server. */
const BINARY_RECORD = {
  backend: "binary",
  pid: PID,
  server_url: SERVER_URL,
  log_path: LOG_PATH,
} as const;

/** What stopping the sampled server came to. */
const FAILED_STOP = {
  pid: PID,
  signal: "SIGKILL",
  status: "failed",
  target: "process-group",
} as const;

/** The managed process the samples stop. */
const MANAGED_PROCESS = {
  command: "zitadel-server start",
  data_dir: "/work/app/.zitadel/local/data",
  kind: "server-binary",
  pid: PID,
} as const;

/** What stopping each managed process came to. */
const STOP_RESULTS = [{ process: MANAGED_PROCESS, stop_result: FAILED_STOP }];

/** What the lifecycle knew of the sampled server when it did not become ready. */
const STARTED = {
  serverUrl: SERVER_URL,
  logTail: LOG_TAIL,
  runtime: "binary",
  pid: PID,
  logPath: LOG_PATH,
} as const;

/** What main's launcher described the binary server as. */
const BINARY_DESCRIPTION = { runtime: "binary", pid: PID, log_path: LOG_PATH };

/** The hint main gave a server that did not become ready. */
const START_FAILED_HINT =
  "Read `zitadel logs` for why the server did not become healthy, then run `zitadel start` again.";

/** The command that reinstalls the CLI, which main suggested for a missing or broken server binary. */
const REINSTALL = suggestedCommandOf(PM.named("npm").add([`${CliPackage.NAME}@latest`]));

/** The hint main gave when Docker did not answer. */
const DOCKER_UNAVAILABLE_HINT =
  "Docker is required only for the managed local runtime (`zitadel start` and `--server local`). Start Docker, then retry; or target a remote server with `--server <url>`.";

/** The hint main gave when a Docker command failed. */
const DOCKER_FAILED_HINT =
  "Check that Docker is installed, running, and reachable from this shell.";

/** The hint main gave when a server it had to stop kept running. */
const DID_NOT_STOP_HINT =
  "Inspect the local runtime process and stop it manually, then rerun the command.";

/** The hint main gave a malformed admin file. */
const ADMIN_MALFORMED_HINT = (path: string): string => {
  return `Delete ${Cmd.quote(path)} and run \`zitadel reset --force\`, then \`zitadel start\`. Both are needed: reset keeps the file, and deleting it alone leaves the server holding the old password.`;
};

/**
 * An errno error as Node raises it.
 *
 * @param message - What it says.
 * @param code - Its errno code.
 * @returns The error.
 */
function errno(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/** The errors of `@/lib/server`, each with what main showed for it. */
export const SERVER_ROWS: readonly Row[] = [
  {
    error: new LocalServerNotRunningError("Local Zitadel server is not running"),
    main: "lib/server/local/runtime.ts:431",
    expected: {
      code: "E_LOCAL_SERVER_NOT_RUNNING",
      message: "Local Zitadel server is not running",
      hint: "No local server has been started in this directory or a parent. Run `zitadel start`, or name a server another directory started with --server <url>.",
      details: {},
      next: [{ id: "start" }],
      exitCode: 4,
    },
    deviation: {
      reason:
        "main's details was an empty object made of an undefined server_url; there is no fact to report",
      shown: { details: undefined },
    },
  },
  {
    error: new LocalServerNotRespondingError("Local Zitadel server is not running", SERVER_URL),
    main: "lib/server/local/runtime.ts:424",
    expected: {
      code: "E_LOCAL_SERVER_NOT_RUNNING",
      message: "Local Zitadel server is not running",
      hint: `No healthy local server responded at ${SERVER_URL}. Run \`zitadel start\` to bring it back.`,
      details: { server_url: SERVER_URL },
      next: [{ id: "start" }],
      exitCode: 4,
    },
  },
  {
    error: new LocalServerNotRespondingElsewhereError(
      "Local Zitadel server is not running",
      PARENT,
      SERVER_URL,
    ),
    main: "lib/server/local/runtime.ts:424",
    expected: {
      code: "E_LOCAL_SERVER_NOT_RUNNING",
      message: "Local Zitadel server is not running",
      hint: `No healthy local server responded at ${SERVER_URL}. It was started in ${Cmd.quote(PARENT)}, so run \`zitadel start --cwd ${Cmd.quote(PARENT)}\` to bring it back.`,
      details: { server_url: SERVER_URL, suggested_args: [["start", "--cwd", PARENT]] },
      next: [{ id: "start", flags: { cwd: PARENT } }],
      exitCode: 4,
    },
  },
  {
    error: new LocalServerNotStartedError("Local Zitadel runtime has not been started"),
    main: "lib/server/zitadel-runtime.ts:1409",
    expected: {
      code: "E_VALIDATION",
      message: "Local Zitadel runtime has not been started",
      hint: "Run `zitadel start` first.",
      next: [{ id: "start" }],
      exitCode: 3,
    },
  },
  {
    case: "a record whose folder cannot be checked",
    error: new LocalServerRecordUnreadableError(
      `${RUNTIME_FILE} cannot be read`,
      RUNTIME_FILE,
      errno(EACCES_MESSAGE, "EACCES"),
    ),
    main: "lib/server/local/runtime.ts:279",
    expected: {
      code: "E_VALIDATION",
      message: `${RUNTIME_FILE} cannot be read`,
      hint: `Check that ${Cmd.quote(RUNTIME_FILE)} and its directory are readable by you.`,
      details: { path: RUNTIME_FILE, cause: EACCES_MESSAGE },
      exitCode: 3,
    },
  },
  {
    case: "a record that cannot be read",
    error: new LocalServerRecordUnreadableError(
      `${RUNTIME_FILE} cannot be read`,
      RUNTIME_FILE,
      errno(EACCES_MESSAGE, "EACCES"),
    ),
    main: "lib/fs.ts:46",
    expected: {
      code: "E_AUTH",
      message: `Permission denied: ${EACCES_MESSAGE}`,
      hint: "Check file permissions or run with the right user.",
      details: {
        original: { name: "Error", message: EACCES_MESSAGE, code: "EACCES" },
      },
      exitCode: 1,
    },
    deviation: {
      reason:
        "main let readFile's raw EACCES through unwrapped; the branch reports it as the unreadable record it is",
      shown: {
        code: "E_VALIDATION",
        message: `${RUNTIME_FILE} cannot be read`,
        hint: `Check that ${Cmd.quote(RUNTIME_FILE)} and its directory are readable by you.`,
        details: { path: RUNTIME_FILE, cause: EACCES_MESSAGE },
        exitCode: 3,
      },
    },
  },
  {
    case: "a record in the run's folder",
    error: new LocalServerRecordMalformedError(
      ".zitadel/local/runtime.json is malformed",
      "/work/app",
    ),
    main: "lib/server/local/runtime.ts:610",
    expected: {
      code: "E_VALIDATION",
      message: ".zitadel/local/runtime.json is malformed",
      hint: "Run `zitadel reset --force`, then `zitadel start`.",
      details: { schema_version: 2 },
      next: [{ id: "reset", flags: { force: true } }, { id: "start" }],
      exitCode: 3,
    },
    deviation: {
      reason:
        "main echoed the malformed record's raw fields into details; the branch does not report an unvalidated record",
      shown: { details: undefined },
    },
  },
  {
    case: "a record in a parent folder",
    error: new LocalServerRecordMalformedError(".zitadel/local/runtime.json is malformed", PARENT),
    main: "lib/server/local/runtime.ts:610",
    expected: {
      code: "E_VALIDATION",
      message: ".zitadel/local/runtime.json is malformed",
      hint: "Reset the local runtime, then start it again, each with the --cwd of the directory that holds it.",
      details: {
        schema_version: 2,
        suggested_args: [
          ["reset", "--force", "--cwd", PARENT],
          ["start", "--cwd", PARENT],
        ],
      },
      next: [
        { id: "reset", flags: { force: true, cwd: PARENT } },
        { id: "start", flags: { cwd: PARENT } },
      ],
      exitCode: 3,
    },
    deviation: {
      reason:
        "main echoed the malformed record's raw fields into details; the branch does not report an unvalidated record",
      shown: {
        details: {
          suggested_args: [
            ["reset", "--force", "--cwd", PARENT],
            ["start", "--cwd", PARENT],
          ],
        },
      },
    },
  },
  {
    error: new LocalServerAdminUnreadableError(
      ".zitadel/local/admin.json cannot be read",
      ADMIN_FILE,
      errno(EACCES_MESSAGE, "EACCES"),
    ),
    main: "lib/server/local/admin-credential.ts:82",
    expected: {
      code: "E_VALIDATION",
      message: ".zitadel/local/admin.json cannot be read",
      hint: `Check that ${Cmd.quote(ADMIN_FILE)} is readable by you; \`zitadel start\` writes it owner-only.`,
      details: { path: ADMIN_FILE, cause: EACCES_MESSAGE },
      exitCode: 3,
    },
  },
  {
    case: "an admin file that is not JSON",
    error: new LocalServerAdminMalformedError(
      ".zitadel/local/admin.json is malformed",
      ADMIN_FILE,
      "/work/app",
      new SyntaxError(ADMIN_PARSE_MESSAGE),
    ),
    main: "lib/server/local/admin-credential.ts:120",
    expected: {
      code: "E_VALIDATION",
      message: ".zitadel/local/admin.json is malformed",
      hint: ADMIN_MALFORMED_HINT(ADMIN_FILE),
      details: { path: ADMIN_FILE, cause: ADMIN_PARSE_MESSAGE },
      next: [
        shellCommand("rm", Cmd.quote(ADMIN_FILE)),
        { id: "reset", flags: { force: true } },
        { id: "start" },
      ],
      exitCode: 3,
    },
  },
  {
    case: "an admin file without the admin's fields",
    error: new LocalServerAdminMalformedError(
      ".zitadel/local/admin.json is malformed",
      ADMIN_FILE,
      "/work/app",
    ),
    main: "lib/server/local/admin-credential.ts:127",
    expected: {
      code: "E_VALIDATION",
      message: ".zitadel/local/admin.json is malformed",
      hint: ADMIN_MALFORMED_HINT(ADMIN_FILE),
      details: { path: ADMIN_FILE },
      next: [
        shellCommand("rm", Cmd.quote(ADMIN_FILE)),
        { id: "reset", flags: { force: true } },
        { id: "start" },
      ],
      exitCode: 3,
    },
  },
  {
    case: "an admin file in a parent folder",
    error: new LocalServerAdminMalformedError(
      ".zitadel/local/admin.json is malformed",
      PARENT_ADMIN_FILE,
      PARENT,
    ),
    main: "lib/server/local/admin-credential.ts:127",
    expected: {
      code: "E_VALIDATION",
      message: ".zitadel/local/admin.json is malformed",
      hint: ADMIN_MALFORMED_HINT(PARENT_ADMIN_FILE),
      details: {
        path: PARENT_ADMIN_FILE,
        suggested_args: [
          ["reset", "--force", "--cwd", PARENT],
          ["start", "--cwd", PARENT],
        ],
      },
      next: [
        shellCommand("rm", Cmd.quote(PARENT_ADMIN_FILE)),
        { id: "reset", flags: { force: true, cwd: PARENT } },
        { id: "start", flags: { cwd: PARENT } },
      ],
      exitCode: 3,
    },
  },
  {
    error: new LocalServerAdminNotFoundError("The local server could not find the local admin"),
    main: "lib/server/local/sign-in.ts:171",
    expected: {
      code: "E_AUTH",
      message: "The local server could not find the local admin",
      hint: "Check `zitadel logs` first: a server that failed the lookup reports it the same way. If the logs show no error, the local data directory predates the local admin — `zitadel reset --force` deletes the local data so `zitadel start` can import it again.",
      next: [{ id: "logs" }],
      exitCode: 1,
    },
  },
  {
    error: new LocalServerSessionRefusedError("Local admin session exchange failed (401)", 401),
    main: "lib/server/local/sign-in.ts:95",
    expected: {
      code: "E_AUTH",
      message: "Local admin session exchange failed (401)",
      hint: "Check `zitadel logs` for why the local server refused the admin's session.",
      details: { status: 401 },
      exitCode: 1,
    },
  },
  {
    error: new LocalServerEnvUnreadableError(
      `Cannot read ${ENV_FILE}`,
      ENV_FILE,
      errno(`EACCES: permission denied, open '${ENV_FILE}'`, "EACCES"),
    ),
    main: "lib/server/local/env-vars.ts:101",
    expected: {
      code: "E_VALIDATION",
      message: `Cannot read ${ENV_FILE}`,
      hint: `The file ${Cmd.quote(ENV_FILE)} exists but could not be read; fix its permissions or remove it.`,
      details: { path: ENV_FILE, message: `EACCES: permission denied, open '${ENV_FILE}'` },
      exitCode: 3,
    },
  },
  {
    case: "a server binary that cannot be found",
    error: new LocalServerPackageMissingError(
      "Zitadel server npm package is not available",
      "@zitadel/server",
      new Error("Cannot find module '@zitadel/server-darwin-arm64'"),
    ),
    main: "lib/server/local/internal/binary-launcher.ts:258",
    expected: {
      code: "E_VALIDATION",
      message: "Zitadel server npm package is not available",
      hint: "Reinstall @zitadel/cli so npm can install @zitadel/server and its platform package.",
      details: {
        package: "@zitadel/server",
        message: "Cannot find module '@zitadel/server-darwin-arm64'",
      },
      next: [REINSTALL],
      exitCode: 3,
    },
  },
  {
    case: "a server package without its manifest",
    error: new LocalServerPackageMissingError(
      "Zitadel server npm package is not available",
      "@zitadel/server",
      new Error("Cannot find module '@zitadel/server/package.json'"),
    ),
    main: "lib/server/local/internal/binary-launcher.ts:258",
    expected: {
      code: "E_VALIDATION",
      message: "Zitadel server npm package is not available",
      hint: "Reinstall @zitadel/cli so npm can install @zitadel/server and its platform package.",
      details: {
        package: "@zitadel/server",
        message: "Missing @zitadel/server. Reinstall @zitadel/cli.",
      },
      next: [REINSTALL],
      exitCode: 3,
    },
    deviation: {
      reason:
        "main's details.message was its own wrapper text, a reinstall hint; the branch reports what resolving the package failed with",
      shown: {
        details: {
          package: "@zitadel/server",
          message: "Cannot find module '@zitadel/server/package.json'",
        },
      },
    },
  },
  {
    error: new LocalServerLaunchFailedError(
      "The Zitadel server could not be started",
      "/opt/zitadel/bin/zitadel",
      errno("spawn /opt/zitadel/bin/zitadel EACCES", "EACCES"),
    ),
    main: "lib/server/local/internal/binary-launcher.ts:530",
    expected: {
      code: "E_VALIDATION",
      message: "The Zitadel server could not be started",
      hint: "Check that the server binary exists and can be run, or reinstall @zitadel/cli.",
      details: {
        command: "/opt/zitadel/bin/zitadel",
        message: "spawn /opt/zitadel/bin/zitadel EACCES",
      },
      next: [REINSTALL],
      exitCode: 3,
    },
  },
  {
    case: "a Docker command that exited non-zero",
    error: new LocalServerDockerFailedError(
      "Pull Docker image zitadel:latest failed",
      ["docker", "pull", "--quiet", "zitadel:latest"],
      "manifest unknown",
    ),
    main: "lib/server/local/internal/docker-launcher.ts:468",
    expected: {
      code: "E_VALIDATION",
      message: "Pull Docker image zitadel:latest failed",
      hint: DOCKER_FAILED_HINT,
      details: {
        command: ["docker", "pull", "--quiet", "zitadel:latest"],
        stderr: "manifest unknown",
      },
      next: [{ id: "doctor" }],
      exitCode: 3,
    },
  },
  {
    case: "a Docker command that could not run",
    error: new LocalServerDockerFailedError(
      "Inspect Docker image zitadel:latest failed",
      ["docker", "image", "inspect", "zitadel:latest"],
      undefined,
      new Error("docker went away"),
    ),
    main: "lib/server/local/internal/docker-launcher.ts:473",
    expected: {
      code: "E_VALIDATION",
      message: "Inspect Docker image zitadel:latest failed",
      hint: DOCKER_FAILED_HINT,
      details: {
        command: ["docker", "image", "inspect", "zitadel:latest"],
        cause: new Error("docker went away"),
      },
      next: [{ id: "doctor" }],
      exitCode: 3,
    },
    deviation: {
      reason:
        "main put the raw Error in details, which JSON renders as {}; the branch reports its name, message and errno",
      shown: {
        details: {
          command: ["docker", "image", "inspect", "zitadel:latest"],
          cause: { name: "Error", message: "docker went away", code: undefined },
        },
      },
    },
  },
  {
    case: "a Docker daemon that does not answer",
    error: new LocalServerDockerMissingError(
      "Docker is not reachable",
      "Cannot connect to the Docker daemon",
    ),
    main: "lib/server/zitadel-runtime.ts:1141",
    expected: {
      code: "E_NETWORK",
      message: "Docker is not reachable",
      hint: DOCKER_UNAVAILABLE_HINT,
      details: { detail: "Cannot connect to the Docker daemon" },
      next: [{ id: "doctor" }],
      exitCode: 4,
    },
  },
  {
    case: "no docker on PATH",
    error: new LocalServerDockerMissingError(
      "Docker is not reachable",
      "spawn docker ENOENT",
      errno("spawn docker ENOENT", "ENOENT"),
    ),
    main: "lib/server/zitadel-runtime.ts:1138",
    expected: {
      code: "E_NETWORK",
      message: "Docker is not reachable",
      hint: DOCKER_UNAVAILABLE_HINT,
      details: { detail: "spawn docker ENOENT" },
      next: [{ id: "doctor" }],
      exitCode: 4,
    },
  },
  {
    error: new LocalServerBusyError(
      "Another `zitadel start` is still running in this directory",
      LOCK_FILE,
      PID,
    ),
    main: "lib/server/local/internal/start-lock.ts:180",
    expected: {
      code: "E_CONFLICT",
      message: "Another `zitadel start` is still running in this directory",
      hint: `Wait for it to finish, or delete ${LOCK_FILE} if no start is running.`,
      details: { lock_file: LOCK_FILE, owner_pid: PID },
      exitCode: 5,
    },
  },
  {
    error: new LocalServerPlatformMissingError(
      "The local server does not host the platform project, so the local admin cannot sign in",
      SERVER_URL,
    ),
    main: "lib/server/local/sign-in.ts:116",
    expected: {
      code: "E_VALIDATION",
      message:
        "The local server does not host the platform project, so the local admin cannot sign in",
      hint: "Stop it, then start it again so it boots with the platform project and the local admin.",
      details: { server_url: SERVER_URL },
      next: [{ id: "stop" }, { id: "start" }],
      exitCode: 3,
    },
  },
  {
    error: new LocalServerStopAllFailedError(
      "Some managed local runtime processes did not stop",
      STOP_RESULTS,
    ),
    main: "lib/server/zitadel-runtime.ts:842",
    expected: {
      code: "E_VALIDATION",
      message: "Some managed local runtime processes did not stop",
      hint: "Inspect the failed process IDs and stop them manually, then rerun `zitadel stop --all`.",
      details: { supported: true, results: STOP_RESULTS },
      exitCode: 3,
    },
  },
  {
    error: new LocalServerPortFullError("No free port from 8080 to 8179", 8080),
    main: "lib/server/local/internal/lifecycle.ts:597",
    expected: {
      code: "E_PORT_IN_USE",
      message: "No free port from 8080 to 8179",
      hint: "Free a port, or pick one with `zitadel start --port <port>`.",
      details: { first_port: 8080 },
      exitCode: 5,
    },
  },
  {
    error: new LocalServerPortBusyError(8080),
    main: "lib/server/local/internal/lifecycle.ts:572",
    expected: {
      code: "E_PORT_IN_USE",
      message: "Port 8080 is already in use",
      hint: "Stop whatever holds the port, or pick another with `zitadel start --port <port>`.",
      details: { port: 8080 },
      exitCode: 5,
    },
  },
  {
    error: new LocalServerStartExitedError("The server exited before it became healthy", STARTED),
    main: "lib/server/local/internal/lifecycle.ts:543",
    expected: {
      code: "E_NETWORK",
      message: "The server exited before it became healthy",
      hint: START_FAILED_HINT,
      details: BINARY_DESCRIPTION,
      next: [{ id: "logs" }, { id: "start" }],
      exitCode: 4,
    },
  },
  {
    error: new LocalServerStartTimeoutError("The server did not become healthy in time", STARTED),
    main: "lib/server/local/internal/lifecycle.ts:543",
    expected: {
      code: "E_NETWORK",
      message: "The server did not become healthy in time",
      hint: START_FAILED_HINT,
      details: BINARY_DESCRIPTION,
      next: [{ id: "logs" }, { id: "start" }],
      exitCode: 4,
    },
  },
  {
    error: new LocalServerStartCleanupFailedError(
      "The server did not become healthy in time",
      STARTED,
      "timeout",
      FAILED_STOP,
    ),
    main: "lib/server/local/internal/lifecycle.ts:543",
    expected: {
      code: "E_NETWORK",
      message: "The server did not become healthy in time",
      hint: START_FAILED_HINT,
      details: BINARY_DESCRIPTION,
      next: [{ id: "logs" }, { id: "start" }],
      exitCode: 4,
    },
    deviation: {
      reason:
        "main told a failed cleanup apart only in start's catch; the branch's class carries that catch's advice wherever it surfaces",
      shown: {
        hint: "Inspect the local runtime process and stop it manually, then rerun `zitadel start`.",
        next: [
          { id: "logs" },
          { id: "reset", flags: { force: true } },
          { id: "stop", flags: { all: true } },
        ],
      },
    },
  },
  {
    error: new LocalServerProcessesUnlistableError(
      "The local runtime record cannot be read and the machine's processes cannot be listed",
      "spawn ps ENOENT",
    ),
    main: "lib/server/zitadel-runtime.ts:1287",
    expected: {
      code: "E_VALIDATION",
      message:
        "The local runtime record cannot be read and the machine's processes cannot be listed",
      hint: "The local runtime record is damaged and this machine cannot list its processes, so reset cannot tell whether a server still runs on the data. Stop the local Zitadel server yourself, then run `zitadel reset --force` again.",
      details: { error: "spawn ps ENOENT" },
      exitCode: 3,
    },
  },
  {
    error: new LocalServerPermitMismatchError("The permit is for /work/other, not /work/app"),
    main: "lib/server/zitadel-runtime.ts:1259",
    expected: {
      code: "E_VALIDATION",
      message: "The permit is for /work/other, not /work/app",
      hint: "A reset acts on one folder only. Run it from the folder whose server you mean to reset.",
      exitCode: 3,
    },
  },
  {
    case: "a server a start had to replace",
    error: new LocalServerStopError("The server did not stop", {
      runtime: BINARY_RECORD,
      stopResult: FAILED_STOP,
    }),
    main: "lib/server/local/internal/lifecycle.ts:438",
    expected: {
      code: "E_VALIDATION",
      message: "The server did not stop",
      hint: DID_NOT_STOP_HINT,
      details: { runtime: BINARY_RECORD, stop_result: FAILED_STOP },
      exitCode: 3,
    },
  },
  {
    case: "processes a reset found on the data",
    error: new LocalServerStopError("Local Zitadel server did not stop", {
      stopResults: STOP_RESULTS,
    }),
    main: "lib/server/zitadel-runtime.ts:1328",
    expected: {
      code: "E_VALIDATION",
      message: "Local Zitadel server did not stop",
      hint: DID_NOT_STOP_HINT,
      details: { stop_results: STOP_RESULTS },
      exitCode: 3,
    },
  },
  {
    case: "the recorded server a stop named",
    error: new LocalServerStopError("Local Zitadel server did not stop", {
      runtime: BINARY_RECORD,
      stopResult: FAILED_STOP,
    }),
    main: "lib/server/zitadel-runtime.ts:1434",
    expected: {
      code: "E_VALIDATION",
      message: "Local Zitadel server did not stop",
      hint: DID_NOT_STOP_HINT,
      details: { runtime: BINARY_RECORD, stop_result: FAILED_STOP },
      exitCode: 3,
    },
  },
  {
    case: "a value that is not a URL",
    error: new LocalServerUrlInvalidError('Invalid server "not a url"'),
    main: "lib/server/zitadel-runtime.ts:200",
    expected: {
      code: "E_VALIDATION",
      message: 'Invalid server "not a url"',
      hint: `Use a URL like ${ZitadelRuntime.DEFAULT}.`,
      exitCode: 3,
    },
  },
  {
    case: "a URL that is not http(s)",
    error: new LocalServerUrlInvalidError("Server URL must use http(s): ftp://example.com"),
    main: "lib/server/zitadel-runtime.ts:206",
    expected: {
      code: "E_VALIDATION",
      message: "Server URL must use http(s): ftp://example.com",
      hint: `Use a URL like ${ZitadelRuntime.DEFAULT}.`,
      exitCode: 3,
    },
  },
  {
    error: new LocalServerProgramFailedError(
      "Command failed with exit code 1: lsof -iTCP -sTCP:LISTEN -P -n -F pcn",
      new Error("Command failed with exit code 1: lsof -iTCP -sTCP:LISTEN -P -n -F pcn"),
    ),
    main: "lib/server/local/ports.ts:18",
    expected: {
      code: "E_VALIDATION",
      message: "Command failed with exit code 1: lsof -iTCP -sTCP:LISTEN -P -n -F pcn",
      details: {
        original: {
          name: "ExecaError",
          message: "Command failed with exit code 1: lsof -iTCP -sTCP:LISTEN -P -n -F pcn",
        },
      },
      exitCode: 3,
    },
    deviation: {
      reason:
        "main never failed here (it read a program that could not answer as no listeners); the branch's typed failure is caught by its callers",
      shown: {
        code: "E_NETWORK",
        details: undefined,
        exitCode: 4,
      },
    },
  },
  {
    error: new LocalServerProcessGoneError(
      `No process ${String(PID)}`,
      errno("kill ESRCH", "ESRCH"),
    ),
    main: "lib/server/local/internal/binary-launcher.ts:578",
    expected: {
      code: "E_VALIDATION",
      message: "kill ESRCH",
      details: {
        original: { name: "Error", message: "kill ESRCH", code: "ESRCH" },
      },
      exitCode: 3,
    },
    deviation: {
      reason:
        "main read a missing process as false and never failed; the branch's typed failure is caught by its callers",
      shown: {
        code: "E_NETWORK",
        message: `No process ${String(PID)}`,
        details: undefined,
        exitCode: 4,
      },
    },
  },
  {
    error: new LocalServerProcessDeniedError(
      `Process ${String(PID)} is not ours to signal`,
      errno("kill EPERM", "EPERM"),
    ),
    main: "lib/server/local/internal/binary-launcher.ts:581",
    expected: {
      code: "E_AUTH",
      message: "Permission denied: kill EPERM",
      hint: "Check file permissions or run with the right user.",
      details: {
        original: { name: "Error", message: "kill EPERM", code: "EPERM" },
      },
      exitCode: 1,
    },
  },
];
