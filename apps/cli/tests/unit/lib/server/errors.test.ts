import { describe, expect, it } from "vitest";

import {
  LocalServerBusyError,
  LocalServerDeniedError,
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
  LocalServerStartTimeoutError,
  LocalServerStopError,
} from "@/lib/server/errors";

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
      new LocalServerNotRespondingError("no answer"),
      "conflict",
      "E_LOCAL_SERVER_NOT_RUNNING",
    ],
    [
      "not responding elsewhere",
      new LocalServerNotRespondingElsewhereError("no answer", "/work"),
      "conflict",
      "E_LOCAL_SERVER_NOT_RUNNING",
    ],
    ["record malformed", new LocalServerRecordMalformedError("bad"), "invalid", "E_VALIDATION"],
    [
      "unreadable record",
      new LocalServerRecordUnreadableError("bad", "/r"),
      "invalid",
      "E_VALIDATION",
    ],
    ["not started", new LocalServerNotStartedError("none"), "invalid", "E_VALIDATION"],
    ["package missing", new LocalServerPackageMissingError("none"), "invalid", "E_VALIDATION"],
    ["launch failed", new LocalServerLaunchFailedError("no"), "invalid", "E_VALIDATION"],
    ["docker failed", new LocalServerDockerFailedError("no"), "invalid", "E_VALIDATION"],
    ["env unreadable", new LocalServerEnvUnreadableError("no", "/e"), "invalid", "E_VALIDATION"],
    [
      "admin unreadable",
      new LocalServerAdminUnreadableError("no", "/a"),
      "invalid",
      "E_VALIDATION",
    ],
    ["admin malformed", new LocalServerAdminMalformedError("no", "/a"), "invalid", "E_VALIDATION"],
    ["permit mismatch", new LocalServerPermitMismatchError("no"), "invalid", "E_VALIDATION"],
    [
      "processes unlistable",
      new LocalServerProcessesUnlistableError("no"),
      "invalid",
      "E_VALIDATION",
    ],
    ["stop all failed", new LocalServerStopAllFailedError("no", []), "invalid", "E_VALIDATION"],
    [
      "platform missing",
      new LocalServerPlatformMissingError("no platform"),
      "invalid",
      "E_VALIDATION",
    ],
    ["busy", new LocalServerBusyError("busy", "/lock"), "conflict", "E_CONFLICT"],
    ["stop", new LocalServerStopError("stuck"), "invalid", "E_VALIDATION"],
    ["port busy", new LocalServerPortBusyError(8080), "unavailable", "E_PORT_IN_USE"],
    ["port full", new LocalServerPortFullError("full"), "unavailable", "E_PORT_IN_USE"],
    ["docker", new LocalServerDockerMissingError("no daemon"), "unavailable", "E_NETWORK"],
    ["denied", new LocalServerDeniedError("no"), "denied", "E_AUTH"],
    ["process gone", new LocalServerProcessGoneError("gone"), "unavailable", "E_NETWORK"],
    ["process denied", new LocalServerProcessDeniedError("no"), "denied", "E_AUTH"],
    ["start exited", new LocalServerStartExitedError("exited"), "unavailable", "E_NETWORK"],
    ["start timeout", new LocalServerStartTimeoutError("late"), "unavailable", "E_NETWORK"],
    [
      "start cleanup failed",
      new LocalServerStartCleanupFailedError("stuck"),
      "unavailable",
      "E_NETWORK",
    ],
  ] as const)("states the category and code of a %s failure", (_name, error, category, code) => {
    expect(error).toBeInstanceOf(LocalServerError);
    expect(error.category).toBe(category);
    expect(error.code).toBe(code);
  });

  it("is retryable only while another start holds the lock", () => {
    expect(new LocalServerBusyError("busy", "/lock").retryable).toBe(true);
    expect(new LocalServerPortBusyError(8080).retryable).toBe(false);
    expect(new LocalServerDockerMissingError("no daemon").retryable).toBe(false);
  });

  it("keeps the cause it wraps", () => {
    const cause = new Error("no daemon");

    expect(new LocalServerDockerMissingError("Docker is not reachable", cause)).toMatchObject({
      message: "Docker is not reachable",
      cause,
    });
  });

  it("keeps the facts a command words its advice from", () => {
    expect(new LocalServerNotRespondingElsewhereError("no answer", "/work")).toMatchObject({
      directory: "/work",
    });
    expect(new LocalServerPortBusyError(8080)).toMatchObject({
      port: 8080,
    });
  });
});
