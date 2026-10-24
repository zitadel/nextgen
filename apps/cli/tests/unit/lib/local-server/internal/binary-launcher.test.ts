import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AppendedLog,
  BinaryLauncher,
} from "../../../../../src/lib/local-server/internal/binary-launcher";
import { launched } from "../../../../../src/lib/local-server/internal/lifecycle";
import { ManualClock } from "../../../../helpers/clock";
import { aBinaryRecord } from "../../../../helpers/runtime-record";

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
  const { EventEmitter } = await import("node:events");
  const child = () => {
    const spawned = Object.assign(new EventEmitter(), { pid: 4242, unref: () => undefined });
    queueMicrotask(() => spawned.emit("spawn"));
    return spawned;
  };
  return { ...actual, spawn: vi.fn(child) };
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

  it("reports a server binary that cannot be run instead of crashing", async () => {
    const { EventEmitter } = await import("node:events");
    vi.mocked(spawn).mockImplementationOnce((() => {
      const failing = Object.assign(new EventEmitter(), { pid: undefined, unref: () => undefined });
      queueMicrotask(() => failing.emit("error", new Error("spawn /x/nextgen EACCES")));
      return failing;
    }) as never);
    vi.stubEnv("ZITADEL_SERVER_BINARY", "/x/nextgen");
    const dir = await mkdtemp(join(tmpdir(), "zitadel-binary-test-"));

    const launching = new BinaryLauncher({
      cliVersion: "0.0.0-test",
      dataDir: join(dir, "data"),
      logPath: join(dir, "logs", "server.log"),
    }).launch({ port: 8091, serverUrl: "http://localhost:8091" });

    await expect(launching).rejects.toMatchObject({
      code: "E_VALIDATION",
      hint: expect.stringContaining("exists and can be run"),
    });
  });

  it("recognises its server when the process list cuts long commands short", async () => {
    vi.stubEnv("COLUMNS", "40");
    const real = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const child = real.spawn(
      process.execPath,
      ["-e", "setTimeout(() => undefined, 30000)", `${"x".repeat(120)}/nextgen`],
      { stdio: "ignore" },
    );
    const record = aBinaryRecord({ pid: child.pid ?? 0 });

    try {
      await expect(
        new BinaryLauncher({ cliVersion: "0.0.0-test", dataDir: "/d", logPath: "/l" }).isAlive(
          record,
        ),
      ).resolves.toBe(true);
    } finally {
      child.kill("SIGKILL");
    }
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
    const record = aBinaryRecord({ pid: child.pid ?? 0 });

    try {
      await expect(launcher.isLaunchedAlive(launched(record))).resolves.toBe(true);
      await expect(launcher.isAlive(record)).resolves.toBe(false);
    } finally {
      child.kill("SIGKILL");
    }
  });

  describe("telling one directory's server from another's", () => {
    const real = () => vi.importActual<typeof import("node:child_process")>("node:child_process");
    const launcher = new BinaryLauncher({ cliVersion: "0.0.0-test", dataDir: "/d", logPath: "/l" });
    const recordFor = (pid: number, dataDir: string) => aBinaryRecord({ pid, data_dir: dataDir });

    /**
     * A process that runs the server program for a data directory. It is Node,
     * not `sleep`: macOS keeps the environment of its own programs out of `ps`,
     * and the environment is where the data directory is read.
     */
    async function aServerOf(dataDir: string) {
      return (await real()).spawn(
        process.execPath,
        ["-e", "setTimeout(() => undefined, 30000)", "/opt/zitadel/nextgen"],
        { stdio: "ignore", env: { ...process.env, NEXTGEN_SERVER_DATA_DIR: dataDir } },
      );
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

describe("reading a server's log file", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  /** Where a server's log goes, holding `content` if any is given. */
  async function aLogFile(content?: string | Buffer): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-server-log-"));
    dirs.push(dir);
    const path = join(dir, "server.log");
    if (content !== undefined) {
      await writeFile(path, content);
    }
    return path;
  }

  it("reads the whole file first, then only what was appended", async () => {
    const path = await aLogFile("level=INFO msg=one\n");
    const log = new AppendedLog(path);

    await expect(log.next()).resolves.toBe("level=INFO msg=one\n");
    await appendFile(path, "level=WARN msg=two\n");
    await expect(log.next()).resolves.toBe("level=WARN msg=two\n");
    await expect(log.next()).resolves.toBe("");
  });

  it("keeps a character whole when a read ends inside it", async () => {
    const path = await aLogFile(Buffer.from([0xc3]));
    const log = new AppendedLog(path);

    await expect(log.next()).resolves.toBe("");
    await appendFile(path, Buffer.from([0xa9, 0x0a]));
    await expect(log.next()).resolves.toBe("é\n");
  });

  it("reads a file that is not there yet as empty, and the file once it is", async () => {
    const path = await aLogFile();
    const log = new AppendedLog(path);

    await expect(log.next()).resolves.toBe("");
    await writeFile(path, "level=INFO msg=up\n");
    await expect(log.next()).resolves.toBe("level=INFO msg=up\n");
  });

  it("reads a file that got shorter, as after it was deleted, from the top", async () => {
    const path = await aLogFile("level=INFO msg=a long first line\n");
    const log = new AppendedLog(path);
    await log.next();

    await writeFile(path, "level=INFO msg=b\n");

    await expect(log.next()).resolves.toBe("level=INFO msg=b\n");
  });

  it("follows the file until it is stopped, handing over what was there apart from what came after", async () => {
    const path = await aLogFile("level=INFO msg=one\n");
    const stop = new AbortController();
    const existing: string[] = [];
    const appended: string[] = [];
    let waits = 0;
    const clock = new ManualClock(() => {
      waits += 1;
      if (waits === 1) {
        appendFileSync(path, "level=WARN msg=two\n");
      } else {
        stop.abort();
      }
    });

    await BinaryLauncher.followLogs(
      path,
      { existing: (text) => existing.push(text), appended: (text) => appended.push(text) },
      { clock, signal: stop.signal },
    );

    expect(existing).toEqual(["level=INFO msg=one\n"]);
    expect(appended).toEqual(["level=WARN msg=two\n"]);
  });
});

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}
