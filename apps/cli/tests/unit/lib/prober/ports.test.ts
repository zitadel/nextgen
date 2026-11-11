import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({ execa: vi.fn() }));

const mockExeca = vi.mocked(execa);

import { listListeningTcpListeners } from "@/lib/prober/ports";

/** Answers the `lsof` the code runs with `stdout`. */
function whenLsof(stdout: string): void {
  mockExeca.mockResolvedValue({ stdout, stderr: "", exitCode: 0 } as never);
}

beforeEach(() => {
  mockExeca.mockReset();
});

describe("listListeningTcpListeners", () => {
  it("parses loopback listeners sorted by port from lsof -F pcn output", async () => {
    whenLsof(
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

    const listeners = await listListeningTcpListeners();

    expect(listeners.map((l) => l.port)).toEqual([3000, 3000, 5050, 8080]);
    expect(
      listeners.every((l) => l.host === "*" || l.host.includes("::1") || l.host === "127.0.0.1"),
    ).toBe(true);
  });

  it("keeps listener process metadata for diagnostics", async () => {
    whenLsof(
      ["p12345", "czitadel-server", "n*:8080", "p23456", "cnode", "n127.0.0.1:3000", ""].join("\n"),
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
    mockExeca.mockRejectedValue(enoent);

    expect(await listListeningTcpListeners()).toEqual([]);
  });

  it("returns [] when lsof exits non-zero", async () => {
    const failure: NodeJS.ErrnoException = Object.assign(new Error("Command failed"), {
      code: "1",
    });
    mockExeca.mockRejectedValue(failure);

    expect(await listListeningTcpListeners()).toEqual([]);
  });

  it("returns [] when lsof exceeds the timeout", async () => {
    // execa's timeout error has code "ETIMEDOUT" / signal.
    const timedOut: NodeJS.ErrnoException = Object.assign(new Error("timeout"), {
      code: "ETIMEDOUT",
    });
    mockExeca.mockRejectedValue(timedOut);

    expect(await listListeningTcpListeners({ timeoutMs: 1 })).toEqual([]);
  });

  it("ignores malformed lines and out-of-range ports", async () => {
    whenLsof(
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

    const listeners = await listListeningTcpListeners();
    expect(listeners.map((l) => l.port)).toEqual([80]);
  });
});
