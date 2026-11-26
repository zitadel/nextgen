import { describe, expect, it } from "vitest";

import { LocalServerUrlInvalidError } from "@/lib/server";

import {
  LocalServerBusyError,
  LocalServerAdminNotFoundError,
  LocalServerDockerMissingError,
  LocalServerError,
  LocalServerAdminMalformedError,
  LocalServerAdminUnreadableError,
  LocalServerDockerFailedError,
  LocalServerEnvUnreadableError,
  LocalServerLaunchFailedError,
  LocalServerNotStartedError,
  LocalServerPackageMissingError,
  LocalServerPermitMismatchError,
  LocalServerProcessesUnlistableError,
  LocalServerStopAllFailedError,
  LocalServerNotRespondingElsewhereError,
  LocalServerNotRespondingError,
  LocalServerNotRunningError,
  LocalServerPlatformMissingError,
  LocalServerPortBusyError,
  LocalServerPortFullError,
  LocalServerProcessDeniedError,
  LocalServerProcessGoneError,
  LocalServerRecordMalformedError,
  LocalServerRecordUnreadableError,
  LocalServerStartCleanupFailedError,
  LocalServerStartExitedError,
  LocalServerSessionRefusedError,
  LocalServerStartTimeoutError,
  LocalServerStopError,
} from "@/lib/server/errors";

import * as classes from "@/lib/server/errors";

/** The server a failed start was to answer on, for the start failures. */
const STARTED = {
  serverUrl: "http://localhost:8080",
  runtime: "binary",
} as const;

describe("the local server errors", () => {
  it.each([
    [
      "not running",
      new LocalServerNotRunningError("not running"),
      "conflict",
      "E_LOCAL_SERVER_NOT_RUNNING",
    ],
    [
      "not responding",
      new LocalServerNotRespondingError("no answer", "http://localhost:8080"),
      "conflict",
      "E_LOCAL_SERVER_NOT_RUNNING",
    ],
    [
      "not responding elsewhere",
      new LocalServerNotRespondingElsewhereError("no answer", "/work", "http://localhost:8080"),
      "conflict",
      "E_LOCAL_SERVER_NOT_RUNNING",
    ],
    [
      "record malformed",
      new LocalServerRecordMalformedError("bad", "/work"),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "unreadable record",
      new LocalServerRecordUnreadableError("bad", "/r", new Error("denied")),
      "invalid",
      "E_VALIDATION",
    ],
    ["not started", new LocalServerNotStartedError("none"), "invalid", "E_VALIDATION"],
    [
      "package missing",
      new LocalServerPackageMissingError("none", "@zitadel/server", new Error("gone")),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "launch failed",
      new LocalServerLaunchFailedError("no", "/bin/zitadel", new Error("denied")),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "docker failed",
      new LocalServerDockerFailedError("no", ["docker"], "no"),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "env unreadable",
      new LocalServerEnvUnreadableError("no", "/e", new Error("denied")),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "admin unreadable",
      new LocalServerAdminUnreadableError("no", "/a", new Error("denied")),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "admin malformed",
      new LocalServerAdminMalformedError("no", "/a", "/"),
      "invalid",
      "E_VALIDATION",
    ],
    ["permit mismatch", new LocalServerPermitMismatchError("no"), "invalid", "E_VALIDATION"],
    [
      "processes unlistable",
      new LocalServerProcessesUnlistableError("no", undefined),
      "invalid",
      "E_VALIDATION",
    ],
    ["stop all failed", new LocalServerStopAllFailedError("no", []), "invalid", "E_VALIDATION"],
    [
      "platform missing",
      new LocalServerPlatformMissingError("no platform", "http://localhost:8080"),
      "invalid",
      "E_VALIDATION",
    ],
    ["busy", new LocalServerBusyError("busy", "/lock", 4242), "conflict", "E_CONFLICT"],
    ["stop", new LocalServerStopError("stuck", {}), "invalid", "E_VALIDATION"],
    ["port busy", new LocalServerPortBusyError(8080), "unavailable", "E_PORT_IN_USE"],
    ["port full", new LocalServerPortFullError("full", 8080), "unavailable", "E_PORT_IN_USE"],
    [
      "docker",
      new LocalServerDockerMissingError("no daemon", "no daemon"),
      "unavailable",
      "E_NETWORK",
    ],
    ["admin not found", new LocalServerAdminNotFoundError("no"), "denied", "E_AUTH"],
    ["session refused", new LocalServerSessionRefusedError("no", 401), "denied", "E_AUTH"],
    ["process gone", new LocalServerProcessGoneError("gone"), "unavailable", "E_NETWORK"],
    ["process denied", new LocalServerProcessDeniedError("no"), "denied", "E_AUTH"],
    [
      "start exited",
      new LocalServerStartExitedError("exited", STARTED),
      "unavailable",
      "E_NETWORK",
    ],
    [
      "start timeout",
      new LocalServerStartTimeoutError("late", STARTED),
      "unavailable",
      "E_NETWORK",
    ],
    [
      "start cleanup failed",
      new LocalServerStartCleanupFailedError("stuck", STARTED, "timeout", {}),
      "unavailable",
      "E_NETWORK",
    ],
  ] as const)("states the category and code of a %s failure", (_name, error, category, code) => {
    expect(error).toBeInstanceOf(LocalServerError);
    expect(error.category).toBe(category);
    expect(error.code).toBe(code);
  });

  it("is retryable only while another start holds the lock", () => {
    expect(new LocalServerBusyError("busy", "/lock", 4242).retryable).toBe(true);
    expect(new LocalServerPortBusyError(8080).retryable).toBe(false);
    expect(new LocalServerDockerMissingError("no daemon", "no daemon").retryable).toBe(false);
  });

  it("keeps the cause it wraps", () => {
    const cause = new Error("no daemon");

    expect(
      new LocalServerDockerMissingError("Docker is not reachable", "no daemon", cause),
    ).toMatchObject({
      message: "Docker is not reachable",
      cause,
    });
  });

  it("keeps the facts a command words its advice from", () => {
    expect(
      new LocalServerNotRespondingElsewhereError("no answer", "/work", "http://localhost:8080"),
    ).toMatchObject({
      directory: "/work",
    });
    expect(new LocalServerPortBusyError(8080)).toMatchObject({
      port: 8080,
    });
  });
});

describe("what a local server error states", () => {
  it("says to check that an unreadable record can be read", () => {
    const error = new LocalServerRecordUnreadableError(
      "cannot be read",
      "/w/.zitadel/local/runtime.json",
      new Error("EACCES"),
    );

    expect(error).toMatchObject({
      hint: "Check that /w/.zitadel/local/runtime.json and its directory are readable by you.",
      details: { path: "/w/.zitadel/local/runtime.json", cause: "EACCES" },
    });
  });

  it("says to fix an env file it cannot read", () => {
    const error = new LocalServerEnvUnreadableError(
      "Cannot read /w/.env",
      "/w/.env",
      new Error("EACCES"),
    );

    expect(error).toMatchObject({
      hint: "The file /w/.env exists but could not be read; fix its permissions or remove it.",
      details: { path: "/w/.env", message: "EACCES" },
    });
  });

  it("says to wait for the start that holds the lock", () => {
    const error = new LocalServerBusyError("busy", "/w/.zitadel/local/start.lock", 42);

    expect(error).toMatchObject({
      hint: "Wait for it to finish, or delete /w/.zitadel/local/start.lock if no start is running.",
      details: { lock_file: "/w/.zitadel/local/start.lock", owner_pid: 42 },
    });
  });

  it.each([
    [
      "a permit for another folder",
      new LocalServerPermitMismatchError("for /other"),
      "A reset acts on one folder only. Run it from the folder whose server you mean to reset.",
    ],
    [
      "a server that did not stop",
      new LocalServerStopError("did not stop", {}),
      "Inspect the local runtime process and stop it manually, then rerun the command.",
    ],
    [
      "an address that is no URL",
      new LocalServerUrlInvalidError("Invalid server"),
      "Use a URL like https://preview.zitadel.com.",
    ],
  ] as const)("states the hint of %s", (_situation, error, hint) => {
    expect(error.hint).toBe(hint);
  });

  it("reports a refused signal as the operating system's error", () => {
    const cause = Object.assign(new Error("kill EPERM"), { code: "EPERM" });

    expect(new LocalServerProcessDeniedError("Permission denied: kill EPERM", cause)).toMatchObject(
      {
        hint: "Check file permissions or run with the right user.",
        details: { original: { name: "Error", message: "kill EPERM", code: "EPERM" } },
      },
    );
  });
});

describe("what each local server error states", () => {
  it.each([
    [
      "LocalServerNotRunningError",
      new classes.LocalServerNotRunningError("not running"),
      {
        message: "not running",
        hint: undefined,
        details: {},
        code: "E_LOCAL_SERVER_NOT_RUNNING",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "LocalServerNotRespondingError",
      new classes.LocalServerNotRespondingError("not responding", "http://localhost:8080"),
      {
        message: "not responding",
        hint: undefined,
        details: { server_url: "http://localhost:8080" },
        code: "E_LOCAL_SERVER_NOT_RUNNING",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "LocalServerNotRespondingElsewhereError",
      new classes.LocalServerNotRespondingElsewhereError(
        "not responding",
        "/work/app",
        "http://localhost:8080",
      ),
      {
        message: "not responding",
        hint: undefined,
        details: { directory: "/work/app", server_url: "http://localhost:8080" },
        code: "E_LOCAL_SERVER_NOT_RUNNING",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "LocalServerNotStartedError",
      new classes.LocalServerNotStartedError("not started"),
      {
        message: "not started",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "LocalServerPackageMissingError",
      new classes.LocalServerPackageMissingError(
        "package missing",
        "@zitadel/server-darwin-arm64",
        new Error("boom"),
      ),
      {
        message: "package missing",
        hint: undefined,
        details: { package: "@zitadel/server-darwin-arm64", failure: "boom" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "LocalServerLaunchFailedError",
      new classes.LocalServerLaunchFailedError("launch failed", "/bin/zitadel", new Error("boom")),
      {
        message: "launch failed",
        hint: undefined,
        details: { command: "/bin/zitadel", failure: "boom" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "LocalServerDockerFailedError",
      new classes.LocalServerDockerFailedError("docker failed", ["docker", "run"], "no such image"),
      {
        message: "docker failed",
        hint: undefined,
        details: { command: ["docker", "run"], stderr: "no such image" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "LocalServerEnvUnreadableError",
      new classes.LocalServerEnvUnreadableError("env unreadable", "/work/.env", new Error("boom")),
      {
        message: "env unreadable",
        hint: "The file /work/.env exists but could not be read; fix its permissions or remove it.",
        details: { path: "/work/.env", message: "boom" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "LocalServerAdminUnreadableError",
      new classes.LocalServerAdminUnreadableError(
        "admin unreadable",
        "/work/admin.json",
        new Error("boom"),
      ),
      {
        message: "admin unreadable",
        hint: undefined,
        details: { path: "/work/admin.json", failure: "boom" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "LocalServerAdminMalformedError",
      new classes.LocalServerAdminMalformedError("admin malformed", "/work/admin.json", "/work"),
      {
        message: "admin malformed",
        hint: undefined,
        details: { path: "/work/admin.json", directory: "/work" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "LocalServerPermitMismatchError",
      new classes.LocalServerPermitMismatchError("permit mismatch"),
      {
        message: "permit mismatch",
        hint: "A reset acts on one folder only. Run it from the folder whose server you mean to reset.",
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "LocalServerProcessesUnlistableError",
      new classes.LocalServerProcessesUnlistableError("cannot list", "ps failed"),
      {
        message: "cannot list",
        hint: undefined,
        details: { failure: "ps failed" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "LocalServerStopAllFailedError",
      new classes.LocalServerStopAllFailedError("stop all failed", []),
      {
        message: "stop all failed",
        hint: undefined,
        details: { results: [] },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "LocalServerUrlInvalidError",
      new classes.LocalServerUrlInvalidError("bad url"),
      {
        message: "bad url",
        hint: "Use a URL like https://preview.zitadel.com.",
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "LocalServerPlatformMissingError",
      new classes.LocalServerPlatformMissingError("no platform", "http://localhost:8080"),
      {
        message: "no platform",
        hint: undefined,
        details: { server_url: "http://localhost:8080" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "LocalServerBusyError",
      new classes.LocalServerBusyError("busy", "/work/.lock", 42),
      {
        message: "busy",
        hint: "Wait for it to finish, or delete /work/.lock if no start is running.",
        details: { lock_file: "/work/.lock", owner_pid: 42 },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: true,
      },
    ],
    [
      "LocalServerDockerMissingError",
      new classes.LocalServerDockerMissingError("no docker", "docker: command not found"),
      {
        message: "no docker",
        hint: undefined,
        details: { detail: "docker: command not found" },
        code: "E_NETWORK",
        category: "unavailable",
        retryable: false,
      },
    ],
    [
      "LocalServerProgramFailedError",
      new classes.LocalServerProgramFailedError("program failed", new Error("boom")),
      {
        message: "program failed",
        hint: undefined,
        details: {},
        code: "E_NETWORK",
        category: "unavailable",
        retryable: false,
      },
    ],
    [
      "LocalServerProcessGoneError",
      new classes.LocalServerProcessGoneError("gone"),
      {
        message: "gone",
        hint: undefined,
        details: {},
        code: "E_NETWORK",
        category: "unavailable",
        retryable: false,
      },
    ],
    [
      "LocalServerProcessDeniedError",
      new classes.LocalServerProcessDeniedError("denied"),
      {
        message: "denied",
        hint: "Check file permissions or run with the right user.",
        details: {
          original: { name: "LocalServerProcessDeniedError", message: "denied", code: undefined },
        },
        code: "E_AUTH",
        category: "denied",
        retryable: false,
      },
    ],
    [
      "LocalServerAdminNotFoundError",
      new classes.LocalServerAdminNotFoundError("no admin"),
      {
        message: "no admin",
        hint: undefined,
        details: {},
        code: "E_AUTH",
        category: "denied",
        retryable: false,
      },
    ],
    [
      "LocalServerSessionRefusedError",
      new classes.LocalServerSessionRefusedError("refused", 401),
      {
        message: "refused",
        hint: undefined,
        details: { status: 401 },
        code: "E_AUTH",
        category: "denied",
        retryable: false,
      },
    ],
    [
      "LocalServerPortFullError",
      new classes.LocalServerPortFullError("ports full", 8080),
      {
        message: "ports full",
        hint: undefined,
        details: { first_port: 8080 },
        code: "E_PORT_IN_USE",
        category: "unavailable",
        retryable: false,
      },
    ],
    [
      "LocalServerRecordMalformedError",
      new classes.LocalServerRecordMalformedError("record malformed", "/work"),
      {
        message: "record malformed",
        hint: undefined,
        details: { directory: "/work" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "LocalServerStopError",
      new classes.LocalServerStopError("stop failed", {}),
      {
        message: "stop failed",
        hint: "Inspect the local runtime process and stop it manually, then rerun the command.",
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "LocalServerRecordUnreadableError",
      new classes.LocalServerRecordUnreadableError(
        "record unreadable",
        "/work/record.json",
        new Error("boom"),
      ),
      {
        message: "record unreadable",
        hint: "Check that /work/record.json and its directory are readable by you.",
        details: { path: "/work/record.json", cause: "boom" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "LocalServerPortBusyError",
      new classes.LocalServerPortBusyError(8080),
      {
        message: "Port 8080 is already in use",
        hint: undefined,
        details: { port: 8080 },
        code: "E_PORT_IN_USE",
        category: "unavailable",
        retryable: false,
      },
    ],
    [
      "LocalServerStartExitedError",
      new classes.LocalServerStartExitedError("exited", {
        serverUrl: "http://localhost:8080",
        runtime: "binary",
        pid: 7,
        logPath: "/work/log",
        logTail: "panic",
      }),
      {
        message: "exited",
        hint: undefined,
        details: {
          server_url: "http://localhost:8080",
          log_tail: "panic",
          runtime: "binary",
          pid: 7,
          log_path: "/work/log",
        },
        code: "E_NETWORK",
        category: "unavailable",
        retryable: false,
      },
    ],
    [
      "LocalServerStartTimeoutError",
      new classes.LocalServerStartTimeoutError("timed out", {
        serverUrl: "http://localhost:8080",
        runtime: "docker",
        containerName: "zitadel",
      }),
      {
        message: "timed out",
        hint: undefined,
        details: {
          server_url: "http://localhost:8080",
          runtime: "docker",
          container_name: "zitadel",
        },
        code: "E_NETWORK",
        category: "unavailable",
        retryable: false,
      },
    ],
    [
      "LocalServerStartCleanupFailedError",
      new classes.LocalServerStartCleanupFailedError(
        "cleanup failed",
        { serverUrl: "http://localhost:8080", runtime: "binary" },
        "timeout",
        { stopped: false },
      ),
      {
        message: "cleanup failed",
        hint: undefined,
        details: {
          server_url: "http://localhost:8080",
          runtime: "binary",
          reason: "timeout",
          stop_result: { stopped: false },
        },
        code: "E_NETWORK",
        category: "unavailable",
        retryable: false,
      },
    ],
  ])("states what a %s says and reports", (_name, error, expected) => {
    expect({
      message: error.message,
      hint: error.hint,
      details: error.details,
      code: error.code,
      category: error.category,
      retryable: error.retryable,
    }).toEqual(expected);
  });
});
