import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolvePlatformBinary,
  resolveServerCommand,
  startBinaryRuntime,
  stopBinaryRuntime,
} from "../../../../src/lib/local-server/binary";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(() => ({ pid: 4242, unref: () => undefined })) };
});

describe("local server binary helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    // `clearAllMocks` resets the `spawn` mock's call history between tests. Under
    // Vitest 4 `restoreAllMocks` only restores `spyOn` spies and no longer clears
    // a `vi.fn()` module mock's `.mock.calls`, so without this a later test reads
    // an earlier test's `spawn.mock.calls[0]`.
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("spawns the server with the address, data dir, and public base env", async () => {
    vi.stubEnv("ZITADEL_SERVER_BINARY", "/tmp/fake-nextgen-server");
    const dir = await mkdtemp(join(tmpdir(), "zitadel-binary-test-"));

    const runtime = await startBinaryRuntime({
      cliVersion: "0.0.0-test",
      dataDir: join(dir, "data"),
      logPath: join(dir, "logs", "server.log"),
      port: 8091,
      serverUrl: "http://localhost:8091",
    });

    const [command, args, options] = vi.mocked(spawn).mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(command).toBe("/tmp/fake-nextgen-server");
    expect(args).toEqual(["--migrate"]);
    expect(runtime.command).toBe("/tmp/fake-nextgen-server --migrate");
    expect(options.env.NEXTGEN_SERVER_ADDRESS).toBe(":8091");
    expect(options.env.NEXTGEN_SERVER_PUBLIC_BASE).toBe("http://localhost:8091");
    expect(runtime.env).toEqual({ injected: [] });
  });

  it("passes resolved project variables through the child environment, never argv", async () => {
    vi.stubEnv("ZITADEL_SERVER_BINARY", "/tmp/fake-nextgen-server");
    const dir = await mkdtemp(join(tmpdir(), "zitadel-binary-test-"));

    const runtime = await startBinaryRuntime({
      cliVersion: "0.0.0-test",
      dataDir: join(dir, "data"),
      logPath: join(dir, "logs", "server.log"),
      port: 8091,
      serverUrl: "http://localhost:8091",
      env: {
        values: { GOOGLE_CLIENT_SECRET: "canary-secret" },
        injected: ["GOOGLE_CLIENT_SECRET"],
      },
    });

    const [command, args, options] = vi.mocked(spawn).mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(options.env.GOOGLE_CLIENT_SECRET).toBe("canary-secret");
    expect([command, ...args].join(" ")).not.toContain("canary-secret");
    expect(runtime.command).not.toContain("canary-secret");
    expect(runtime.env).toEqual({
      injected: ["GOOGLE_CLIENT_SECRET"],
    });
    expect(JSON.stringify(runtime)).not.toContain("canary-secret");
  });

  it("records an explicit source build version with a binary override", () => {
    expect(
      resolveServerCommand({
        ZITADEL_SERVER_BINARY: "/repo/dist/server/nextgen",
        ZITADEL_SERVER_BINARY_VERSION: "dev+abcdef123456",
      }),
    ).toEqual({
      command: "/repo/dist/server/nextgen",
      args: [],
      serverPackage: "@zitadel/server",
      serverVersion: "dev+abcdef123456",
    });
  });

  it("keeps the generic label for an unversioned user override", () => {
    expect(
      resolveServerCommand({ ZITADEL_SERVER_BINARY: "/tmp/custom-nextgen" }).serverVersion,
    ).toBe("override");
  });

  it("starts the platform binary itself, not the wrapper script", () => {
    vi.stubEnv("ZITADEL_SERVER_BINARY", "");

    const { command, args } = resolveServerCommand();

    expect(command).toMatch(/nextgen(\.exe)?$/);
    expect(args).toEqual([]);
  });

  it("finds the binary in the platform package of the server package", () => {
    const manifest = createRequire(import.meta.url).resolve("@zitadel/server/package.json");

    expect(resolvePlatformBinary(manifest)).toMatch(/server-[a-z0-9-]+\/bin\/nextgen(\.exe)?$/);
  });

  it("refuses a platform the server is not built for", () => {
    const manifest = createRequire(import.meta.url).resolve("@zitadel/server/package.json");

    expect(() => resolvePlatformBinary(manifest, "freebsd", "x64")).toThrow(
      "Unsupported platform for @zitadel/server: freebsd/x64",
    );
  });

  it("signals the process group even when its leader is already dead", async () => {
    let groupAlive = true;
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation((pid: number, signal?: string | number) => {
        if (pid === 12345) {
          throw errno("ESRCH");
        }
        if (signal === "SIGTERM") {
          groupAlive = false;
          return true;
        }
        if (groupAlive) {
          return true;
        }
        throw errno("ESRCH");
      });

    await expect(stopBinaryRuntime(12345)).resolves.toMatchObject({
      pid: 12345,
      status: "stopped",
      target: "process-group",
    });
    expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
  });

  it("falls back from process-group SIGTERM to pid SIGTERM and reports a stale process", async () => {
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation((_pid: number, signal?: string | number) => {
        if (_pid === -12345 && signal === "SIGTERM") {
          throw errno("ESRCH");
        }
        if (signal === "SIGTERM") {
          throw errno("ESRCH");
        }
        return true;
      });

    await expect(stopBinaryRuntime(12345)).resolves.toMatchObject({
      pid: 12345,
      status: "stale",
      target: "process",
    });

    expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(12345, "SIGTERM");
  });

  it("sends SIGKILL to the process group when SIGTERM does not stop it", async () => {
    vi.useFakeTimers();
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation((_pid: number, _signal?: string | number) => {
        return true;
      });

    const stopped = stopBinaryRuntime(12345);
    await vi.advanceTimersByTimeAsync(12_500);

    await expect(stopped).resolves.toMatchObject({
      pid: 12345,
      status: "failed",
      target: "process-group",
      signal: "SIGKILL",
    });
    expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(-12345, "SIGKILL");
  });
});

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}
