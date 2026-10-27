import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { BinaryLauncher } from "../../../../src/lib/local-server/internal/binary-launcher";
import { DockerLauncher } from "../../../../src/lib/local-server/internal/docker-launcher";
import {
  LOCAL_DATA_DIR,
  LOCAL_RUNTIME_FILE,
  writeRuntimeMetadata,
} from "../../../../src/lib/local-server/runtime";
import { LocalServer } from "../../../../src/lib/local-server/server";
import { unscopedCommand } from "../../../../src/lib/suggestion";
import {
  aFakeServerBinary,
  trackLocalServer,
  useLocalServers,
} from "../../../helpers/local-server";
import { nextPort } from "../../../helpers/ports";
import { aBinaryRecord, aDockerRecord } from "../../../helpers/runtime-record";

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
  await writeRuntimeMetadata(
    cwd,
    aBinaryRecord({
      pid,
      command,
      log_path: join(cwd, "server.log"),
      data_dir: join(cwd, LOCAL_DATA_DIR),
    }),
  );
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

    it("reports nothing stopped where Docker is not installed", async () => {
      vi.stubEnv("PATH", await directory());

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

      const { lines } = await at(cwd).logs({ tail: 2 });

      expect(lines.map((line) => line.text)).toEqual(["two", "three"]);
    });

    it("picks the last lines at a level from the whole log", async () => {
      const cwd = await directoryWithAGoneServer();
      await writeFile(
        join(cwd, "server.log"),
        "level=WARN msg=first\nlevel=WARN msg=second\nlevel=INFO msg=a\nlevel=INFO msg=b\n",
      );

      const { lines } = await at(cwd).logs({ tail: 1, level: "warn" });

      expect(lines.map((line) => line.text)).toEqual(["level=WARN msg=second"]);
    });

    it("reads all of a container's log to pick the lines at a level", async () => {
      const cwd = await directory();
      await writeRuntimeMetadata(cwd, aDockerRecord());
      const read = vi
        .spyOn(DockerLauncher, "readLogs")
        .mockResolvedValue("level=ERROR msg=a\nlevel=INFO msg=b\n");

      const { lines } = await at(cwd).logs({ tail: 5, level: "error" });

      expect(read).toHaveBeenCalledWith("zitadel-server-abc", "all");
      expect(lines.map((line) => line.text)).toEqual(["level=ERROR msg=a"]);
    });

    it("prints the end of the log at a level, then each line at it the server writes", async () => {
      const cwd = await directoryWithAGoneServer();
      vi.spyOn(BinaryLauncher, "followLogs").mockImplementation(async (_path, sink) => {
        sink.existing("level=WARN msg=old\nlevel=ERROR msg=recent\nlevel=INFO msg=a\n");
        sink.appended("level=INFO msg=b\nlevel=WARN msg=ne");
        sink.appended("w\nlevel=ERROR msg=unfinished");
      });
      const printed: string[] = [];

      await at(cwd).followLogs({
        tail: 1,
        level: "warn",
        print: (lines) => printed.push(...lines.map((line) => line.text)),
      });

      expect(printed).toEqual([
        "level=ERROR msg=recent",
        "level=WARN msg=new",
        "level=ERROR msg=unfinished",
      ]);
    });
  });

  describe("a free port in place of a taken one", () => {
    it("is the first free one after it", async () => {
      vi.spyOn(LocalServer, "isPortFree").mockImplementation((port) =>
        Promise.resolve(port === 3003),
      );

      await expect(LocalServer.nextFreePort(3000)).resolves.toBe(3003);
    });

    it("is none when the next 20 are taken too", async () => {
      const free = vi.spyOn(LocalServer, "isPortFree").mockResolvedValue(false);

      await expect(LocalServer.nextFreePort(3000)).resolves.toBeUndefined();
      expect(free).toHaveBeenCalledTimes(20);
    });

    it("never looks past the last port", async () => {
      const free = vi.spyOn(LocalServer, "isPortFree").mockResolvedValue(false);

      await expect(LocalServer.nextFreePort(65530)).resolves.toBeUndefined();
      expect(free).toHaveBeenLastCalledWith(65535);
    });
  });

  describe("finding the server of a directory", () => {
    const url = "http://localhost:8099";

    function answeringAt(...origins: string[]): void {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL) => {
          const target = new URL(String(input));
          if (target.pathname === "/readyz" && origins.includes(target.origin)) {
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

  describe("a server another CLI release started", () => {
    const url = "http://localhost:8099";
    const options = { cliVersion: "0.0.2" };
    const bundled = String(BinaryLauncher.bundledVersion());

    function answering(): void {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL) => {
          if (new URL(String(input)).pathname === "/readyz") {
            return new Response("ok", { status: 200 });
          }
          throw new TypeError("fetch failed (stub: connection refused)");
        }),
      );
    }

    /** A directory whose recorded process runs, on `serverVersion`, and answers. */
    async function directoryRunning(serverVersion: string): Promise<string> {
      const child = spawn("sleep", ["60"], { stdio: "ignore" });
      children.push(child);
      const cwd = await directory();
      await writeRuntimeMetadata(
        cwd,
        aBinaryRecord({
          pid: child.pid ?? 0,
          command: "/bin/sleep 60",
          server_version: serverVersion,
          log_path: join(cwd, "server.log"),
          data_dir: join(cwd, LOCAL_DATA_DIR),
        }),
      );
      answering();
      return cwd;
    }

    /** A directory whose recorded container runs `image` and answers. */
    async function directoryRunningContainer(image: string): Promise<string> {
      const cwd = await directory();
      await writeRuntimeMetadata(
        cwd,
        aDockerRecord({ image, data_dir: join(cwd, LOCAL_DATA_DIR) }),
      );
      vi.spyOn(DockerLauncher, "inspect").mockResolvedValue({ exists: true, running: true });
      answering();
      return cwd;
    }

    it("is the running process of another release the nearest record names", async () => {
      const cwd = await directoryRunning("0.0.1");

      await expect(LocalServer.outdated(cwd, url, options)).resolves.toMatchObject({
        dir: cwd,
        running: "0.0.1",
        expected: bundled,
      });
    });

    it("is the one in the nearest parent directory that started a server", async () => {
      const cwd = await directoryRunning("0.0.1");
      const app = join(cwd, "my-app");
      await mkdir(app);

      await expect(LocalServer.outdated(app, url, options)).resolves.toMatchObject({ dir: cwd });
    });

    it.each([
      ["this CLI's own release", bundled],
      ["no release, as an override binary records", "override"],
    ])("is not a process that runs %s", async (_case, serverVersion) => {
      const cwd = await directoryRunning(serverVersion);

      await expect(LocalServer.outdated(cwd, url, options)).resolves.toBeUndefined();
    });

    it("is not about a server at another URL", async () => {
      const cwd = await directoryRunning("0.0.1");

      await expect(
        LocalServer.outdated(cwd, "http://localhost:9999", options),
      ).resolves.toBeUndefined();
    });

    it("is not a recorded server that is gone", async () => {
      const cwd = await directoryWithAGoneServer();
      answering();

      await expect(LocalServer.outdated(cwd, url, options)).resolves.toBeUndefined();
    });

    it("is a container of another published release", async () => {
      const cwd = await directoryRunningContainer("ghcr.io/zitadel/nextgen:0.0.1");

      await expect(LocalServer.outdated(cwd, url, options)).resolves.toMatchObject({
        running: "0.0.1",
        expected: "0.0.2",
      });
    });

    it.each([
      ["a moving tag", "ghcr.io/zitadel/nextgen:latest"],
      ["another image", "registry.example/zitadel:0.0.1"],
    ])("is not a container of %s", async (_case, image) => {
      const cwd = await directoryRunningContainer(image);

      await expect(LocalServer.outdated(cwd, url, options)).resolves.toBeUndefined();
    });

    it("is not a container of the image ZITADEL_LOCAL_IMAGE names", async () => {
      const cwd = await directoryRunningContainer("ghcr.io/zitadel/nextgen:0.0.1");

      await expect(
        LocalServer.outdated(cwd, url, {
          ...options,
          env: { ZITADEL_LOCAL_IMAGE: "ghcr.io/zitadel/nextgen:0.0.1" },
        }),
      ).resolves.toBeUndefined();
    });

    it("is refused with start where it was started, then the command to rerun", async () => {
      const cwd = await directoryRunning("0.0.1");
      const app = join(cwd, "my-app");
      await mkdir(app);

      await expect(
        LocalServer.assertCurrent(app, url, {
          ...options,
          rerun: unscopedCommand("console", options.cliVersion),
        }),
      ).rejects.toMatchObject({
        code: "E_CONFLICT",
        message: `The local Zitadel server runs 0.0.1, but this CLI ships ${bundled}`,
        hint: expect.stringContaining(`Run start in ${cwd}, where the server was started.`),
        nextCommands: [
          unscopedCommand(`start --cwd ${cwd}`, options.cliVersion),
          unscopedCommand("console", options.cliVersion),
        ],
        details: { server_url: url, server_version: "0.0.1", cli_server_version: bundled },
      });
    });
  });

  describe("starting over the server the other backend left", () => {
    const none = { values: {}, injected: [] };

    async function directoryRecordingContainer(port: number): Promise<string> {
      const cwd = await directory();
      await writeRuntimeMetadata(
        cwd,
        aDockerRecord({
          port,
          server_url: `http://localhost:${port}`,
          data_dir: join(cwd, LOCAL_DATA_DIR),
        }),
      );
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
});
