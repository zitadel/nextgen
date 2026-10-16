import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { BinaryLauncher } from "../../../../../src/lib/local-server/internal/binary-launcher";

const resolver = vi.hoisted(() => ({ missing: false }));

vi.mock("@zitadel/server/binary", () => ({
  resolveServerBinary: () => {
    if (resolver.missing) {
      throw new Error("Missing Zitadel server binary at /nowhere/nextgen.");
    }
    return "/resolved/by/server-package/nextgen";
  },
  serverBinaryPath: () => "/resolved/by/server-package/nextgen",
}));

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

    const runtime = await new BinaryLauncher({
      cliVersion: "0.0.0-test",
      dataDir: join(dir, "data"),
      logPath: join(dir, "logs", "server.log"),
    }).launch({ port: 8091, serverUrl: "http://localhost:8091" });

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

    const runtime = await new BinaryLauncher({
      cliVersion: "0.0.0-test",
      dataDir: join(dir, "data"),
      logPath: join(dir, "logs", "server.log"),
      env: {
        values: { GOOGLE_CLIENT_SECRET: "canary-secret" },
        injected: ["GOOGLE_CLIENT_SECRET"],
      },
    }).launch({ port: 8091, serverUrl: "http://localhost:8091" });

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
      BinaryLauncher.command({
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
      BinaryLauncher.command({ ZITADEL_SERVER_BINARY: "/tmp/custom-nextgen" }).serverVersion,
    ).toBe("override");
  });

  it("starts the binary the server package resolves, not its wrapper script", async () => {
    vi.stubEnv("ZITADEL_SERVER_BINARY", "");
    const dir = await mkdtemp(join(tmpdir(), "zitadel-binary-test-"));

    await new BinaryLauncher({
      cliVersion: "0.0.0-test",
      dataDir: join(dir, "data"),
      logPath: join(dir, "logs", "server.log"),
    }).launch({ port: 8091, serverUrl: "http://localhost:8091" });

    const [command, args] = vi.mocked(spawn).mock.calls[0] as unknown as [string, string[]];
    expect(command).toBe("/resolved/by/server-package/nextgen");
    expect(args).toEqual(["--migrate"]);
  });

  it("says how to repair the install when the server binary cannot be found", async () => {
    vi.stubEnv("ZITADEL_SERVER_BINARY", "");
    resolver.missing = true;
    const dir = await mkdtemp(join(tmpdir(), "zitadel-binary-test-"));

    const launching = new BinaryLauncher({
      cliVersion: "0.0.0-test",
      dataDir: join(dir, "data"),
      logPath: join(dir, "logs", "server.log"),
    }).launch({ port: 8091, serverUrl: "http://localhost:8091" });

    await expect(launching).rejects.toMatchObject({
      code: "E_VALIDATION",
      hint: expect.stringContaining("Reinstall @zitadel/cli"),
    });
    resolver.missing = false;
  });

  it("trusts a launch that has only just returned, whatever the process list calls it", async () => {
    const real = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const child = real.spawn("sleep", ["30"], { stdio: "ignore" });
    const launcher = new BinaryLauncher({ cliVersion: "0.0.0-test", dataDir: "/d", logPath: "/l" });
    const record = { pid: child.pid ?? 0, command: "/opt/zitadel/nextgen --migrate" } as never;

    try {
      await expect(launcher.isAlive(record, { fresh: true })).resolves.toBe(true);
      await expect(launcher.isAlive(record)).resolves.toBe(false);
    } finally {
      child.kill("SIGKILL");
    }
  });

  describe("telling one directory's server from another's", () => {
    const real = () => vi.importActual<typeof import("node:child_process")>("node:child_process");
    const launcher = new BinaryLauncher({ cliVersion: "0.0.0-test", dataDir: "/d", logPath: "/l" });
    const recordFor = (pid: number, dataDir: string) =>
      ({ pid, command: "/bin/sleep 30", data_dir: dataDir }) as never;

    async function aServerOf(dataDir: string) {
      const child = (await real()).spawn("sleep", ["30"], {
        stdio: "ignore",
        env: { ...process.env, NEXTGEN_SERVER_DATA_DIR: dataDir },
      });
      return child;
    }

    it("accepts the process that serves the record's data directory", async () => {
      const child = await aServerOf("/projects/a/.zitadel/local/nextgen-data");

      try {
        await expect(
          launcher.isAlive(recordFor(child.pid ?? 0, "/projects/a/.zitadel/local/nextgen-data")),
        ).resolves.toBe(true);
      } finally {
        child.kill("SIGKILL");
      }
    });

    it("refuses the process that serves another directory's data", async () => {
      const child = await aServerOf("/projects/b/.zitadel/local/nextgen-data");

      try {
        await expect(
          launcher.isAlive(recordFor(child.pid ?? 0, "/projects/a/.zitadel/local/nextgen-data")),
        ).resolves.toBe(false);
      } finally {
        child.kill("SIGKILL");
      }
    });

    it("does not take a data directory that only starts like the record's for the same one", async () => {
      const child = await aServerOf("/projects/a/.zitadel/local/nextgen-data-old");

      try {
        await expect(
          launcher.isAlive(recordFor(child.pid ?? 0, "/projects/a/.zitadel/local/nextgen-data")),
        ).resolves.toBe(false);
      } finally {
        child.kill("SIGKILL");
      }
    });
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

    await expect(BinaryLauncher.stopPid(12345)).resolves.toMatchObject({
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

    await expect(BinaryLauncher.stopPid(12345)).resolves.toMatchObject({
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

    const stopped = BinaryLauncher.stopPid(12345);
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
