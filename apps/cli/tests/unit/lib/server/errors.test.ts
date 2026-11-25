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
    [
      "down",
      new LocalServerDownError("not-running", {}),
      "precondition",
      "E_LOCAL_SERVER_NOT_RUNNING",
    ],
    ["malformed", new LocalServerMalformedError("record", "bad"), "validation", "E_VALIDATION"],
    ["busy", new LocalServerBusyError({}), "conflict", "E_CONFLICT"],
    ["stop", new LocalServerStopError("server", "stuck"), "conflict", "E_CONFLICT"],
    [
      "unlistable",
      new LocalServerStopError("unlistable", "no ps"),
      "unsupported",
      "E_UNSUPPORTED_PROJECT_SHAPE",
    ],
    ["port busy", new LocalServerPortBusyError(8080), "conflict", "E_PORT_IN_USE"],
    ["port full", new LocalServerPortFullError(8080, 8179), "conflict", "E_PORT_IN_USE"],
    ["docker", new LocalServerDockerMissingError("no daemon"), "unavailable", "E_NETWORK"],
    ["binary", new LocalServerBinaryError("missing", "gone"), "precondition", "E_VALIDATION"],
    ["blocked file", new LocalServerFileError("blocked", "in the way"), "conflict", "E_CONFLICT"],
    ["admin", new LocalServerAdminError("rejected", "no"), "auth", "E_AUTH"],
    [
      "platform",
      new LocalServerAdminError("platform-missing", "no"),
      "precondition",
      "E_VALIDATION",
    ],
    ["internal", new LocalServerInternalError("bug"), "internal", "E_VALIDATION"],
  ] as const)("reports a %s failure by its category and code", (_name, error, category, code) => {
    expect(error).toBeInstanceOf(LocalServerError);
    expect(error.category).toBe(category);
    expect(toZitadelError(error).code).toBe(code);
  });

  it("reports a file the OS refused to read as an auth failure", () => {
    const error = new LocalServerFileError("unreadable", "cannot read", {
      cause: Object.assign(new Error("denied"), { code: "EACCES" }),
    });

    expect(error.category).toBe("auth");
  });

  it("reports a file that cannot be read for another reason as a precondition", () => {
    const error = new LocalServerFileError("unreadable", "cannot read", {
      cause: Object.assign(new Error("io"), { code: "EIO" }),
    });

    expect(error.category).toBe("precondition");
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
