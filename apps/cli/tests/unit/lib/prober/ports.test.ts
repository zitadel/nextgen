import { execFile } from "node:child_process";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:child_process before importing the SUT so the promisified
// execFile inside `ports.ts` resolves to the mock.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);

import { listListeningTcpListeners } from "../../../../src/lib/prober/ports";

/**
 * Promisified `execFile` invokes the callback the mock provides. Each test
 * sets the callback's behaviour via `mockImplementation`.
 */
function whenLsof(impl: (cb: (err: NodeJS.ErrnoException | null, stdout: string) => void) => void): void {
  mockExecFile.mockImplementation(((
    _file: string,
    _args: readonly string[],
    _opts: unknown,
    cb: (err: NodeJS.ErrnoException | null, stdout: string) => void,
  ) => {
    impl(cb);
    return undefined as never;
  }) as never);
}

beforeEach(() => {
  mockExecFile.mockReset();
});

describe("listListeningTcpListeners", () => {
  it("parses loopback listeners sorted by port from lsof -F pcn output", async () => {
    whenLsof((cb) =>
      cb(
        null,
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
      ),
    );

    const listeners = await listListeningTcpListeners();

    expect(listeners.map((l) => l.port)).toEqual([3000, 3000, 5050, 8080]);
    expect(listeners.every((l) => l.host === "*" || l.host.includes("::1") || l.host === "127.0.0.1")).toBe(true);
  });

  it("keeps listener process metadata for diagnostics", async () => {
    whenLsof((cb) =>
      cb(
        null,
        [
          "p12345",
          "czitadel-server",
          "n*:8080",
          "p23456",
          "cnode",
          "n127.0.0.1:3000",
          "",
        ].join("\n"),
      ),
    );

    await expect(listListeningTcpListeners()).resolves.toEqual([
      { address: "127.0.0.1:3000", command: "node", host: "127.0.0.1", pid: 23456, port: 3000 },
      { address: "*:8080", command: "zitadel-server", host: "*", pid: 12345, port: 8080 },
    ]);
  });

  it("returns [] when lsof is not on PATH (ENOENT)", async () => {
    const enoent: NodeJS.ErrnoException = Object.assign(new Error("spawn lsof ENOENT"), {
      code: "ENOENT",
    });
    whenLsof((cb) => cb(enoent, ""));

    expect(await listListeningTcpListeners()).toEqual([]);
  });

  it("returns [] when lsof exits non-zero", async () => {
    const failure: NodeJS.ErrnoException = Object.assign(new Error("Command failed"), {
      code: "1",
    });
    whenLsof((cb) => cb(failure, ""));

    expect(await listListeningTcpListeners()).toEqual([]);
  });

  it("returns [] when lsof exceeds the timeout", async () => {
    // The promisified execFile's timeout error has code "ETIMEDOUT" / signal.
    const timedOut: NodeJS.ErrnoException = Object.assign(new Error("timeout"), {
      code: "ETIMEDOUT",
    });
    whenLsof((cb) => cb(timedOut, ""));

    expect(await listListeningTcpListeners({ timeoutMs: 1 })).toEqual([]);
  });

  it("ignores malformed lines and out-of-range ports", async () => {
    whenLsof((cb) =>
      cb(
        null,
        [
          "garbage line with no n-prefix",
          "n", // empty address
          "nno-colon-here",
          "n*:notaport",
          "n*:99999", // out of range
          "n*:80",
          "",
        ].join("\n"),
      ),
    );

    const listeners = await listListeningTcpListeners();
    expect(listeners.map((l) => l.port)).toEqual([80]);
  });
});
