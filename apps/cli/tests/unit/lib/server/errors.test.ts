import { describe, expect, it } from "vitest";

import { toZitadelError } from "@/lib/errors";
import {
  LocalServerAdminError,
  LocalServerBinaryError,
  LocalServerBusyError,
  LocalServerDockerMissingError,
  LocalServerNotRespondingError,
  LocalServerNotStartedError,
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
    ["down", new LocalServerNotStartedError({}), "conflict", "E_LOCAL_SERVER_NOT_RUNNING"],
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
    ["not running", new LocalServerNotStartedError({}), "E_LOCAL_SERVER_NOT_RUNNING"],
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
    [
      "a server nobody started",
      new LocalServerNotStartedError({}),
      "No local server has been started in this directory or a parent.",
      [{ id: "start", flags: {} }],
    ],
    [
      "a server that does not answer",
      new LocalServerNotRespondingError({
        server_url: "http://localhost:8080",
        directory: "/app",
      }),
      "No healthy local server responded at http://localhost:8080.",
      [{ id: "start", flags: { cwd: "/app" } }],
    ],
    [
      "a malformed record",
      new LocalServerMalformedError("record", "bad", { details: { directory: "/my dir" } }),
      "Reset the local runtime, then start it again.",
      [
        { id: "reset", flags: { force: true, cwd: "/my dir" } },
        { id: "start", flags: { cwd: "/my dir" } },
      ],
    ],
    [
      "a malformed admin file",
      new LocalServerMalformedError("admin", "bad", { details: { path: "/my dir/admin.json" } }),
      expect.stringContaining("Delete '/my dir/admin.json' and reset the local runtime"),
      [
        "rm '/my dir/admin.json'",
        { id: "reset", flags: { force: true } },
        { id: "start", flags: {} },
      ],
    ],
    [
      "an address that is malformed",
      new LocalServerMalformedError("url", "bad", { hint: "Use a URL." }),
      "Use a URL.",
      undefined,
    ],
    [
      "a file it cannot read",
      new LocalServerFileError("unreadable", "bad", { details: { path: "/p/admin.json" } }),
      "Check that /p/admin.json and its directory are readable by you.",
      undefined,
    ],
    [
      "a file in the way",
      new LocalServerFileError("blocked", "bad", { details: { path: "/p/data" } }),
      "Move or delete /p/data: something is in the way of the local data directory.",
      undefined,
    ],
    [
      "a start in progress",
      new LocalServerBusyError({ lock_file: "/p/start.lock" }),
      "Wait for it to finish, or delete /p/start.lock if no start is running.",
      undefined,
    ],
    [
      "an admin the server does not know",
      new LocalServerAdminError("rejected", "bad"),
      expect.stringContaining("Check the server log first"),
      [{ id: "logs" }],
    ],
    [
      "a platform project that is missing",
      new LocalServerAdminError("platform-missing", "bad"),
      "Stop it, then start it again so it boots with the platform project and the local admin.",
      [{ id: "stop" }, { id: "start" }],
    ],
    [
      "a Docker that is not reachable",
      new LocalServerDockerMissingError("no daemon"),
      expect.stringContaining("Docker is required only for the managed local runtime."),
      [{ id: "doctor" }],
    ],
    [
      "a held port",
      new LocalServerPortBusyError(8080),
      "Stop whatever holds the port, or start on another one.",
      undefined,
    ],
    [
      "a server that did not start",
      new LocalServerStartError(
        "timeout",
        { port: 1, server_url: "http://x" },
        { status: "stopped" },
        {},
      ),
      expect.stringContaining("Read the server log"),
      [{ id: "logs" }, { id: "start" }],
    ],
    [
      "processes that cannot be listed",
      new LocalServerStopError("unlistable", "no ps"),
      expect.stringContaining("this machine cannot list its processes"),
      undefined,
    ],
  ])("carries the hint and next commands for %s", (_name, error, hint, nextCommands) => {
    expect(error.hint).toEqual(hint);
    expect(error.nextCommands).toEqual(nextCommands);
  });

  it.each([
    ["missing", "Reinstall @zitadel/cli"],
    ["blocked", "Check that the server binary exists"],
  ] as const)("tells a %s server program to reinstall the CLI", (reason, hint) => {
    const error = new LocalServerBinaryError(reason, "gone");

    expect(error.hint).toContain(hint);
    expect(error.nextCommands).toEqual([expect.stringContaining("@zitadel/cli@latest")]);
  });

  it("says a server that would not stop did not lose its port", () => {
    expect(new LocalServerStopError("server", "why").mayBePortRace).toBe(false);
    expect(new LocalServerPortBusyError(8080).mayBePortRace).toBe(true);
  });
});
