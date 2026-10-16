import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DockerLauncher } from "../../../../src/lib/local-server/internal/docker-launcher";
import {
  LOCAL_DATA_DIR,
  LOCAL_RUNTIME_FILE,
  type BinaryRuntimeMetadata,
  type DockerRuntimeMetadata,
  writeRuntimeMetadata,
} from "../../../../src/lib/local-server/runtime";
import { LocalServer } from "../../../../src/lib/local-server/server";
import {
  aFakeServerBinary,
  trackLocalServer,
  useLocalServers,
} from "../../../helpers/local-server";
import { nextPort } from "../../../helpers/ports";

const dirs: string[] = [];
const children: ChildProcess[] = [];
const held: Server[] = [];

useLocalServers();

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const server of held.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
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

  describe("finding the server of a directory", () => {
    const url = "http://localhost:8099";

    function answeringAt(...origins: string[]): void {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL) => {
          const target = new URL(String(input));
          if (target.pathname === "/healthz" && origins.includes(target.origin)) {
            return new Response("ok", { status: 200 });
          }
          throw new TypeError("fetch failed (stub: connection refused)");
        }),
      );
    }

    async function directoryWithARunningServer(): Promise<string> {
      const child = spawn("sleep", ["60"], { stdio: "ignore" });
      children.push(child);
      return directoryRecording(child.pid ?? 0, "/bin/sleep 60");
    }

    it("is the URL the directory's record names, when that server runs and answers", async () => {
      const cwd = await directoryWithARunningServer();
      answeringAt(url);

      await expect(LocalServer.resolveUrl(cwd)).resolves.toBe(url);
    });

    it("is the server of the nearest parent directory that started one", async () => {
      const cwd = await directoryWithARunningServer();
      const app = join(cwd, "my-app");
      await mkdir(app);
      answeringAt(url);

      await expect(LocalServer.resolveUrl(app)).resolves.toBe(url);
    });

    it("is not a server that answers at the recorded URL after the recorded one is gone", async () => {
      const cwd = await directoryWithAGoneServer();
      answeringAt(url);

      await expect(LocalServer.resolveUrl(cwd)).rejects.toMatchObject({
        code: "E_LOCAL_SERVER_NOT_RUNNING",
      });
    });

    it("is not a server that answers at the recorded URL when the process is another program", async () => {
      const child = spawn("sleep", ["60"], { stdio: "ignore" });
      children.push(child);
      const cwd = await directoryRecording(child.pid ?? 0, "/opt/zitadel/nextgen --migrate");
      answeringAt(url);

      await expect(LocalServer.resolveUrl(cwd)).rejects.toMatchObject({
        code: "E_LOCAL_SERVER_NOT_RUNNING",
      });
    });

    it("is not a server that runs but does not answer", async () => {
      const cwd = await directoryWithARunningServer();
      answeringAt();

      await expect(LocalServer.resolveUrl(cwd)).rejects.toMatchObject({
        code: "E_LOCAL_SERVER_NOT_RUNNING",
      });
    });

    it("is not whatever answers on the default port when the directory started none", async () => {
      answeringAt("http://localhost:8080");

      await expect(LocalServer.resolveUrl(await directory())).rejects.toMatchObject({
        code: "E_LOCAL_SERVER_NOT_RUNNING",
        hint: "No local server has been started in this directory or a parent. Run `zitadel start`, or name a server another directory started with --server <url>.",
      });
    });

    it("is found as a URL for optional UI when the server runs and answers", async () => {
      const cwd = await directoryWithARunningServer();
      answeringAt(url);

      await expect(LocalServer.detectUrl(cwd)).resolves.toBe(url);
    });

    it("is not found for optional UI when the recorded server is gone", async () => {
      const cwd = await directoryWithAGoneServer();
      answeringAt(url);

      await expect(LocalServer.detectUrl(cwd)).resolves.toBeUndefined();
    });

    it("is not found for optional UI when the directory started none", async () => {
      answeringAt(url);

      await expect(LocalServer.detectUrl(await directory())).resolves.toBeUndefined();
    });

    it("is not found, and not an error, for optional UI when the record cannot be read", async () => {
      const cwd = await directory();
      await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
      await writeFile(join(cwd, LOCAL_RUNTIME_FILE), "{not json");

      await expect(LocalServer.detectUrl(cwd)).resolves.toBeUndefined();
    });
  });

  describe("starting over the server the other backend left", () => {
    const none = { values: {}, injected: [] };

    async function directoryRecordingContainer(port: number): Promise<string> {
      const cwd = await directory();
      const record: DockerRuntimeMetadata = {
        schema_version: 1,
        backend: "docker",
        container_name: "zitadel-server-abc",
        container_id: "abc",
        image: "ghcr.io/zitadel/nextgen:latest",
        port,
        server_url: `http://localhost:${port}`,
        data_dir: join(cwd, LOCAL_DATA_DIR),
        created_at: "2026-01-01T00:00:00.000Z",
        cli_version: "1.0.0",
      };
      await writeRuntimeMetadata(cwd, record);
      return cwd;
    }

    function holdAPort(): Promise<number> {
      return new Promise((resolve) => {
        const server = createServer();
        held.push(server);
        server.listen({ port: 0 }, () => {
          const address = server.address();
          resolve(typeof address === "object" && address ? address.port : 0);
        });
      });
    }

    it("leaves it running when the port it is asked to move to is held", async () => {
      const cwd = await directoryRecordingContainer(nextPort());
      const remove = vi.spyOn(DockerLauncher, "remove").mockResolvedValue(true);

      await expect(
        at(cwd).start({ backend: "binary", env: none }, { port: await holdAPort() }),
      ).rejects.toMatchObject({ code: "E_PORT_IN_USE" });

      expect(remove).not.toHaveBeenCalled();
    });

    it("keeps the port the directory had", async () => {
      const port = nextPort();
      const cwd = await directoryRecordingContainer(port);
      vi.spyOn(DockerLauncher, "remove").mockResolvedValue(true);
      vi.stubEnv("ZITADEL_SERVER_BINARY", await aFakeServerBinary("plain"));

      const { runtime } = await at(cwd).start({ backend: "binary", env: none });

      trackLocalServer(runtime.backend === "binary" ? runtime.pid : 0);
      expect(runtime.port).toBe(port);
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
