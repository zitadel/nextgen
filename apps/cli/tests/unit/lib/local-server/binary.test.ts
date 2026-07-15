import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  reapEmbeddedPostgres,
  stopBinaryRuntime,
} from "../../../../src/lib/local-server/binary";

describe("local server binary helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("falls back from process-group SIGTERM to pid SIGTERM and reports a stale process", async () => {
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation((_pid: number, signal?: NodeJS.Signals | number) => {
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

    expect(kill).toHaveBeenCalledWith(12345, 0);
    expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(12345, "SIGTERM");
  });

  it("sends SIGKILL to the process group when SIGTERM does not stop it", async () => {
    vi.useFakeTimers();
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation((_pid: number, _signal?: NodeJS.Signals | number) => {
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

describe("reapEmbeddedPostgres", () => {
  const dataDirs: string[] = [];
  const strayPids: number[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const pid of strayPids.splice(0)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already reaped by the code under test.
      }
    }
    for (const dir of dataDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function dataDirWithPostmasterPid(content: string | undefined): Promise<string> {
    const dataDir = await mkdtemp(join(tmpdir(), "zitadel-reap-"));
    dataDirs.push(dataDir);
    if (content !== undefined) {
      const pidDir = join(dataDir, "embedded-postgres", "data");
      await mkdir(pidDir, { recursive: true });
      await writeFile(join(pidDir, "postmaster.pid"), content);
    }
    return dataDir;
  }

  function pidFileFor(dataDir: string): string {
    return join(dataDir, "embedded-postgres", "data", "postmaster.pid");
  }

  it("is a no-op when the data directory has no postmaster.pid", async () => {
    const dataDir = await dataDirWithPostmasterPid(undefined);
    const kill = vi.spyOn(process, "kill");

    await expect(reapEmbeddedPostgres(dataDir)).resolves.toEqual({ status: "absent" });
    expect(kill).not.toHaveBeenCalled();
  });

  it("clears a stale lock file left by a dead postmaster", async () => {
    // A pid far above any real process reads as dead through the real kill(pid, 0).
    const dataDir = await dataDirWithPostmasterPid("999999999\n/some/data\n");

    await expect(reapEmbeddedPostgres(dataDir)).resolves.toMatchObject({
      status: "stale",
      pid: 999_999_999,
    });
    await expect(stat(pidFileFor(dataDir))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stops a live postmaster with SIGINT and clears the lock", async () => {
    const pid = 4242;
    let alive = true;
    vi.spyOn(process, "kill").mockImplementation(
      (_pid: number, signal?: NodeJS.Signals | number) => {
        if (_pid === pid && signal === "SIGINT") {
          alive = false;
          return true;
        }
        if (_pid === pid && signal === 0) {
          if (alive) {
            return true;
          }
          throw errno("ESRCH");
        }
        return true;
      },
    );
    const dataDir = await dataDirWithPostmasterPid(`${String(pid)}\n`);

    await expect(reapEmbeddedPostgres(dataDir)).resolves.toEqual({
      status: "stopped",
      pid,
      signal: "SIGINT",
    });
    expect(process.kill).toHaveBeenCalledWith(pid, "SIGINT");
    await expect(stat(pidFileFor(dataDir))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("escalates to SIGKILL when the postmaster ignores the SIGINT fast shutdown", async () => {
    // A real child that ignores SIGINT (as Postgres could, deciding not to fast
    // shut down) but cannot ignore SIGKILL. It prints "ready" only after its
    // SIGINT handler is installed, so the reap below cannot race bootstrap.
    const child = spawn(
      process.execPath,
      ["-e", "process.on('SIGINT', () => {}); console.log('ready'); setInterval(() => {}, 1 << 30);"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    strayPids.push(child.pid ?? 0);
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", () => resolve());
      child.once("error", reject);
    });
    const dataDir = await dataDirWithPostmasterPid(`${String(child.pid)}\n`);

    const result = await reapEmbeddedPostgres(dataDir, {
      fastShutdownTimeoutMs: 300,
      killTimeoutMs: 2_000,
    });

    expect(result).toEqual({ status: "stopped", pid: child.pid, signal: "SIGKILL" });
    await expect(stat(pidFileFor(dataDir))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}
