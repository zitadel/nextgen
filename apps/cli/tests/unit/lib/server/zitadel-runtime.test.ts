import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, vi } from "vitest";

import { ensureLocalAdmin, type LocalAdmin } from "@/lib/server/local/admin-credential";
import { BinaryLauncher } from "@/lib/server/local/internal/binary-launcher";
import { DockerLauncher } from "@/lib/server/local/internal/docker-launcher";
import {
  LOCAL_DATA_DIR,
  LOCAL_RUNTIME_FILE,
  localRuntimePaths,
  writeRuntimeMetadata,
} from "@/lib/server/local/runtime";
import { DestroyPermit, LocalRuntime, PortInUseError, ZitadelRuntime } from "@/lib/server";
import type { Daemons } from "@tests/fixtures/daemon";
import { aFakeServerBinary } from "@tests/helpers/local-server";
import { aBinaryRecord, aDockerRecord } from "@tests/helpers/runtime-record";
import { it } from "@tests/unit/lib/server/local/occupied-port";
import type { Serve } from "@tests/fixtures";

// The real credential code, replaceable per test: what it does while it runs
// is how a test sees that the start lock is held around it.
vi.mock("@/lib/server/local/admin-credential", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/local/admin-credential")>();
  return { ...actual, ensureLocalAdmin: vi.fn(actual.ensureLocalAdmin) };
});

/** A local admin, for a test that is not about its fields. */
const AN_ADMIN: LocalAdmin = {
  email: "admin@zitadel.localhost",
  password: "not-a-real-password",
  user_id: "user_localadmin",
  team_id: "team_localadmin",
};

/** The start a refused start would offer again. */

const at = (cwd: string) => {
  return LocalRuntime.forFolder(cwd, { cliVersion: "0.0.0-test" });
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
      const heldBy: string[] = [];
      vi.mocked(ensureLocalAdmin).mockImplementationOnce(async () => {
        heldBy.push(await readFile(join(localRuntimePaths(dir).runtimeDir, "start.lock"), "utf8"));
        return { admin: AN_ADMIN, userFile: "" };
      });

      await at(dir).ensureAdmin();

      expect(heldBy).toEqual([String(process.pid)]);
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

    it("refuses a permit for another folder, and deletes nothing", async ({ dir: cwd, other }) => {
      await directoryWithAGoneServer(cwd);

      await expect(at(cwd).reset(DestroyPermit.forFolder(other))).rejects.toThrow(
        "The permit is for",
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
      const read = vi
        .spyOn(DockerLauncher, "readLogs")
        .mockResolvedValue("level=ERROR msg=a\nlevel=INFO msg=b\n");

      const { lines } = await at(cwd).logs({ tail: 5, level: "error" });

      expect(read).toHaveBeenCalledWith("zitadel-server-abc", "all");
      expect(lines.drawn(false)).toEqual(["level=ERROR msg=a"]);
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

      await at(cwd).follow({
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

  describe("a free port in place of a taken one", () => {
    it("is the first free one after it", async () => {
      vi.spyOn(LocalRuntime, "isPortFree").mockImplementation((port) =>
        Promise.resolve(port === 3003),
      );

      await expect(LocalRuntime.nextFreePort(3000)).resolves.toBe(3003);
    });

    it("is none when the next 20 are taken too", async () => {
      const free = vi.spyOn(LocalRuntime, "isPortFree").mockResolvedValue(false);

      await expect(LocalRuntime.nextFreePort(3000)).resolves.toBeUndefined();
      expect(free).toHaveBeenCalledTimes(20);
    });

    it("never looks past the last port", async () => {
      const free = vi.spyOn(LocalRuntime, "isPortFree").mockResolvedValue(false);

      await expect(LocalRuntime.nextFreePort(65530)).resolves.toBeUndefined();
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

      await expect(LocalRuntime.resolveUrl(cwd)).resolves.toBe(url);
    });

    it("is the server of the nearest parent directory that started one", async ({
      dir: cwd,
      daemon,
    }) => {
      await directoryWithARunningServer(cwd, daemon);
      const app = join(cwd, "my-app");
      await mkdir(app);
      answeringAt(url);

      await expect(LocalRuntime.resolveUrl(app)).resolves.toBe(url);
    });

    it("is not a server that answers at the recorded URL after the recorded one is gone", async ({
      dir: cwd,
    }) => {
      await directoryWithAGoneServer(cwd);
      answeringAt(url);

      await expect(LocalRuntime.resolveUrl(cwd)).rejects.toMatchObject({
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

      await expect(LocalRuntime.resolveUrl(cwd)).rejects.toMatchObject({
        code: "E_LOCAL_SERVER_NOT_RUNNING",
      });
    });

    it("is not a server that runs but does not answer", async ({ dir: cwd, daemon }) => {
      await directoryWithARunningServer(cwd, daemon);
      answeringAt();

      await expect(LocalRuntime.resolveUrl(cwd)).rejects.toMatchObject({
        code: "E_LOCAL_SERVER_NOT_RUNNING",
      });
    });

    it("is not whatever answers on the default port when the directory started none", async ({
      dir,
    }) => {
      answeringAt("http://localhost:8080");

      await expect(LocalRuntime.resolveUrl(dir)).rejects.toMatchObject({
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

      await expect(LocalRuntime.detectUrl(cwd)).resolves.toBe(url);
    });

    it("is not found for optional UI when the recorded server is gone", async ({ dir: cwd }) => {
      await directoryWithAGoneServer(cwd);
      answeringAt(url);

      await expect(LocalRuntime.detectUrl(cwd)).resolves.toBeUndefined();
    });

    it("is not found for optional UI when the directory started none", async ({ dir }) => {
      answeringAt(url);

      await expect(LocalRuntime.detectUrl(dir)).resolves.toBeUndefined();
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
      const remove = vi.spyOn(DockerLauncher, "remove").mockResolvedValue(true);

      await expect(
        at(cwd).start({ backend: "binary", env: none }, { port: await occupiedPort() }),
      ).rejects.toBeInstanceOf(PortInUseError);

      expect(remove).not.toHaveBeenCalled();
    });

    it("keeps the port the directory had", async ({ port, dir: cwd, daemon }) => {
      await directoryRecordingContainer(cwd, port);
      vi.spyOn(DockerLauncher, "remove").mockResolvedValue(true);
      vi.stubEnv("ZITADEL_SERVER_BINARY", await aFakeServerBinary("plain"));

      const { runtime } = await at(cwd).start({ backend: "binary", env: none }, {});

      daemon.adopt(runtime.backend === "binary" ? runtime.pid : 0);
      expect(runtime.port).toBe(port);
    });
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
    await expect(
      ZitadelRuntime.resolve({ cwd: dir, serverFlag: "ftp://flag.example.com" }),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("rejects an unparseable URL with E_VALIDATION", async ({ dir }) => {
    await expect(
      ZitadelRuntime.resolve({ cwd: dir, serverFlag: "not a url" }),
    ).rejects.toMatchObject({
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

    await expect(ZitadelRuntime.resolve({ cwd: dir, serverFlag: "local" })).rejects.toMatchObject({
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
    expect(ZitadelRuntime.parse("api.zitadel.cloud")).toMatchObject({ ok: false });
  });

  it("reports an empty answer", () => {
    expect(ZitadelRuntime.parse("  ")).toEqual({
      ok: false,
      problem: "The server URL cannot be empty",
    });
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
  it.for([ZitadelRuntime.DEFAULT, "https://acme.zitadel.cloud", "https://zitadel.cloud/path"])(
    "accepts %s",
    (url) => {
      expect(ZitadelRuntime.fromUrl(url).isCloud()).toBe(true);
    },
  );

  it.for(["https://auth.example.com", "http://localhost:8080", "https://evilzitadel.cloud", "x"])(
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
    expect(ZitadelRuntime.fromUrl("https://api.zitadel.cloud").kind).toBe("cloud");
    expect(ZitadelRuntime.fromUrl("https://acme.zitadel.cloud").kind).toBe("cloud");
    expect(ZitadelRuntime.fromUrl("http://localhost:8080").kind).toBe("local");
    expect(ZitadelRuntime.fromUrl("http://127.0.0.1:8080").kind).toBe("local");
    expect(ZitadelRuntime.fromUrl("http://127.0.0.2:8080").kind).toBe("local");
    expect(ZitadelRuntime.fromUrl("http://[::1]:8080").kind).toBe("local");
    expect(ZitadelRuntime.fromUrl("mock").kind).toBe("local");
    expect(ZitadelRuntime.fromUrl("https://auth.internal.acme.com").kind).toBe("self_hosted");
    expect(ZitadelRuntime.fromUrl("not a url").kind).toBe("unknown");
  });

  it("does not classify lookalike domains as cloud", () => {
    expect(ZitadelRuntime.fromUrl("https://foozitadel.cloud").kind).toBe("self_hosted");
    expect(ZitadelRuntime.fromUrl("https://notzitadel.cloud").kind).toBe("self_hosted");
    expect(ZitadelRuntime.fromUrl("https://zitadel.cloud").kind).toBe("cloud");
    expect(ZitadelRuntime.fromUrl("https://notpreview.zitadel.com").kind).toBe("self_hosted");
    expect(ZitadelRuntime.fromUrl("https://zitadel.com").kind).toBe("self_hosted");
  });
});
