import { describe, expect, it } from "vitest";

import { toZitadelError } from "@/lib/errors";
import {
  LocalServerAdminError,
  LocalServerBinaryError,
  LocalServerBusyError,
  LocalServerDockerMissingError,
  LocalServerDownError,
  LocalServerError,
  LocalServerFileError,
  LocalServerInternalError,
  LocalServerMalformedError,
  LocalServerPortBusyError,
  LocalServerPortFullError,
  LocalServerStartError,
  LocalServerStopError,
} from "@/lib/server/errors";

describe("the local server errors", () => {
  it.each([
    ["down", new LocalServerDownError("not-running", {}), "conflict", "E_LOCAL_SERVER_NOT_RUNNING"],
    ["malformed", new LocalServerMalformedError("record", "bad"), "invalid", "E_VALIDATION"],
    ["busy", new LocalServerBusyError({}), "unavailable", "E_CONFLICT"],
    ["stop", new LocalServerStopError("server", "stuck"), "conflict", "E_CONFLICT"],
    [
      "unlistable",
      new LocalServerStopError("unlistable", "no ps"),
      "invalid",
      "E_UNSUPPORTED_PROJECT_SHAPE",
    ],
    ["port busy", new LocalServerPortBusyError(8080), "unavailable", "E_PORT_IN_USE"],
    ["port full", new LocalServerPortFullError(8080, 8179), "unavailable", "E_PORT_IN_USE"],
    ["docker", new LocalServerDockerMissingError("no daemon"), "unavailable", "E_NETWORK"],
    ["binary", new LocalServerBinaryError("missing", "gone"), "invalid", "E_VALIDATION"],
    ["blocked file", new LocalServerFileError("blocked", "in the way"), "conflict", "E_CONFLICT"],
    ["admin", new LocalServerAdminError("rejected", "no"), "denied", "E_AUTH"],
    ["platform", new LocalServerAdminError("platform-missing", "no"), "invalid", "E_VALIDATION"],
    ["fault", new LocalServerInternalError("bug"), "fault", "E_VALIDATION"],
  ] as const)("reports a %s failure by its category and code", (_name, error, category, code) => {
    expect(error).toBeInstanceOf(LocalServerError);
    expect(error.category).toBe(category);
    expect(toZitadelError(error).code).toBe(code);
  });

  it("is retryable only while another start holds the lock or a server is still starting", () => {
    expect(new LocalServerBusyError({}).retryable).toBe(true);
    expect(new LocalServerPortBusyError(8080).retryable).toBe(false);
    expect(new LocalServerDockerMissingError("no daemon").retryable).toBe(false);
    expect(new LocalServerInternalError("bug").retryable).toBe(false);
  });

  it("reports a file the OS refused to read as an auth failure", () => {
    const error = new LocalServerFileError("unreadable", "cannot read", {
      cause: Object.assign(new Error("denied"), { code: "EACCES" }),
    });

    expect(error.category).toBe("denied");
  });

  it("reports a file that cannot be read for another reason as invalid", () => {
    const error = new LocalServerFileError("unreadable", "cannot read", {
      cause: Object.assign(new Error("io"), { code: "EIO" }),
    });

    expect(error.category).toBe("invalid");
  });

  it("keeps the docker detail and the cause", () => {
    const cause = new Error("no daemon");
    const error = new LocalServerDockerMissingError(cause);

    expect(error).toMatchObject({ detail: "no daemon", cause });
  });

  it("keeps the facts of a failed start", () => {
    const error = new LocalServerStartError(
      "timeout",
      { port: 1, server_url: "http://x" },
      { status: "stopped" },
      { id: 1 },
      "log",
    );

    expect(error).toMatchObject({ category: "unavailable", reason: "timeout", logTail: "log" });
  });

  it("carries the hint of a malformed server address to the boundary", () => {
    const error = new LocalServerMalformedError("url", "Invalid server", { hint: "Use a URL." });

    expect(toZitadelError(error)).toMatchObject({ code: "E_VALIDATION", hint: "Use a URL." });
  });
});

describe("the local server errors' codes", () => {
  it.each([
    ["not running", new LocalServerDownError("not-running", {}), "E_LOCAL_SERVER_NOT_RUNNING"],
    ["another start", new LocalServerBusyError({}), "E_CONFLICT"],
    ["a held port", new LocalServerPortBusyError(8080), "E_PORT_IN_USE"],
    ["no free port", new LocalServerPortFullError(8080, 8090), "E_PORT_IN_USE"],
    [
      "processes that cannot be listed",
      new LocalServerStopError("unlistable", "why"),
      "E_UNSUPPORTED_PROJECT_SHAPE",
    ],
    ["a server that would not stop", new LocalServerStopError("server", "why"), "E_CONFLICT"],
    ["a malformed record", new LocalServerMalformedError("record", "why"), "E_VALIDATION"],
  ] as const)("reports %s as %s", (_name, error, code) => {
    expect(error.code).toBe(code);
  });

  it.each([
    [new LocalServerDownError("not-responding", {}), "not-responding"],
    [new LocalServerMalformedError("url", "why"), undefined],
    [new LocalServerStopError("processes", "why"), "processes-did-not-stop"],
    [new LocalServerPortBusyError(8080), "port-in-use"],
  ] as const)("names the advice that fits %#", (error, advice) => {
    expect(error.advice).toBe(advice);
  });

  it("says a server that would not stop did not lose its port", () => {
    expect(new LocalServerStopError("server", "why").mayBePortRace).toBe(false);
    expect(new LocalServerPortBusyError(8080).mayBePortRace).toBe(true);
  });
});
