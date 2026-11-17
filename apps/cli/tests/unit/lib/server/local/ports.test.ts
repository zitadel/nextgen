import { describe, expect, it } from "vitest";

import { listListeningTcpListeners, type Run } from "@/lib/server/local/ports";

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
    const enoent: NodeJS.ErrnoException = Object.assign(new Error("spawn lsof ENOENT"), {
      code: "ENOENT",
    });
    const run = lsofFailingWith(enoent);

    expect(await listListeningTcpListeners({ run })).toEqual([]);
  });

  it("returns [] when lsof exits non-zero", async () => {
    const failure: NodeJS.ErrnoException = Object.assign(new Error("Command failed"), {
      code: "1",
    });
    const run = lsofFailingWith(failure);

    expect(await listListeningTcpListeners({ run })).toEqual([]);
  });

  it("returns [] when lsof exceeds the timeout", async () => {
    // execa's timeout error has code "ETIMEDOUT" / signal.
    const timedOut: NodeJS.ErrnoException = Object.assign(new Error("timeout"), {
      code: "ETIMEDOUT",
    });
    const run = lsofFailingWith(timedOut);

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
