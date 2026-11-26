import { describe, expect, it } from "vitest";

import { LocalServerProgramFailedError } from "@/lib/server/errors";
import { listListeningTcpListeners, type Run, workingDirectories } from "@/lib/server/local/ports";

/**
 * A machine whose `lsof` prints `stdout`.
 *
 * @param stdout - What it prints.
 * @returns How programs are run there.
 */
function lsofSaying(stdout: string): Run {
  return async () => {
    return { stdout };
  };
}

/**
 * A machine whose `lsof` fails.
 *
 * @param error - How it fails.
 * @returns How programs are run there.
 */
function lsofFailingWith(error: Error): Run {
  return async () => {
    throw error;
  };
}

describe("listListeningTcpListeners", () => {
  it("parses loopback listeners sorted by port from lsof -F pcn output", async () => {
    const run = lsofSaying(
      // Multiple records, including a duplicate port on another host and a
      // non-loopback bind that must be filtered out. `n*:8080` (wildcard)
      // counts as loopback.
      [
        "p12345",
        "n*:8080",
        "p23456",
        "n127.0.0.1:3000",
        "p34567",
        "n[::1]:5050",
        "p45678",
        "n*:3000", // duplicate port, different host
        "p56789",
        "n192.168.1.20:9000", // external interface — must be filtered
        "",
      ].join("\n"),
    );

    const listeners = await listListeningTcpListeners({ run });

    expect(listeners.map((l) => l.port)).toEqual([3000, 3000, 5050, 8080]);
    expect(
      listeners.every((l) => l.host === "*" || l.host.includes("::1") || l.host === "127.0.0.1"),
    ).toBe(true);
  });

  it("keeps listener process metadata for diagnostics", async () => {
    const run = lsofSaying(
      ["p12345", "czitadel-server", "n*:8080", "p23456", "cnode", "n127.0.0.1:3000", ""].join("\n"),
    );

    await expect(listListeningTcpListeners({ run })).resolves.toEqual([
      { address: "127.0.0.1:3000", command: "node", host: "127.0.0.1", pid: 23456, port: 3000 },
      { address: "*:8080", command: "zitadel-server", host: "*", pid: 12345, port: 8080 },
    ]);
  });

  it("returns [] when lsof is not on PATH (ENOENT)", async () => {
    const run = lsofFailingWith(new LocalServerProgramFailedError("spawn lsof ENOENT"));

    expect(await listListeningTcpListeners({ run })).toEqual([]);
  });

  it("returns [] when lsof exits non-zero", async () => {
    const run = lsofFailingWith(
      new LocalServerProgramFailedError("Command failed with exit code 1"),
    );

    expect(await listListeningTcpListeners({ run })).toEqual([]);
  });

  it("returns [] when lsof exceeds the timeout", async () => {
    const run = lsofFailingWith(
      new LocalServerProgramFailedError("Command timed out after 1 milliseconds"),
    );

    expect(await listListeningTcpListeners({ timeoutMs: 1, run })).toEqual([]);
  });

  it("ignores malformed lines and out-of-range ports", async () => {
    const run = lsofSaying(
      [
        "garbage line with no n-prefix",
        "n", // empty address
        "nno-colon-here",
        "n*:notaport",
        "n*:99999", // out of range
        "n*:80",
        "",
      ].join("\n"),
    );

    const listeners = await listListeningTcpListeners({ run });
    expect(listeners.map((l) => l.port)).toEqual([80]);
  });
});

describe("workingDirectories", () => {
  it("reads each process's folder from lsof -F n output", async () => {
    const run = lsofSaying(
      ["p4242", "fcwd", "n/Users/me/app", "p4343", "fcwd", "n/Users/me/other app", ""].join("\n"),
    );

    await expect(workingDirectories([4242, 4343], { run })).resolves.toEqual(
      new Map([
        [4242, "/Users/me/app"],
        [4343, "/Users/me/other app"],
      ]),
    );
  });

  it("asks lsof for the folders of those processes only", async () => {
    const asked: (readonly string[])[] = [];
    const run: Run = async (_program, args) => {
      asked.push(args);
      return { stdout: "" };
    };

    await workingDirectories([4242, 4343], { run });

    expect(asked).toEqual([["-a", "-p", "4242,4343", "-d", "cwd", "-F", "n"]]);
  });

  it("runs nothing for no processes", async () => {
    const asked: (readonly string[])[] = [];
    const run: Run = async (_program, args) => {
      asked.push(args);
      return { stdout: "" };
    };

    await workingDirectories([], { run });

    expect(asked).toEqual([]);
  });

  it("leaves out a process lsof names no folder for", async () => {
    const run = lsofSaying(["p4242", "fcwd", "p4343", "fcwd", "n/Users/me/app", ""].join("\n"));

    await expect(workingDirectories([4242, 4343], { run })).resolves.toEqual(
      new Map([[4343, "/Users/me/app"]]),
    );
  });

  it("knows no folder when lsof fails", async () => {
    const run = lsofFailingWith(new LocalServerProgramFailedError("spawn lsof ENOENT"));

    await expect(workingDirectories([4242], { run })).resolves.toEqual(new Map());
  });
});
