import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LOCAL_DATA_DIR,
  LOCAL_RUNTIME_FILE,
  type BinaryRuntimeMetadata,
  writeRuntimeMetadata,
} from "../../../../src/lib/local-server/runtime";
import { LocalServer } from "../../../../src/lib/local-server/server";

const dirs: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill("SIGKILL");
  }
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function directory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-local-server-"));
  dirs.push(dir);
  return dir;
}

const at = (cwd: string) => LocalServer.at(cwd, { cliVersion: "0.0.0-test" });

/** A record whose process is long gone, in a directory that has data. */
async function directoryWithAGoneServer(): Promise<string> {
  return directoryRecording(2_147_483_000, "nextgen --migrate");
}

async function directoryRecording(pid: number, command: string): Promise<string> {
  const cwd = await directory();
  await mkdir(join(cwd, LOCAL_DATA_DIR), { recursive: true });
  const record: BinaryRuntimeMetadata = {
    schema_version: 1,
    backend: "binary",
    pid,
    command,
    log_path: join(cwd, "server.log"),
    server_package: "@zitadel/server",
    server_version: "1.0.0",
    port: 8099,
    server_url: "http://localhost:8099",
    data_dir: join(cwd, LOCAL_DATA_DIR),
    created_at: "2026-01-01T00:00:00.000Z",
    cli_version: "1.0.0",
  };
  await writeRuntimeMetadata(cwd, record);
  return cwd;
}

describe("LocalServer", () => {
  describe("status", () => {
    it("is missing for a directory that never started a server", async () => {
      await expect(at(await directory()).status()).resolves.toMatchObject({
        lifecycle: "missing",
        healthy: false,
      });
    });

    it("is stopped when the recorded process is gone", async () => {
      await expect(at(await directoryWithAGoneServer()).status()).resolves.toMatchObject({
        lifecycle: "stopped",
        process: { pid: 2_147_483_000, running: false },
      });
    });
  });

  describe("stop", () => {
    it("reports nothing stopped for a directory that never started a server", async () => {
      await expect(at(await directory()).stop()).resolves.toMatchObject({
        runtime: undefined,
        stopped: false,
      });
    });

    it("reports nothing stopped when the recorded process is already gone", async () => {
      await expect(at(await directoryWithAGoneServer()).stop()).resolves.toMatchObject({
        stopped: false,
        outcome: { status: "stale" },
      });
    });

    it("keeps the data and the record", async () => {
      const cwd = await directoryWithAGoneServer();

      await at(cwd).stop();

      await expect(stat(join(cwd, LOCAL_DATA_DIR))).resolves.toBeDefined();
      await expect(stat(join(cwd, LOCAL_RUNTIME_FILE))).resolves.toBeDefined();
    });
  });

  describe("a recorded pid that now belongs to another program", () => {
    const aliveProgram = (): ChildProcess => {
      const child = spawn("sleep", ["60"], { stdio: "ignore" });
      children.push(child);
      return child;
    };
    const exists = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    it.skipIf(process.platform === "win32")("is not signalled by stop", async () => {
      const child = aliveProgram();
      const cwd = await directoryRecording(child.pid ?? 0, "/opt/zitadel/nextgen --migrate");

      await expect(at(cwd).stop()).resolves.toMatchObject({
        stopped: false,
        outcome: { status: "stale" },
      });
      expect(exists(child.pid ?? 0)).toBe(true);
    });

    it.skipIf(process.platform === "win32")("is not reported as the running server", async () => {
      const child = aliveProgram();
      const cwd = await directoryRecording(child.pid ?? 0, "/opt/zitadel/nextgen --migrate");

      await expect(at(cwd).status()).resolves.toMatchObject({
        process: { running: false },
      });
    });

    it.skipIf(process.platform === "win32")(
      "is stopped when it is the recorded server",
      async () => {
        const child = aliveProgram();
        const exited = new Promise((resolve) => child.once("exit", resolve));
        const cwd = await directoryRecording(child.pid ?? 0, "/bin/sleep 60");

        await expect(at(cwd).stop()).resolves.toMatchObject({ stopped: true });
        await exited;
      },
    );
  });

  describe("reset", () => {
    it("deletes the data and the record, even when the recorded process is gone", async () => {
      const cwd = await directoryWithAGoneServer();

      await at(cwd).reset();

      await expect(stat(join(cwd, LOCAL_DATA_DIR))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(cwd, LOCAL_RUNTIME_FILE))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  describe("logs", () => {
    it("refuses a directory that never started a server, and says how to start one", async () => {
      await expect(at(await directory()).logs({ tail: 10 })).rejects.toMatchObject({
        code: "E_VALIDATION",
        hint: "Run `zitadel start` first.",
      });
    });

    it("reads the end of the server's log", async () => {
      const cwd = await directoryWithAGoneServer();
      await writeFile(join(cwd, "server.log"), "one\ntwo\nthree\n");

      await expect(at(cwd).logs({ tail: 2 })).resolves.toMatchObject({ logs: "two\nthree\n" });
    });
  });

  describe("start", () => {
    it("refuses the Docker backend without an image", async () => {
      await expect(
        at(await directory()).start({ backend: "docker", env: { values: {}, injected: [] } }),
      ).rejects.toMatchObject({ code: "E_VALIDATION" });
    });
  });
});
