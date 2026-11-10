import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, vi } from "vitest";

import { it, type Serve } from "@tests/helpers/fixtures";

import { ZitadelError } from "@/lib/errors";
import {
  LOCAL_RUNTIME_FILE,
  checkLocalServerHealth,
  defaultLocalServerImageForCliVersion,
  findUpward,
  ensureContainerIdentity,
  ensureLocalState,
  localContainerName,
  localRuntimePaths,
  loopbackReach,
  readNearestRuntimeMetadata,
  readPlatformRuntime,
  readRuntimeMetadata,
  removeLocalData,
  resolveRuntimeBackend,
  retargetMalformedRuntime,
  sameLocalServer,
  writeRuntimeMetadata,
  type RuntimeMetadata,
} from "@/lib/local-server/runtime";

describe("local server runtime metadata", () => {
  it.each([
    ["0.1.0-alpha.5", "ghcr.io/zitadel/nextgen:0.1.0-alpha.5"],
    ["v0.1.0-alpha.5", "ghcr.io/zitadel/nextgen:0.1.0-alpha.5"],
    ["0.0.0-test", "ghcr.io/zitadel/nextgen:latest"],
    ["0.1.0", "ghcr.io/zitadel/nextgen:0.1.0"],
    ["1.0.0-beta.2", "ghcr.io/zitadel/nextgen:latest"],
  ])("derives the default image for CLI version %s", (cliVersion, image) => {
    expect(defaultLocalServerImageForCliVersion(cliVersion)).toBe(image);
  });

  it("creates local state and gitignores it", async ({ dir: cwd }) => {
    const paths = await ensureLocalState(cwd);

    expect((await stat(paths.dataDir)).isDirectory()).toBe(true);
    await expect(readFile(join(cwd, ".gitignore"), "utf8")).resolves.toContain(".zitadel/local/");
  });

  it("round-trips runtime metadata", async ({ dir: cwd }) => {
    const metadata = runtimeFor(cwd);

    await writeRuntimeMetadata(cwd, metadata);

    await expect(readRuntimeMetadata(cwd)).resolves.toEqual(metadata);
    await expect(readFile(join(cwd, LOCAL_RUNTIME_FILE), "utf8")).resolves.toContain(
      "ghcr.io/zitadel/nextgen:test",
    );
  });

  it("round-trips binary runtime metadata", async ({ dir: cwd }) => {
    const paths = localRuntimePaths(cwd);
    const metadata: RuntimeMetadata = {
      schema_version: 1,
      backend: "binary",
      pid: 12345,
      command: "node /path/to/zitadel-server.js",
      log_path: paths.logFile,
      server_package: "@zitadel/server",
      server_version: "0.1.0-alpha.5",
      port: 8081,
      server_url: "http://localhost:8081",
      data_dir: paths.dataDir,
      created_at: "2026-06-09T00:00:00.000Z",
      cli_version: "0.0.0-test",
    };

    await writeRuntimeMetadata(cwd, metadata);

    await expect(readRuntimeMetadata(cwd)).resolves.toEqual(metadata);
  });

  it("treats legacy runtime metadata without backend as Docker metadata", async ({ dir: cwd }) => {
    const paths = await ensureLocalState(cwd);
    const metadata = runtimeFor(cwd);
    const { backend: _backend, ...legacy } = metadata;
    await writeFile(paths.runtimeFile, `${JSON.stringify(legacy, null, 2)}\n`);

    await expect(readRuntimeMetadata(cwd)).resolves.toEqual(metadata);
  });

  it("accepts runtime metadata with an explicit default HTTP port", async ({ dir: cwd }) => {
    const metadata = { ...runtimeFor(cwd), port: 80, server_url: "http://localhost:80" };

    await writeRuntimeMetadata(cwd, metadata);

    await expect(readRuntimeMetadata(cwd)).resolves.toEqual(metadata);
  });

  it.for<[string, unknown]>([
    ["server_url", "localhost:8080"],
    ["server_url", "http://localhost"],
    ["server_url", "http://localhost:8082"],
    ["port", 0],
    ["port", 8080.5],
  ])("rejects runtime metadata with invalid %s", async ([field, value], { dir: cwd }) => {
    const paths = await ensureLocalState(cwd);
    await writeFile(
      paths.runtimeFile,
      `${JSON.stringify({ ...runtimeFor(cwd), [field]: value }, null, 2)}\n`,
    );

    await expect(readRuntimeMetadata(cwd)).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: `${LOCAL_RUNTIME_FILE} is malformed`,
    });
  });

  it("writes container identity files for host-user Docker runs", async ({ dir: cwd }) => {
    const identity = await ensureContainerIdentity(cwd, { uid: 501, gid: 20 });

    expect(identity).toMatchObject({ uid: 501, gid: 20 });
    await expect(readFile(localRuntimePaths(cwd).containerPasswdFile, "utf8")).resolves.toContain(
      "zitadel-local:x:501:20:",
    );
    await expect(readFile(localRuntimePaths(cwd).containerGroupFile, "utf8")).resolves.toContain(
      "zitadel-local:x:20:",
    );
  });

  it("deletes only local data when reset removes the data directory", async ({ dir: cwd }) => {
    const paths = await ensureLocalState(cwd);
    await writeFile(join(paths.dataDir, "sample"), "data");

    await removeLocalData(cwd);

    await expect(readFile(join(paths.dataDir, "sample"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("findUpward", () => {
  // Root reads through any mode, so the unreadable directory proves nothing there.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "refuses to look past local state it cannot read",
    async ({ dir: cwd }) => {
      await writeRuntimeMetadata(cwd, runtimeFor(cwd));
      const app = join(cwd, "my-app");
      await mkdir(join(app, ".zitadel/local"), { recursive: true });
      await chmod(join(app, ".zitadel/local"), 0o000);

      try {
        await expect(findUpward(app, LOCAL_RUNTIME_FILE, cwd)).rejects.toMatchObject({
          code: "E_VALIDATION",
        });
      } finally {
        await chmod(join(app, ".zitadel/local"), 0o700);
      }
    },
  );

  it("stops looking for local state at the boundary it is given", async ({ dir: cwd }) => {
    await writeRuntimeMetadata(cwd, runtimeFor(cwd));
    const home = join(cwd, "home");
    const app = join(home, "my-app");
    await mkdir(app, { recursive: true });

    await expect(findUpward(app, LOCAL_RUNTIME_FILE, home)).resolves.toBeUndefined();
    await expect(findUpward(app, LOCAL_RUNTIME_FILE, cwd)).resolves.toBe(cwd);
  });
});

describe("readNearestRuntimeMetadata", () => {
  async function malformedRecordAt(dir: string): Promise<void> {
    await mkdir(join(dir, ".zitadel/local"), { recursive: true });
    await writeFile(join(dir, LOCAL_RUNTIME_FILE), JSON.stringify({ backend: "nope" }));
  }

  it("recovers a malformed record in a parent where it is", async ({ dir: cwd }) => {
    await malformedRecordAt(cwd);
    const app = join(cwd, "my-app");
    await mkdir(app);

    await expect(readNearestRuntimeMetadata(app)).rejects.toMatchObject({
      nextCommands: [`zitadel reset --force --cwd ${cwd}`, `zitadel start --cwd ${cwd}`],
    });
  });

  it("recovers a malformed record in the working directory without naming it", async ({
    dir: cwd,
  }) => {
    await malformedRecordAt(cwd);

    await expect(readNearestRuntimeMetadata(cwd)).rejects.toMatchObject({
      nextCommands: ["zitadel reset --force", "zitadel start"],
    });
  });
});

describe("loopbackReach", () => {
  const ALLOW_LIST = { injected: ["NEXTGEN_HTTPCLIENT_ALLOW_LIST"] };

  function binaryRuntime(cwd: string, env = ALLOW_LIST): RuntimeMetadata {
    return {
      ...runtimeFor(cwd),
      backend: "binary",
      pid: 4242,
      command: "zitadel-server",
      log_path: join(cwd, ".zitadel/local/server.log"),
      server_package: "@zitadel/server",
      server_version: "0.0.0-test",
      env,
    };
  }

  it("allows loopback on a process server that got the allow list, from a subdirectory too", async ({
    dir: cwd,
  }) => {
    await writeRuntimeMetadata(cwd, binaryRuntime(cwd));
    const app = join(cwd, "my-app");
    await mkdir(app);

    await expect(loopbackReach(cwd, "http://localhost:8081")).resolves.toBe("allowed");
    await expect(loopbackReach(app, "http://127.0.0.1:8081/")).resolves.toBe("allowed");
  });

  it("names a container server, whose localhost is the container", async ({ dir: cwd }) => {
    await writeRuntimeMetadata(cwd, runtimeFor(cwd));
    await expect(loopbackReach(cwd, "http://localhost:8081")).resolves.toBe("container");
  });

  it("knows nothing of a process server started with the allow list off", async ({ dir: cwd }) => {
    await writeRuntimeMetadata(cwd, binaryRuntime(cwd, { injected: [] }));
    await expect(loopbackReach(cwd, "http://localhost:8081")).resolves.toBe("unknown");
  });

  it("knows nothing of a server the record does not name, or of no record", async ({
    dir: cwd,
  }) => {
    await expect(loopbackReach(cwd, "http://localhost:8081")).resolves.toBe("unknown");
    await writeRuntimeMetadata(cwd, binaryRuntime(cwd));
    await expect(loopbackReach(cwd, "http://localhost:9999")).resolves.toBe("unknown");
    await expect(loopbackReach(cwd, "https://example.zitadel.cloud")).resolves.toBe("unknown");
  });
});

describe("checkLocalServerHealth", () => {
  /** A server whose process answers, and whose database answers as `database` says. */
  function aServerWhoseDatabaseIs(serve: Serve, database: "up" | "down"): Promise<string> {
    return serve((req, res) => {
      if (req.url === "/readyz") {
        res.writeHead(database === "up" ? 200 : 503).end(database === "up" ? "ok" : "fail");
        return;
      }
      res.writeHead(req.url === "/livez" ? 200 : 404).end("ok");
    });
  }

  it("is healthy once the server's database answers", async ({ serve }) => {
    await expect(checkLocalServerHealth(await aServerWhoseDatabaseIs(serve, "up"))).resolves.toBe(
      true,
    );
  });

  it("is not healthy while the database does not answer, though the process does", async ({
    serve,
  }) => {
    await expect(checkLocalServerHealth(await aServerWhoseDatabaseIs(serve, "down"))).resolves.toBe(
      false,
    );
  });

  it("reads the health response body to the end", async () => {
    const { response, isRead } = aResponseWhoseBodyIsRead(200);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await checkLocalServerHealth("http://localhost:8081");

    expect(isRead()).toBe(true);
  });
});

describe("readPlatformRuntime", () => {
  it("reads a refused runtime document body to the end", async () => {
    const { response, isRead } = aResponseWhoseBodyIsRead(404);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await readPlatformRuntime("http://localhost:8081");

    expect(isRead()).toBe(true);
  });
});

/** A response whose body reports, once a reader has read it to the end, that it was read. */
function aResponseWhoseBodyIsRead(status: number): { response: Response; isRead: () => boolean } {
  let pulls = 0;
  let read = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(new TextEncoder().encode("ok"));
          return;
        }
        read = true;
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return { response: new Response(body, { status }), isRead: () => read };
}

describe("retargetMalformedRuntime", () => {
  const malformed = new ZitadelError("E_VALIDATION", `${LOCAL_RUNTIME_FILE} is malformed`, {
    details: { x: 1 },
  });

  it.for<[string, string]>([
    ["a Windows path with a space", "C:\\work\\my app"],
    ["a Windows path with an apostrophe", "C:\\work\\it's"],
    ["a POSIX path with a space", "/home/dev/my app"],
  ])("hands over %s as arguments, not as commands", ([_name, dir]) => {
    const retargeted = retargetMalformedRuntime(malformed, dir) as ZitadelError;

    expect(retargeted.nextCommands).toBeUndefined();
    expect(retargeted.details).toEqual({
      x: 1,
      suggested_args: [
        ["reset", "--force", "--cwd", dir],
        ["start", "--cwd", dir],
      ],
    });
    expect(retargeted.hint).toContain("details.suggested_args");
  });

  it("writes the commands out for a path that needs no quoting", () => {
    const retargeted = retargetMalformedRuntime(malformed, "/home/dev/app") as ZitadelError;

    expect(retargeted.nextCommands).toEqual([
      "zitadel reset --force --cwd /home/dev/app",
      "zitadel start --cwd /home/dev/app",
    ]);
  });
});

function runtimeFor(cwd: string): RuntimeMetadata {
  const paths = localRuntimePaths(cwd);
  return {
    schema_version: 1,
    backend: "docker",
    container_name: localContainerName(cwd),
    container_id: "container-1",
    image: "ghcr.io/zitadel/nextgen:test",
    port: 8081,
    server_url: "http://localhost:8081",
    data_dir: paths.dataDir,
    created_at: "2026-06-09T00:00:00.000Z",
    cli_version: "0.0.0-test",
  };
}

describe("resolveRuntimeBackend", () => {
  const none = { runtime: undefined, image: undefined, envImage: undefined };

  it("takes the backend that was asked for", () => {
    expect(resolveRuntimeBackend({ ...none, runtime: "docker" })).toBe("docker");
    expect(resolveRuntimeBackend({ ...none, runtime: "binary", image: "img" })).toBe("binary");
  });

  it("keeps the backend an existing server already uses", () => {
    expect(resolveRuntimeBackend({ ...none, existingRuntime: { backend: "docker" } })).toBe(
      "docker",
    );
  });

  it("chooses Docker when an image is named, from a flag or the environment", () => {
    expect(resolveRuntimeBackend({ ...none, image: "img" })).toBe("docker");
    expect(resolveRuntimeBackend({ ...none, envImage: "img" })).toBe("docker");
  });

  it("falls back to the npm binary", () => {
    expect(resolveRuntimeBackend(none)).toBe("binary");
  });
});

describe("sameLocalServer", () => {
  it("treats localhost and the loopback addresses as one host", () => {
    expect(sameLocalServer("http://localhost:8080", "http://127.0.0.1:8080")).toBe(true);
    expect(sameLocalServer("http://[::1]:8080", "http://localhost:8080")).toBe(true);
  });

  it("tells servers apart by port and protocol", () => {
    expect(sameLocalServer("http://localhost:8080", "http://localhost:8081")).toBe(false);
    expect(sameLocalServer("http://localhost:8080", "https://localhost:8080")).toBe(false);
  });

  it("is false for a different host or a value that is not a URL", () => {
    expect(sameLocalServer("http://localhost:8080", "http://example.com:8080")).toBe(false);
    expect(sameLocalServer("nope", "http://localhost:8080")).toBe(false);
  });
});
