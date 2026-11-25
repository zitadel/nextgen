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
  LocalServerInternalError,
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
  LocalServerRecordMalformedElsewhereError,
  LocalServerRecordMalformedError,
  LocalServerRecordUnreadableError,
  LocalServerStartExitedError,
  LocalServerStartTimeoutError,
  LocalServerStopError,
  LocalServerUrlInvalidError,
} from "@/lib/server/errors";

describe("the local server errors", () => {
  it.each([
    ["not running", new LocalServerNotRunningError({}), "conflict", "E_LOCAL_SERVER_NOT_RUNNING"],
    ["not started", new LocalServerNotStartedError(), "invalid", "E_VALIDATION"],
    [
      "not responding",
      new LocalServerNotRespondingError({
        server_url: "http://localhost:8080",
        directory: undefined,
      }),
      "conflict",
      "E_LOCAL_SERVER_NOT_RUNNING",
    ],
    [
      "not responding elsewhere",
      new LocalServerNotRespondingElsewhereError({
        server_url: "http://localhost:8080",
        directory: "/work",
      }),
      "conflict",
      "E_LOCAL_SERVER_NOT_RUNNING",
    ],
    ["record malformed", new LocalServerRecordMalformedError("bad"), "invalid", "E_VALIDATION"],
    [
      "record malformed elsewhere",
      new LocalServerRecordMalformedElsewhereError("bad", "/work"),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "admin file malformed",
      new LocalServerAdminFileMalformedError("bad", "admin.json"),
      "invalid",
      "E_VALIDATION",
    ],
    ["url invalid", new LocalServerUrlInvalidError("bad"), "invalid", "E_VALIDATION"],
    [
      "busy",
      new LocalServerBusyError({
        lock_file: "start.lock",
        owner_pid: undefined,
      }),
      "conflict",
      "E_CONFLICT",
    ],
    [
      "stop",
      new LocalServerStopError(
        "stuck",
        {},
        {
          status: "failed",
        },
      ),
      "invalid",
      "E_VALIDATION",
    ],
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
    [
      "unreadable record",
      new LocalServerRecordUnreadableError("bad", "runtime.json"),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "unreadable admin file",
      new LocalServerAdminUnreadableError("bad", "admin.json"),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "unreadable env file",
      new LocalServerEnvUnreadableError("bad", ".env"),
      "invalid",
      "E_VALIDATION",
    ],
    ["admin rejected", new LocalServerAdminRejectedError("no"), "denied", "E_AUTH"],
    ["admin session", new LocalServerAdminSessionError("no"), "denied", "E_AUTH"],
    ["platform missing", new LocalServerAdminPlatformMissingError("no"), "invalid", "E_VALIDATION"],
    [
      "start exited",
      new LocalServerStartExitedError(
        {
          port: 1,
          server_url: "http://x",
        },
        {
          status: "stopped",
        },
        {},
      ),
      "unavailable",
      "E_NETWORK",
    ],
    [
      "start timeout",
      new LocalServerStartTimeoutError(
        {
          port: 1,
          server_url: "http://x",
        },
        {
          status: "stopped",
        },
        {},
      ),
      "unavailable",
      "E_NETWORK",
    ],
    ["fault", new LocalServerInternalError("bug"), "fault", "E_VALIDATION"],
  ] as const)("states the category and code of a %s failure", (_name, error, category, code) => {
    expect(error).toBeInstanceOf(LocalServerError);
    expect(error.category).toBe(category);
    expect(error.code).toBe(code);
    expect(toZitadelError(error).code).toBe(code);
  });

  it("is retryable only while another start holds the lock", () => {
    expect(
      new LocalServerBusyError({
        lock_file: "start.lock",
        owner_pid: undefined,
      }).retryable,
    ).toBe(true);
    expect(new LocalServerPortBusyError(8080).retryable).toBe(false);
    expect(new LocalServerDockerMissingError("no daemon").retryable).toBe(false);
    expect(new LocalServerInternalError("bug").retryable).toBe(false);
  });

  it("keeps the docker detail and the cause", () => {
    const cause = new Error("no daemon");
    const error = new LocalServerDockerMissingError(cause);

    expect(error).toMatchObject({
      detail: "no daemon",
      cause,
    });
  });

  it("keeps the facts of a failed start", () => {
    const error = new LocalServerStartTimeoutError(
      {
        port: 1,
        server_url: "http://x",
      },
      {
        status: "stopped",
      },
      {
        id: 1,
      },
      "log",
    );

    expect(error).toMatchObject({
      category: "unavailable",
      logTail: "log",
    });
  });

  it("carries the hint of an invalid server address to the boundary", () => {
    const error = new LocalServerUrlInvalidError("Invalid server", {
      hint: "Use a URL.",
    });

    expect(toZitadelError(error)).toMatchObject({
      code: "E_VALIDATION",
      hint: "Use a URL.",
    });
  });

  it("states a hint that names no flag or command", () => {
    expect(
      new LocalServerNotRespondingError({
        server_url: "http://localhost:8080",
        directory: undefined,
      }).hint,
    ).toBe("No healthy local server responded at the recorded address.");
    expect(new LocalServerNotRunningError({}).hint).toBe(
      "No local server has been started in this directory or a parent.",
    );
  });

  it("keeps the facts a command words its advice from", () => {
    expect(
      new LocalServerNotRespondingError({
        server_url: "http://localhost:8080",
        directory: undefined,
      }),
    ).toMatchObject({
      serverUrl: "http://localhost:8080",
    });
    expect(
      new LocalServerNotRespondingElsewhereError({
        server_url: "http://localhost:8080",
        directory: "/work",
      }),
    ).toMatchObject({
      serverUrl: "http://localhost:8080",
      directory: "/work",
    });
    expect(
      new LocalServerBusyError({
        lock_file: "start.lock",
        owner_pid: 1,
      }),
    ).toMatchObject({
      lockFile: "start.lock",
    });
    expect(new LocalServerRecordUnreadableError("bad", "runtime.json")).toMatchObject({
      path: "runtime.json",
    });
    expect(new LocalServerAdminUnreadableError("bad", "admin.json")).toMatchObject({
      path: "admin.json",
    });
    expect(new LocalServerEnvUnreadableError("bad", ".env")).toMatchObject({
      path: ".env",
    });
    expect(new LocalServerAdminFileMalformedError("bad", "admin.json")).toMatchObject({
      path: "admin.json",
    });
    expect(new LocalServerRecordMalformedElsewhereError("bad", "/work")).toMatchObject({
      directory: "/work",
    });
  });
});
