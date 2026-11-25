import { describe, expect, it } from "vitest";

import { toZitadelError } from "@/lib/errors";
import {
  LocalServerAdminFileMalformedError,
  LocalServerAdminPlatformMissingError,
  LocalServerAdminRejectedError,
  LocalServerAdminSessionError,
  LocalServerAdminUnreadableError,
  LocalServerBinaryBlockedError,
  LocalServerBinaryMissingError,
  LocalServerBusyError,
  LocalServerDockerFailedError,
  LocalServerDockerMissingError,
  LocalServerEnvUnreadableError,
  LocalServerError,
  LocalServerNotRespondingElsewhereError,
  LocalServerNotRespondingError,
  LocalServerNotRunningError,
  LocalServerNotStartedError,
  LocalServerOrphansStopError,
  LocalServerPermitMismatchError,
  LocalServerPortBusyError,
  LocalServerPortFullError,
  LocalServerProcessesStopError,
  LocalServerProcessesUnlistableError,
  LocalServerRecordMalformedError,
  LocalServerRecordUnreadableError,
  LocalServerStartCleanupFailedError,
  LocalServerStartExitedError,
  LocalServerStartTimeoutError,
  LocalServerStopError,
  LocalServerUrlInvalidError,
} from "@/lib/server/errors";

describe("the local server errors", () => {
  it.each([
    ["not running", new LocalServerNotRunningError(), "conflict", "E_LOCAL_SERVER_NOT_RUNNING"],
    ["not started", new LocalServerNotStartedError(), "invalid", "E_VALIDATION"],
    [
      "not responding",
      new LocalServerNotRespondingError("http://localhost:8080"),
      "conflict",
      "E_LOCAL_SERVER_NOT_RUNNING",
    ],
    [
      "not responding elsewhere",
      new LocalServerNotRespondingElsewhereError("http://localhost:8080", "/work"),
      "conflict",
      "E_LOCAL_SERVER_NOT_RUNNING",
    ],
    ["record malformed", new LocalServerRecordMalformedError("bad"), "invalid", "E_VALIDATION"],
    [
      "admin file malformed",
      new LocalServerAdminFileMalformedError("bad"),
      "invalid",
      "E_VALIDATION",
    ],
    ["url invalid", new LocalServerUrlInvalidError("bad"), "invalid", "E_VALIDATION"],
    ["busy", new LocalServerBusyError("start.lock", undefined), "conflict", "E_CONFLICT"],
    ["stop", new LocalServerStopError("stuck"), "invalid", "E_VALIDATION"],
    ["processes stop", new LocalServerProcessesStopError("stuck"), "invalid", "E_VALIDATION"],
    [
      "processes unlistable",
      new LocalServerProcessesUnlistableError("no ps"),
      "invalid",
      "E_VALIDATION",
    ],
    ["port busy", new LocalServerPortBusyError(8080), "unavailable", "E_PORT_IN_USE"],
    ["port full", new LocalServerPortFullError(8080, 8179), "unavailable", "E_PORT_IN_USE"],
    ["docker", new LocalServerDockerMissingError("no daemon"), "unavailable", "E_NETWORK"],
    ["docker failed", new LocalServerDockerFailedError("failed"), "invalid", "E_VALIDATION"],
    ["permit mismatch", new LocalServerPermitMismatchError("other"), "invalid", "E_VALIDATION"],
    ["orphans stop", new LocalServerOrphansStopError("stuck"), "invalid", "E_VALIDATION"],
    ["binary missing", new LocalServerBinaryMissingError("gone"), "invalid", "E_VALIDATION"],
    ["binary blocked", new LocalServerBinaryBlockedError("gone"), "invalid", "E_VALIDATION"],
    ["unreadable record", new LocalServerRecordUnreadableError("bad"), "invalid", "E_VALIDATION"],
    [
      "unreadable admin file",
      new LocalServerAdminUnreadableError("bad"),
      "invalid",
      "E_VALIDATION",
    ],
    ["unreadable env file", new LocalServerEnvUnreadableError("bad"), "invalid", "E_VALIDATION"],
    ["admin rejected", new LocalServerAdminRejectedError("no"), "denied", "E_AUTH"],
    ["admin session", new LocalServerAdminSessionError("no"), "denied", "E_AUTH"],
    ["platform missing", new LocalServerAdminPlatformMissingError("no"), "invalid", "E_VALIDATION"],
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
    expect(toZitadelError(error).code).toBe(code);
  });

  it("is retryable only while another start holds the lock", () => {
    expect(new LocalServerBusyError("start.lock", undefined).retryable).toBe(true);
    expect(new LocalServerPortBusyError(8080).retryable).toBe(false);
    expect(new LocalServerDockerMissingError("no daemon").retryable).toBe(false);
  });

  it("names the reason Docker gave in the message and keeps it as the cause", () => {
    const cause = new Error("no daemon");
    const error = new LocalServerDockerMissingError(cause);

    expect(error).toMatchObject({
      message: "Docker is not reachable: no daemon",
      cause,
    });
  });

  it("names the lock file and its owner in the message of a busy start", () => {
    expect(new LocalServerBusyError("start.lock", 42).message).toBe(
      "Another `zitadel start` is still running in this directory; lock file start.lock, owner pid 42",
    );
  });

  it("names the range in the message of a full port range", () => {
    expect(new LocalServerPortFullError(8080, 8179).message).toBe("No free port from 8080 to 8179");
  });

  it("keeps the facts a command words its advice from", () => {
    expect(new LocalServerNotRespondingError("http://localhost:8080")).toMatchObject({
      serverUrl: "http://localhost:8080",
    });
    expect(
      new LocalServerNotRespondingElsewhereError("http://localhost:8080", "/work"),
    ).toMatchObject({
      serverUrl: "http://localhost:8080",
      directory: "/work",
    });
    expect(new LocalServerPortBusyError(8080)).toMatchObject({
      port: 8080,
    });
  });

  it("reports the message and the code of an error at the boundary", () => {
    expect(toZitadelError(new LocalServerUrlInvalidError("Invalid server"))).toMatchObject({
      code: "E_VALIDATION",
      message: "Invalid server",
    });
  });
});
