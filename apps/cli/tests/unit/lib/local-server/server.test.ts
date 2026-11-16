import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, vi } from "vitest";

import { BinaryLauncher } from "@/lib/local-server/internal/binary-launcher";
import { DockerLauncher } from "@/lib/local-server/internal/docker-launcher";
import {
  LOCAL_DATA_DIR,
  LOCAL_RUNTIME_FILE,
  writeRuntimeMetadata,
} from "@/lib/local-server/runtime";
import { LocalServer } from "@/lib/local-server/server";
import type { Daemons } from "@tests/fixtures/daemon";
import { aFakeServerBinary } from "@tests/helpers/local-server";
import { forcedConsent } from "@tests/helpers/consent";
import { aBinaryRecord, aDockerRecord } from "@tests/helpers/runtime-record";
import { aSuggest } from "@tests/helpers/suggestions";
import { it } from "@tests/unit/lib/local-server/occupied-port";

/** The start a refused start would offer again. */
const RETRY = aSuggest()({ id: "start" });

const at = (cwd: string) => {
  return LocalServer.at(cwd, { cliVersion: "0.0.0-test" });
};

/**
 * Records, in a directory that has data, a server whose process is long gone.
 *
 * @param cwd - The directory.
 * @returns Once the record is written.
 */
async function directoryWithAGoneServer(cwd: string): Promise<void> {
  await directoryRecording(cwd, 2_147_483_000, "nextgen --migrate");
}

/**
 * Records a binary server in a directory that has data.
 *
 * @param cwd - The directory.
 * @param pid - The process the record names.
 * @param command - The command the record says it was started with.
 * @returns Once the record is written.
 */
async function directoryRecording(cwd: string, pid: number, command: string): Promise<void> {
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
}

describe("LocalServer", () => {
  describe("status", () => {
    it("is missing for a directory that never started a server", async ({ dir }) => {
      await expect(at(dir).status()).resolves.toMatchObject({
        lifecycle: "missing",
        healthy: false,
      });
    });

    it("is stopped when the recorded process is gone", async ({ dir }) => {
      await directoryWithAGoneServer(dir);

      await expect(at(dir).status()).resolves.toMatchObject({
        lifecycle: "stopped",
        process: { pid: 2_147_483_000, running: false },
      });
    });
  });

  describe("stop", () => {
    it("reports nothing stopped for a directory that never started a server", async ({ dir }) => {
      await expect(at(dir).stop()).resolves.toMatchObject({
        runtime: undefined,
        stopped: false,
      });
    });

    it("reports nothing stopped where Docker is not installed", async ({ dir, other }) => {
      vi.stubEnv("PATH", other);

      await expect(at(dir).stop()).resolves.toMatchObject({
        runtime: undefined,
        stopped: false,
      });
    });

    it("reports nothing stopped when the recorded process is already gone", async ({ dir }) => {
      await directoryWithAGoneServer(dir);

      await expect(at(dir).stop()).resolves.toMatchObject({
        stopped: false,
        outcome: { status: "stale" },
      });
    });

    it("keeps the data and the record", async ({ dir: cwd }) => {
      await directoryWithAGoneServer(cwd);

      await at(cwd).stop();

      await expect(stat(join(cwd, LOCAL_DATA_DIR))).resolves.toBeDefined();
      await expect(stat(join(cwd, LOCAL_RUNTIME_FILE))).resolves.toBeDefined();
    });
  });

  describe("a recorded pid that now belongs to another program", () => {
    const exists = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    it.skipIf(process.platform === "win32")(
      "is not signalled by stop",
      async ({ dir: cwd, daemon }) => {
        const child = await daemon.spawn("sleep", ["60"]);
        await directoryRecording(cwd, child.pid, "/opt/zitadel/nextgen --migrate");

        await expect(at(cwd).stop()).resolves.toMatchObject({
          stopped: false,
          outcome: { status: "stale" },
        });
        expect(exists(child.pid)).toBe(true);
      },
    );

    it.skipIf(process.platform === "win32")(
      "is not reported as the running server",
      async ({ dir: cwd, daemon }) => {
        const child = await daemon.spawn("sleep", ["60"]);
        await directoryRecording(cwd, child.pid, "/opt/zitadel/nextgen --migrate");

        await expect(at(cwd).status()).resolves.toMatchObject({
          process: { running: false },
        });
      },
    );

    it.skipIf(process.platform === "win32")(
      "is stopped when it is the recorded server",
      async ({ dir: cwd, daemon }) => {
        const child = await daemon.spawn("sleep", ["60"]);
        await directoryRecording(cwd, child.pid, "/bin/sleep 60");

        await expect(at(cwd).stop()).resolves.toMatchObject({ stopped: true });
        await child.stop();
      },
    );
  });

  describe("reset", () => {
    it("deletes the data and the record, even when the recorded process is gone", async ({
      dir: cwd,
    }) => {
      await directoryWithAGoneServer(cwd);

      await at(cwd).reset(await forcedConsent());

      await expect(stat(join(cwd, LOCAL_DATA_DIR))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(cwd, LOCAL_RUNTIME_FILE))).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("refuses without consent, and deletes nothing", async ({ dir: cwd }) => {
      await directoryWithAGoneServer(cwd);

      await expect(at(cwd).reset({} as never)).rejects.toThrow(
        "A destructive operation ran without consent",
      );
      await expect(stat(join(cwd, LOCAL_DATA_DIR))).resolves.toBeDefined();
    });
  });

  describe("logs", () => {
    it("refuses a directory that never started a server, and says how to start one", async ({
      dir,
    }) => {
      await expect(at(dir).logs({ tail: 10 })).rejects.toMatchObject({
        code: "E_VALIDATION",
        hint: "Run `zitadel start` first.",
      });
    });

    it("reads the end of the server's log", async ({ dir: cwd }) => {
      await directoryWithAGoneServer(cwd);
      await writeFile(join(cwd, "server.log"), "one\ntwo\nthree\n");

      const { lines } = await at(cwd).logs({ tail: 2 });

      expect(lines.map((line) => line.text)).toEqual(["two", "three"]);
    });

    it("picks the last lines at a level from the whole log", async ({ dir: cwd }) => {
      await directoryWithAGoneServer(cwd);
      await writeFile(
        join(cwd, "server.log"),
        "level=WARN msg=first\nlevel=WARN msg=second\nlevel=INFO msg=a\nlevel=INFO msg=b\n",
      );

      const { lines } = await at(cwd).logs({ tail: 1, level: "warn" });

      expect(lines.map((line) => line.text)).toEqual(["level=WARN msg=second"]);
    });

    it("reads all of a container's log to pick the lines at a level", async ({ dir: cwd }) => {
      await writeRuntimeMetadata(cwd, aDockerRecord());
      const read = vi
        .spyOn(DockerLauncher, "readLogs")
        .mockResolvedValue("level=ERROR msg=a\nlevel=INFO msg=b\n");

      const { lines } = await at(cwd).logs({ tail: 5, level: "error" });

      expect(read).toHaveBeenCalledWith("zitadel-server-abc", "all");
      expect(lines.map((line) => line.text)).toEqual(["level=ERROR msg=a"]);
    });

    it("prints the end of the log at a level, then each line at it the server writes", async ({
      dir: cwd,
    }) => {
      await directoryWithAGoneServer(cwd);
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
        signal: new AbortController().signal,
      });

      expect(printed).toEqual([
        "level=ERROR msg=recent",
        "level=WARN msg=new",
        "level=ERROR msg=unfinished",
      ]);
    });

    it("prints the end of the log and stops when the run was interrupted before it began", async ({
      dir: cwd,
    }) => {
      await directoryWithAGoneServer(cwd);
      await writeFile(join(cwd, "server.log"), "level=INFO msg=first\nlevel=INFO msg=last\n");
      const printed: string[] = [];

      await at(cwd).followLogs({
        tail: 5,
        print: (lines) => printed.push(...lines.map((line) => line.text)),
        signal: AbortSignal.abort(),
      });

      expect(printed).toEqual(["level=INFO msg=first", "level=INFO msg=last"]);
    }, 5_000);
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

    async function directoryWithARunningServer(cwd: string, daemon: Daemons): Promise<void> {
      const child = await daemon.spawn("sleep", ["60"]);
      await directoryRecording(cwd, child.pid, "/bin/sleep 60");
    }

    it("is the URL the directory's record names, when that server runs and answers", async ({
      dir: cwd,
      daemon,
    }) => {
      await directoryWithARunningServer(cwd, daemon);
      answeringAt(url);

      await expect(LocalServer.resolveUrl(cwd)).resolves.toBe(url);
    });

    it("is the server of the nearest parent directory that started one", async ({
      dir: cwd,
      daemon,
    }) => {
      await directoryWithARunningServer(cwd, daemon);
      const app = join(cwd, "my-app");
      await mkdir(app);
      answeringAt(url);

      await expect(LocalServer.resolveUrl(app)).resolves.toBe(url);
    });

    it("is not a server that answers at the recorded URL after the recorded one is gone", async ({
      dir: cwd,
    }) => {
      await directoryWithAGoneServer(cwd);
      answeringAt(url);

      await expect(LocalServer.resolveUrl(cwd)).rejects.toMatchObject({
        code: "E_LOCAL_SERVER_NOT_RUNNING",
      });
    });

    it("is not a server that answers at the recorded URL when the process is another program", async ({
      dir: cwd,
      daemon,
    }) => {
      const child = await daemon.spawn("sleep", ["60"]);
      await directoryRecording(cwd, child.pid, "/opt/zitadel/nextgen --migrate");
      answeringAt(url);

      await expect(LocalServer.resolveUrl(cwd)).rejects.toMatchObject({
        code: "E_LOCAL_SERVER_NOT_RUNNING",
      });
    });

    it("is not a server that runs but does not answer", async ({ dir: cwd, daemon }) => {
      await directoryWithARunningServer(cwd, daemon);
      answeringAt();

      await expect(LocalServer.resolveUrl(cwd)).rejects.toMatchObject({
        code: "E_LOCAL_SERVER_NOT_RUNNING",
      });
    });

    it("is not whatever answers on the default port when the directory started none", async ({
      dir,
    }) => {
      answeringAt("http://localhost:8080");

      await expect(LocalServer.resolveUrl(dir)).rejects.toMatchObject({
        code: "E_LOCAL_SERVER_NOT_RUNNING",
        hint: "No local server has been started in this directory or a parent. Run `zitadel start`, or name a server another directory started with --server <url>.",
      });
    });

    it("is found as a URL for optional UI when the server runs and answers", async ({
      dir: cwd,
      daemon,
    }) => {
      await directoryWithARunningServer(cwd, daemon);
      answeringAt(url);

      await expect(LocalServer.detectUrl(cwd)).resolves.toBe(url);
    });

    it("is not found for optional UI when the recorded server is gone", async ({ dir: cwd }) => {
      await directoryWithAGoneServer(cwd);
      answeringAt(url);

      await expect(LocalServer.detectUrl(cwd)).resolves.toBeUndefined();
    });

    it("is not found for optional UI when the directory started none", async ({ dir }) => {
      answeringAt(url);

      await expect(LocalServer.detectUrl(dir)).resolves.toBeUndefined();
    });

    it("is not found, and not an error, for optional UI when the record cannot be read", async ({
      dir: cwd,
    }) => {
      await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
      await writeFile(join(cwd, LOCAL_RUNTIME_FILE), "{not json");

      await expect(LocalServer.detectUrl(cwd)).resolves.toBeUndefined();
    });
  });

  describe("starting over the server the other backend left", () => {
    const none = { values: {}, injected: [] };

    async function directoryRecordingContainer(cwd: string, port: number): Promise<void> {
      await writeRuntimeMetadata(
        cwd,
        aDockerRecord({
          port,
          server_url: `http://localhost:${port}`,
          data_dir: join(cwd, LOCAL_DATA_DIR),
        }),
      );
    }

    it("leaves it running when the port it is asked to move to is held", async ({
      port,
      dir: cwd,
      occupiedPort,
    }) => {
      await directoryRecordingContainer(cwd, port);
      const remove = vi.spyOn(DockerLauncher, "remove").mockResolvedValue(true);

      await expect(
        at(cwd).start(
          { backend: "binary", env: none },
          { port: await occupiedPort(), retry: RETRY },
        ),
      ).rejects.toMatchObject({ code: "E_PORT_IN_USE" });

      expect(remove).not.toHaveBeenCalled();
    });

    it("keeps the port the directory had", async ({ port, dir: cwd, daemon }) => {
      await directoryRecordingContainer(cwd, port);
      vi.spyOn(DockerLauncher, "remove").mockResolvedValue(true);
      vi.stubEnv("ZITADEL_SERVER_BINARY", await aFakeServerBinary("plain"));

      const { runtime } = await at(cwd).start({ backend: "binary", env: none }, { retry: RETRY });

      daemon.adopt(runtime.backend === "binary" ? runtime.pid : 0);
      expect(runtime.port).toBe(port);
    });
  });
});
