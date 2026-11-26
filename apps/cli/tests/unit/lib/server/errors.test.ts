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
