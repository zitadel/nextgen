import { chmod, mkdir, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { LOCAL_ADMIN_FILE } from "@/lib/server/local/admin-credential";
import {
  LOCAL_DATA_DIR,
  LOCAL_RUNTIME_FILE,
  PLATFORM_PROJECT_ID,
  defaultLocalServerImageForCliVersion,
  localRuntimePaths,
  writeRuntimeMetadata,
} from "@/lib/server/local/runtime";
import {
  LocalServerDockerMissingError,
  LocalServerInvalidError,
  LocalServerNotRespondingElsewhereError,
  LocalServerNotRespondingError,
  LocalServerNotRunningError,
  LocalServerPortBusyError,
  LocalServerStopError,
  LocalServerUrlInvalidError,
} from "@/lib/server";
import {
  DestroyPermit,
  LocalRuntime,
  ZitadelRuntime,
  type DockerEngine,
  type LocalServers,
  type ServerProcesses,
} from "@/lib/server";
import type { Daemons } from "@tests/fixtures/daemon";
import { aDockerEngine, someProcesses } from "@tests/helpers/local-collaborators";
import { aFakeServerBinary } from "@tests/helpers/local-server";
import { aBinaryRecord, aDockerRecord } from "@tests/helpers/runtime-record";
import { it } from "@tests/unit/lib/server/local/occupied-port";
import type { Serve } from "@tests/fixtures";

/** The start a refused start would offer again. */

const at = (
  cwd: string,
  collaborators: {
    docker?: DockerEngine;
    processes?: ServerProcesses;
    fetcher?: typeof fetch;
    servers?: LocalServers;
    stopPid?: NonNullable<Parameters<typeof LocalRuntime.forFolder>[1]["stopPid"]>;
  } = {},
) => {
  return LocalRuntime.forFolder(cwd, {
    cliVersion: "0.0.0-test",
    servers: { current: async () => ({ supported: true, processes: [] }) },
    stopPid: async (pid) => ({ pid, status: "stale", target: "process" }),
    ...collaborators,
  });
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

describe("LocalRuntime", () => {
  describe("ensureAdmin", () => {
    it("creates the directory's local admin", async ({ dir }) => {
      const { admin } = await at(dir).ensureAdmin();

      expect(admin).toMatchObject({ email: "admin@zitadel.localhost" });
    });

    it("holds the directory's start lock while it does, so a second start waits", async ({
      dir,
    }) => {
      const [first, second] = await Promise.all([at(dir).ensureAdmin(), at(dir).ensureAdmin()]);

      expect(second.admin).toEqual(first.admin);
    });

    it("gives the lock back", async ({ dir }) => {
      await at(dir).ensureAdmin();

      await expect(
        stat(join(localRuntimePaths(dir).runtimeDir, "start.lock")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

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

      await at(cwd).reset(DestroyPermit.forFolder(cwd));

      await expect(stat(join(cwd, LOCAL_DATA_DIR))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(cwd, LOCAL_RUNTIME_FILE))).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("deletes the data and the record when the record cannot be read", async ({ dir: cwd }) => {
      await mkdir(join(cwd, LOCAL_DATA_DIR), { recursive: true });
      await writeFile(join(cwd, LOCAL_RUNTIME_FILE), "{not json");

      await at(cwd).reset(DestroyPermit.forFolder(cwd));

      await expect(stat(join(cwd, LOCAL_DATA_DIR))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(cwd, LOCAL_RUNTIME_FILE))).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("stops the server process running on this folder's data before it deletes the data, when the record cannot be read", async ({
      dir: cwd,
    }) => {
      await mkdir(join(cwd, LOCAL_DATA_DIR), { recursive: true });
      await writeFile(join(cwd, LOCAL_RUNTIME_FILE), "{not json");
      const stopped: number[] = [];
      const dataStillThere: boolean[] = [];

      await at(cwd, {
        servers: {
          current: async () => ({
            supported: true,
            processes: [
              {
                command: "nextgen",
                data_dir: localRuntimePaths(cwd).dataDir,
                kind: "server-binary",
                pid: 4242,
              },
              {
                command: "nextgen",
                data_dir: join(cwd, "elsewhere"),
                kind: "server-binary",
                pid: 4343,
              },
            ],
          }),
        },
        stopPid: async (pid) => {
          stopped.push(pid);
          dataStillThere.push(
            await stat(join(cwd, LOCAL_DATA_DIR)).then(
              () => true,
              () => false,
            ),
          );
          return { pid, status: "stopped", target: "process", signal: "SIGTERM" };
        },
      }).reset(DestroyPermit.forFolder(cwd));

      expect(stopped).toEqual([4242]);
      expect(dataStillThere).toEqual([true]);
      await expect(stat(join(cwd, LOCAL_DATA_DIR))).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("deletes nothing when the server process on this folder's data will not stop", async ({
      dir: cwd,
    }) => {
      await mkdir(join(cwd, LOCAL_DATA_DIR), { recursive: true });
      await writeFile(join(cwd, LOCAL_RUNTIME_FILE), "{not json");

      const rejection = expect(
        at(cwd, {
          servers: {
            current: async () => ({
              supported: true,
              processes: [
                {
                  command: "nextgen",
                  data_dir: localRuntimePaths(cwd).dataDir,
                  kind: "server-binary",
                  pid: 4242,
                },
              ],
            }),
          },
          stopPid: async (pid) => ({ pid, status: "failed", target: "process", signal: "SIGKILL" }),
        }).reset(DestroyPermit.forFolder(cwd)),
      ).rejects;
      await rejection.toBeInstanceOf(LocalServerStopError);
      await rejection.toMatchObject({
        code: "E_VALIDATION",
      });

      await expect(stat(join(cwd, LOCAL_DATA_DIR))).resolves.toBeDefined();
      await expect(stat(join(cwd, LOCAL_RUNTIME_FILE))).resolves.toBeDefined();
    });

    it("deletes nothing when the record cannot be read and the machine's processes cannot be listed", async ({
      dir: cwd,
    }) => {
      await mkdir(join(cwd, LOCAL_DATA_DIR), { recursive: true });
      await writeFile(join(cwd, LOCAL_RUNTIME_FILE), "{not json");

      const rejection = expect(
        at(cwd, {
          servers: { current: async () => ({ supported: false, processes: [], error: "no ps" }) },
        }).reset(DestroyPermit.forFolder(cwd)),
      ).rejects;
      await rejection.toBeInstanceOf(LocalServerInvalidError);
      await rejection.toMatchObject({
        code: "E_VALIDATION",
      });

      await expect(stat(join(cwd, LOCAL_DATA_DIR))).resolves.toBeDefined();
    });

    it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
      "resets a folder whose record it may not read on a machine whose processes cannot be listed",
      async ({ dir: cwd }) => {
        await mkdir(join(cwd, LOCAL_DATA_DIR), { recursive: true });
        await writeFile(join(cwd, LOCAL_RUNTIME_FILE), "{}");
        await chmod(join(cwd, LOCAL_RUNTIME_FILE), 0o000);

        await at(cwd, {
          servers: { current: async () => ({ supported: false, processes: [], error: "no ps" }) },
        }).reset(DestroyPermit.forFolder(cwd));

        await expect(stat(join(cwd, LOCAL_DATA_DIR))).rejects.toMatchObject({ code: "ENOENT" });
      },
    );

    it("resets a folder that never started a server on a machine whose processes cannot be listed", async ({
      dir: cwd,
    }) => {
      await mkdir(join(cwd, LOCAL_DATA_DIR), { recursive: true });

      await at(cwd, {
        servers: { current: async () => ({ supported: false, processes: [], error: "no ps" }) },
      }).reset(DestroyPermit.forFolder(cwd));

      await expect(stat(join(cwd, LOCAL_DATA_DIR))).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("finds the server process of a folder reached through a symlink", async ({
      dir: cwd,
      other,
    }) => {
      await mkdir(join(cwd, LOCAL_DATA_DIR), { recursive: true });
      await writeFile(join(cwd, LOCAL_RUNTIME_FILE), "{not json");
      const link = join(other, "link");
      await symlink(cwd, link);
      const stopped: number[] = [];

      await at(cwd, {
        servers: {
          current: async () => ({
            supported: true,
            processes: [
              {
                command: "nextgen",
                data_dir: localRuntimePaths(link).dataDir,
                kind: "server-binary",
                pid: 4242,
              },
            ],
          }),
        },
        stopPid: async (pid) => {
          stopped.push(pid);
          return { pid, status: "stopped", target: "process", signal: "SIGTERM" };
        },
      }).reset(DestroyPermit.forFolder(cwd));

      expect(stopped).toEqual([4242]);
    });

    it("refuses a permit for another folder, and deletes nothing", async ({ dir: cwd, other }) => {
      await directoryWithAGoneServer(cwd);

      await expect(at(cwd).reset(DestroyPermit.forFolder(other))).rejects.toThrow(
        "The permit is for",
      );
      await expect(stat(join(cwd, LOCAL_DATA_DIR))).resolves.toBeDefined();
    });
  });

  describe("url", () => {
    it("is the default address when the record cannot be read", async ({ dir: cwd }) => {
      await mkdir(join(cwd, LOCAL_DATA_DIR), { recursive: true });
      await writeFile(join(cwd, LOCAL_RUNTIME_FILE), "{not json");

      await expect(at(cwd).url()).resolves.toBe(LocalRuntime.DEFAULT_URL);
    });
  });

  describe("logs", () => {
    it("refuses a directory that never started a server", async ({ dir }) => {
      const rejection = expect(
        at(dir).logs({
          tail: 10,
        }),
      ).rejects;
      await rejection.toBeInstanceOf(LocalServerInvalidError);
      await rejection.toMatchObject({
        code: "E_VALIDATION",
        message: "Local Zitadel runtime has not been started",
      });
    });

    it("reads the end of the server's log", async ({ dir: cwd }) => {
      await directoryWithAGoneServer(cwd);
      await writeFile(join(cwd, "server.log"), "one\ntwo\nthree\n");

      const { lines } = await at(cwd).logs({ tail: 2 });

      expect(lines.drawn(false)).toEqual(["two", "three"]);
    });

    it("picks the last lines at a level from the whole log", async ({ dir: cwd }) => {
      await directoryWithAGoneServer(cwd);
      await writeFile(
        join(cwd, "server.log"),
        "level=WARN msg=first\nlevel=WARN msg=second\nlevel=INFO msg=a\nlevel=INFO msg=b\n",
      );

      const { lines } = await at(cwd).logs({ tail: 1, level: "warn" });

      expect(lines.drawn(false)).toEqual(["level=WARN msg=second"]);
    });

    it("reads all of a container's log to pick the lines at a level", async ({ dir: cwd }) => {
      await writeRuntimeMetadata(cwd, aDockerRecord());
      const asked: Array<[string, number | "all"]> = [];
      const docker = aDockerEngine({
        readLogs: async (name, tail) => {
          asked.push([name, tail]);
          return "level=ERROR msg=a\nlevel=INFO msg=b\n";
        },
      });

      const { lines } = await at(cwd, { docker }).logs({ tail: 5, level: "error" });

      expect(asked).toEqual([["zitadel-server-abc", "all"]]);
      expect(lines.drawn(false)).toEqual(["level=ERROR msg=a"]);
    });

    it("prints the end of the log at a level, then each line at it the server writes", async ({
      dir: cwd,
    }) => {
      await directoryWithAGoneServer(cwd);
      const writing = someProcesses({
        followLogs: async (_path, sink) => {
          sink.existing("level=WARN msg=old\nlevel=ERROR msg=recent\nlevel=INFO msg=a\n");
          sink.appended("level=INFO msg=b\nlevel=WARN msg=ne");
          sink.appended("w\nlevel=ERROR msg=unfinished");
        },
      });
      const printed: string[] = [];

      await at(cwd, { processes: writing }).follow({
        tail: 1,
        level: "warn",
        print: (lines) => printed.push(...lines.drawn(false)),
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

      await at(cwd).follow({
        tail: 5,
        print: (lines) => printed.push(...lines.drawn(false)),
        signal: AbortSignal.abort(),
      });

      expect(printed).toEqual(["level=INFO msg=first", "level=INFO msg=last"]);
    }, 5_000);
  });

  describe("finding the server of a directory", () => {
    const url = "http://localhost:8099";

    function answeringAt(...origins: string[]): typeof fetch {
      return async (input: RequestInfo | URL) => {
        const target = new URL(String(input));
        if (target.pathname === "/readyz" && origins.includes(target.origin)) {
          return new Response("ok", { status: 200 });
        }
        throw new TypeError("fetch failed (connection refused)");
      };
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
      const fetcher = answeringAt(url);

      await expect(LocalRuntime.resolveUrl(cwd, fetcher)).resolves.toBe(url);
    });

    it("is the server of the nearest parent directory that started one", async ({
      dir: cwd,
      daemon,
    }) => {
      await directoryWithARunningServer(cwd, daemon);
      const app = join(cwd, "my-app");
      await mkdir(app);
      const fetcher = answeringAt(url);

      await expect(LocalRuntime.resolveUrl(app, fetcher)).resolves.toBe(url);
    });

    it("is not a server that answers at the recorded URL after the recorded one is gone", async ({
      dir: cwd,
    }) => {
      await directoryWithAGoneServer(cwd);
      const fetcher = answeringAt(url);

      const rejection = expect(LocalRuntime.resolveUrl(cwd, fetcher)).rejects;
      await rejection.toBeInstanceOf(LocalServerNotRespondingError);
      await rejection.toMatchObject({
        code: "E_LOCAL_SERVER_NOT_RUNNING",
      });
    });

    it("is not a server that answers at the recorded URL when the process is another program", async ({
      dir: cwd,
      daemon,
    }) => {
      const child = await daemon.spawn("sleep", ["60"]);
      await directoryRecording(cwd, child.pid, "/opt/zitadel/nextgen --migrate");
      const fetcher = answeringAt(url);

      const rejection = expect(LocalRuntime.resolveUrl(cwd, fetcher)).rejects;
      await rejection.toBeInstanceOf(LocalServerNotRespondingError);
      await rejection.toMatchObject({
        code: "E_LOCAL_SERVER_NOT_RUNNING",
      });
    });

    it("names the folder that holds the record when its server does not answer", async ({
      dir: cwd,
      daemon,
    }) => {
      await directoryWithARunningServer(cwd, daemon);
      const app = join(cwd, "my-app");
      await mkdir(app);

      const rejection = expect(LocalRuntime.resolveUrl(app, answeringAt())).rejects;
      await rejection.toBeInstanceOf(LocalServerNotRespondingElsewhereError);
      await rejection.toMatchObject({
        code: "E_LOCAL_SERVER_NOT_RUNNING",
        message: expect.stringContaining(url),
        directory: cwd,
      });
    });

    it("is not a server that runs but does not answer", async ({ dir: cwd, daemon }) => {
      await directoryWithARunningServer(cwd, daemon);
      const fetcher = answeringAt();

      const rejection = expect(LocalRuntime.resolveUrl(cwd, fetcher)).rejects;
      await rejection.toBeInstanceOf(LocalServerNotRespondingError);
      await rejection.toMatchObject({
        code: "E_LOCAL_SERVER_NOT_RUNNING",
      });
    });

    it("is not whatever answers on the default port when the directory started none", async ({
      dir,
    }) => {
      const fetcher = answeringAt("http://localhost:8080");

      const rejection = expect(LocalRuntime.resolveUrl(dir, fetcher)).rejects;
      await rejection.toBeInstanceOf(LocalServerNotRunningError);
      await rejection.toMatchObject({
        code: "E_LOCAL_SERVER_NOT_RUNNING",
      });
    });

    it("is found as a URL for optional UI when the server runs and answers", async ({
      dir: cwd,
      daemon,
    }) => {
      await directoryWithARunningServer(cwd, daemon);
      const fetcher = answeringAt(url);

      await expect(LocalRuntime.detectUrl(cwd, fetcher)).resolves.toBe(url);
    });

    it("is not found for optional UI when the recorded server is gone", async ({ dir: cwd }) => {
      await directoryWithAGoneServer(cwd);
      const fetcher = answeringAt(url);

      await expect(LocalRuntime.detectUrl(cwd, fetcher)).resolves.toBeUndefined();
    });

    it("is not found for optional UI when the directory started none", async ({ dir }) => {
      const fetcher = answeringAt(url);

      await expect(LocalRuntime.detectUrl(dir, fetcher)).resolves.toBeUndefined();
    });

    it("is not found, and not an error, for optional UI when the record cannot be read", async ({
      dir: cwd,
    }) => {
      await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
      await writeFile(join(cwd, LOCAL_RUNTIME_FILE), "{not json");

      await expect(LocalRuntime.detectUrl(cwd)).resolves.toBeUndefined();
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
      const removed: string[] = [];
      const docker = aDockerEngine({
        remove: async (name) => {
          removed.push(name);
          return true;
        },
      });

      await expect(
        at(cwd, { docker }).start({ backend: "binary", env: none }, { port: await occupiedPort() }),
      ).rejects.toBeInstanceOf(LocalServerPortBusyError);

      expect(removed).toEqual([]);
    });

    it("keeps the port the directory had", async ({ port, dir: cwd, daemon }) => {
      await directoryRecordingContainer(cwd, port);
      const docker = aDockerEngine({ remove: async () => true });
      vi.stubEnv("ZITADEL_SERVER_BINARY", await aFakeServerBinary("plain"));

      const { runtime } = await at(cwd, { docker }).start({ backend: "binary", env: none }, {});

      daemon.adopt(runtime.backend === "binary" ? runtime.pid : 0);
      expect(runtime.port).toBe(port);
    });
  });
});

describe("LocalRuntime start planning", () => {
  const SHELL = {};

  it("keeps the port the folder recorded when none is asked for", async ({ dir }) => {
    await writeRuntimeMetadata(dir, aBinaryRecord({ port: 8123 }));

    expect(await at(dir).plan({ shell: SHELL })).toMatchObject({ port: 8123 });
  });

  it("takes the port it is asked for over the recorded one", async ({ dir }) => {
    await writeRuntimeMetadata(dir, aBinaryRecord({ port: 8123 }));

    expect(await at(dir).plan({ port: 9000, shell: SHELL })).toMatchObject({
      port: 9000,
      apiUrl: "http://localhost:9000",
    });
  });

  it("takes the default port in a folder that started nothing", async ({ dir }) => {
    expect(await at(dir).plan({ shell: SHELL })).toMatchObject({
      backend: "binary",
      port: 8080,
    });
  });

  it.each([
    ["the flag", { image: "flag:1" }, { ZITADEL_LOCAL_IMAGE: "env:1" }, "flag:1"],
    ["the shell's image", {}, { ZITADEL_LOCAL_IMAGE: "env:1" }, "env:1"],
  ])("plans a Docker start with %s as the image", async (_name, request, shell, image) => {
    const plan = await at("/unused").plan({ ...request, shell });

    expect(plan).toMatchObject({ backend: "docker", image });
  });

  it("plans the default image for a Docker start that names none, off a release train", async () => {
    const plan = await at("/unused").plan({ backend: "docker", shell: SHELL });

    expect(plan).toMatchObject({
      backend: "docker",
      image: defaultLocalServerImageForCliVersion("0.0.0-test"),
    });
  });
});

describe("LocalRuntime launch", () => {
  const refusingDocker = aDockerEngine({
    available: async () => {
      throw new Error("no daemon");
    },
  });

  const request = (shell: NodeJS.ProcessEnv) => {
    return { backend: "docker", image: "zitadel:test", shell } as const;
  };

  it("refuses a Docker start when Docker does not answer", async ({ dir }) => {
    const launching = at(dir, { docker: refusingDocker }).launch(request({}));

    await expect(launching).rejects.toBeInstanceOf(LocalServerDockerMissingError);
    await expect(launching).rejects.toMatchObject({
      message: "Docker is not reachable: no daemon",
    });
  });

  it("refuses a Docker start when the daemon answers with a failure", async ({ dir }) => {
    const docker = aDockerEngine({
      available: async () => ({ status: 1, stdout: "", stderr: "daemon is down" }),
    });

    const rejection = expect(
      at(dir, {
        docker,
      }).launch(request({})),
    ).rejects;
    await rejection.toBeInstanceOf(LocalServerDockerMissingError);
    await rejection.toMatchObject({
      message: "Docker is not reachable: daemon is down",
    });
  });

  it.for<readonly [string, NodeJS.ProcessEnv, boolean]>([
    ["by default", {}, true],
    [
      "when the platform project is pinned to the platform one",
      { NEXTGEN_PLATFORM_PROJECT_ID: PLATFORM_PROJECT_ID },
      true,
    ],
    ["unless the bootstrap is turned off", { NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT: "false" }, false],
    [
      "unless the bootstrap is turned off in any case",
      { NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT: "FALSE" },
      false,
    ],
    [
      "unless the server is pinned to a project of its own",
      { NEXTGEN_PLATFORM_PROJECT_ID: "proj_mine" },
      false,
    ],
  ])("creates the local admin %s", async ([_name, shell, creates], { dir }) => {
    await at(dir, { docker: refusingDocker })
      .launch(request(shell))
      .catch(() => undefined);

    const written = await stat(join(dir, LOCAL_ADMIN_FILE)).then(
      () => true,
      () => false,
    );
    expect(written).toBe(creates);
  });
});

describe("LocalRuntime.findStartedFrom", () => {
  it("finds the folder itself when it started a server", async ({ dir }) => {
    await directoryWithAGoneServer(dir);

    const found = await LocalRuntime.findStartedFrom(dir, { cliVersion: "0.0.0-test" });

    expect(found?.dataDirectory()).toBe(localRuntimePaths(dir).dataDir);
  });

  it("walks up to the nearest parent that started one", async ({ dir }) => {
    await directoryWithAGoneServer(dir);
    const app = join(dir, "apps", "web");
    await mkdir(app, { recursive: true });

    const found = await LocalRuntime.findStartedFrom(app, { cliVersion: "0.0.0-test" });

    expect(found?.dataDirectory()).toBe(localRuntimePaths(dir).dataDir);
  });

  it("answers nothing when no folder above started one", async ({ dir }) => {
    const found = await LocalRuntime.findStartedFrom(dir, { cliVersion: "0.0.0-test" });

    expect(found).toBeUndefined();
  });
});

describe("LocalRuntime.stopAll", () => {
  it("says so when the processes of this machine cannot be listed", async () => {
    const servers = { current: async () => ({ supported: false, error: "no ps", processes: [] }) };

    expect(await LocalRuntime.stopAll(servers)).toEqual({ supported: false, error: "no ps" });
  });

  it("stops nothing when no server runs", async () => {
    const servers = { current: async () => ({ supported: true, processes: [] }) };

    expect(await LocalRuntime.stopAll(servers)).toEqual({ supported: true, results: [] });
  });
});

describe("ZitadelRuntime.resolve", () => {
  it("falls back to ZitadelRuntime.DEFAULT when no flag is given", async ({ dir }) => {
    const resolved = await ZitadelRuntime.resolve({ cwd: dir });
    expect(resolved).toEqual({ value: ZitadelRuntime.DEFAULT, origin: "default" });
  });

  it("ignores the server in zitadel.json", async ({ dir }) => {
    await writeFile(
      join(dir, "zitadel.json"),
      JSON.stringify({ server: "https://config.example.com" }),
      "utf8",
    );
    const resolved = await ZitadelRuntime.resolve({ cwd: dir });
    expect(resolved).toEqual({ value: ZitadelRuntime.DEFAULT, origin: "default" });
  });

  it("uses the --server flag", async ({ dir }) => {
    const resolved = await ZitadelRuntime.resolve({
      cwd: dir,
      serverFlag: "https://flag.example.com",
    });
    expect(resolved).toEqual({ value: "https://flag.example.com", origin: "flag" });
  });

  it("normalises a resolved URL down to its origin", async ({ dir }) => {
    const resolved = await ZitadelRuntime.resolve({
      cwd: dir,
      serverFlag: "https://flag.example.com/some/path?q=1",
    });
    expect(resolved).toEqual({ value: "https://flag.example.com", origin: "flag" });
  });

  it("rejects a non-http(s) URL with E_VALIDATION", async ({ dir }) => {
    const rejection = expect(
      ZitadelRuntime.resolve({
        cwd: dir,
        serverFlag: "ftp://flag.example.com",
      }),
    ).rejects;
    await rejection.toBeInstanceOf(LocalServerUrlInvalidError);
    await rejection.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("rejects an unparseable URL with E_VALIDATION", async ({ dir }) => {
    const rejection = expect(
      ZitadelRuntime.resolve({
        cwd: dir,
        serverFlag: "not a url",
      }),
    ).rejects;
    await rejection.toBeInstanceOf(LocalServerUrlInvalidError);
    await rejection.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("resolves --server local from healthy local runtime metadata", async ({ dir, serve }) => {
    const serverUrl = await startHealthServer(serve);
    await writeLocalRuntime(dir, serverUrl);

    const resolved = await ZitadelRuntime.resolve({ cwd: dir, serverFlag: "local" });

    expect(resolved).toEqual({ value: serverUrl, origin: "local" });
  });

  it("fails --server local when runtime metadata points at an unhealthy server", async ({
    dir,
  }) => {
    await writeLocalRuntime(dir, "http://localhost:9");

    const rejection = expect(
      ZitadelRuntime.resolve({
        cwd: dir,
        serverFlag: "local",
      }),
    ).rejects;
    await rejection.toBeInstanceOf(LocalServerNotRespondingError);
    await rejection.toMatchObject({
      code: "E_LOCAL_SERVER_NOT_RUNNING",
    });
  });
});

async function writeLocalRuntime(dir: string, serverUrl: string): Promise<void> {
  const paths = localRuntimePaths(dir);
  await mkdir(paths.runtimeDir, { recursive: true });
  await writeFile(
    paths.runtimeFile,
    JSON.stringify(
      aBinaryRecord({
        pid: process.pid,
        command: process.execPath,
        log_path: paths.logFile,
        port: Number(new URL(serverUrl).port),
        server_url: serverUrl,
        data_dir: paths.dataDir,
      }),
    ),
    "utf8",
  );
}

function startHealthServer(serve: Serve): Promise<string> {
  return serve((req, res) => {
    if (req.url === "/readyz") {
      res.writeHead(200).end("ok");
      return;
    }
    res.writeHead(404).end();
  });
}

describe("ZitadelRuntime.parse", () => {
  it("gives the origin of a URL", () => {
    expect(ZitadelRuntime.parse(" https://api.example.com/some/path ")).toEqual({
      ok: true,
      value: "https://api.example.com",
    });
  });

  it("reports a URL with no scheme instead of throwing", () => {
    expect(ZitadelRuntime.parse("preview.zitadel.com")).toMatchObject({ ok: false });
  });

  it("reports an empty answer", () => {
    expect(ZitadelRuntime.parse("  ")).toEqual({
      ok: false,
      problem: "The server URL cannot be empty",
    });
  });
});

describe("ZitadelRuntime.origin", () => {
  it("throws a LocalServerUrlInvalidError for an address that is not http(s)", () => {
    expect(() => {
      return ZitadelRuntime.origin("ftp://acme.example");
    }).toThrow(LocalServerUrlInvalidError);
  });
});

describe("Server.isLoopback", () => {
  it.for(["http://localhost:8080", "http://127.0.0.1", "http://[::1]:3000/path"])(
    "accepts %s",
    (url) => {
      expect(ZitadelRuntime.fromUrl(url).isLoopback()).toBe(true);
    },
  );

  it.for(["https://example.com", "http://10.0.0.1:8080", "not a url", ""])("rejects %s", (url) => {
    expect(ZitadelRuntime.fromUrl(url).isLoopback()).toBe(false);
  });
});

describe("Server.hostUnlessDefault", () => {
  it("says nothing for the default server", () => {
    expect(ZitadelRuntime.fromUrl(ZitadelRuntime.DEFAULT).hostUnlessDefault()).toBeUndefined();
  });

  it("names the host of any other server", () => {
    expect(ZitadelRuntime.fromUrl("https://auth.example.com/some/path").hostUnlessDefault()).toBe(
      "auth.example.com",
    );
  });

  it("says nothing for an address that is not a URL", () => {
    expect(ZitadelRuntime.fromUrl("not a url").hostUnlessDefault()).toBeUndefined();
  });
});

describe("Server.isCloud", () => {
  it.for([ZitadelRuntime.DEFAULT, "https://preview.zitadel.com/path"])("accepts %s", (url) => {
    expect(ZitadelRuntime.fromUrl(url).isCloud()).toBe(true);
  });

  it.for(["https://auth.example.com", "http://localhost:8080", "https://acme.zitadel.com", "x"])(
    "rejects %s",
    (url) => {
      expect(ZitadelRuntime.fromUrl(url).isCloud()).toBe(false);
    },
  );
});

describe("Server.consoleUrl", () => {
  it("is /console/ on the hosted cloud", () => {
    expect(ZitadelRuntime.fromUrl("https://preview.zitadel.com/api/v1").consoleUrl()).toBe(
      "https://preview.zitadel.com/console/",
    );
  });

  it("is /ui/console/ on any other server", () => {
    expect(ZitadelRuntime.fromUrl("https://auth.example.com").consoleUrl()).toBe(
      "https://auth.example.com/ui/console/",
    );
  });

  it("refuses an address that is not a URL", () => {
    expect(() => ZitadelRuntime.fromUrl("not a url").consoleUrl()).toThrow(/Invalid server/);
  });
});

describe("Server.kind", () => {
  it("buckets a server without leaking its address", () => {
    expect(ZitadelRuntime.fromUrl("https://preview.zitadel.com").kind).toBe("cloud");
    expect(ZitadelRuntime.fromUrl("https://preview.zitadel.com").kind).toBe("cloud");
    expect(ZitadelRuntime.fromUrl("https://acme.zitadel.com").kind).toBe("self_hosted");
    expect(ZitadelRuntime.fromUrl("http://localhost:8080").kind).toBe("local");
    expect(ZitadelRuntime.fromUrl("http://127.0.0.1:8080").kind).toBe("local");
    expect(ZitadelRuntime.fromUrl("http://127.0.0.2:8080").kind).toBe("local");
    expect(ZitadelRuntime.fromUrl("http://[::1]:8080").kind).toBe("local");
    expect(ZitadelRuntime.fromUrl("mock").kind).toBe("local");
    expect(ZitadelRuntime.fromUrl("https://auth.internal.acme.com").kind).toBe("self_hosted");
    expect(ZitadelRuntime.fromUrl("not a url").kind).toBe("unknown");
  });

  it("does not classify lookalike domains as cloud", () => {
    expect(ZitadelRuntime.fromUrl("https://foopreview.zitadel.com").kind).toBe("self_hosted");
    expect(ZitadelRuntime.fromUrl("https://preview.zitadel.com.evil.example").kind).toBe(
      "self_hosted",
    );
    expect(ZitadelRuntime.fromUrl("https://notpreview.zitadel.com").kind).toBe("self_hosted");
    expect(ZitadelRuntime.fromUrl("https://zitadel.com").kind).toBe("self_hosted");
  });
});
