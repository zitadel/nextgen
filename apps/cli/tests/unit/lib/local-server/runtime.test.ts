import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../src/lib/errors";
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
  readRuntimeMetadata,
  removeLocalData,
  retargetMalformedRuntime,
  writeRuntimeMetadata,
  type RuntimeMetadata,
} from "../../../../src/lib/local-server/runtime";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "zitadel-server-runtime-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

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

  it("creates local state and gitignores it", async () => {
    const paths = await ensureLocalState(cwd);

    expect((await stat(paths.dataDir)).isDirectory()).toBe(true);
    await expect(readFile(join(cwd, ".gitignore"), "utf8")).resolves.toContain(".zitadel/local/");
  });

  it("round-trips runtime metadata", async () => {
    const metadata = runtimeFor(cwd);

    await writeRuntimeMetadata(cwd, metadata);

    await expect(readRuntimeMetadata(cwd)).resolves.toEqual(metadata);
    await expect(readFile(join(cwd, LOCAL_RUNTIME_FILE), "utf8")).resolves.toContain(
      "ghcr.io/zitadel/nextgen:test",
    );
  });

  it("round-trips binary runtime metadata", async () => {
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

  it("treats legacy runtime metadata without backend as Docker metadata", async () => {
    const paths = await ensureLocalState(cwd);
    const metadata = runtimeFor(cwd);
    const { backend: _backend, ...legacy } = metadata;
    await writeFile(paths.runtimeFile, `${JSON.stringify(legacy, null, 2)}\n`);

    await expect(readRuntimeMetadata(cwd)).resolves.toEqual(metadata);
  });

  it("accepts runtime metadata with an explicit default HTTP port", async () => {
    const metadata = { ...runtimeFor(cwd), port: 80, server_url: "http://localhost:80" };

    await writeRuntimeMetadata(cwd, metadata);

    await expect(readRuntimeMetadata(cwd)).resolves.toEqual(metadata);
  });

  it.each([
    ["server_url", "localhost:8080"],
    ["server_url", "http://localhost"],
    ["server_url", "http://localhost:8082"],
    ["port", 0],
    ["port", 8080.5],
  ])("rejects runtime metadata with invalid %s", async (field, value) => {
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

  it("writes container identity files for host-user Docker runs", async () => {
    const identity = await ensureContainerIdentity(cwd, { uid: 501, gid: 20 });

    expect(identity).toMatchObject({ uid: 501, gid: 20 });
    await expect(readFile(localRuntimePaths(cwd).containerPasswdFile, "utf8")).resolves.toContain(
      "zitadel-local:x:501:20:",
    );
    await expect(readFile(localRuntimePaths(cwd).containerGroupFile, "utf8")).resolves.toContain(
      "zitadel-local:x:20:",
    );
  });

  it("deletes only local data when reset removes the data directory", async () => {
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
    async () => {
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

  it("stops looking for local state at the boundary it is given", async () => {
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

  it("recovers a malformed record in a parent where it is", async () => {
    await malformedRecordAt(cwd);
    const app = join(cwd, "my-app");
    await mkdir(app);

    await expect(readNearestRuntimeMetadata(app)).rejects.toMatchObject({
      nextCommands: [`zitadel reset --force --cwd ${cwd}`, `zitadel start --cwd ${cwd}`],
    });
  });

  it("recovers a malformed record in the working directory without naming it", async () => {
    await malformedRecordAt(cwd);

    await expect(readNearestRuntimeMetadata(cwd)).rejects.toMatchObject({
      nextCommands: ["zitadel reset --force", "zitadel start"],
    });
  });
});

describe("loopbackReach", () => {
  const ALLOW_LIST = { injected: ["NEXTGEN_HTTPCLIENT_ALLOW_LIST"] };

  function binaryRuntime(env = ALLOW_LIST): RuntimeMetadata {
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

  it("allows loopback on a process server that got the allow list, from a subdirectory too", async () => {
    await writeRuntimeMetadata(cwd, binaryRuntime());
    const app = join(cwd, "my-app");
    await mkdir(app);

    await expect(loopbackReach(cwd, "http://localhost:8081")).resolves.toBe("allowed");
    await expect(loopbackReach(app, "http://127.0.0.1:8081/")).resolves.toBe("allowed");
  });

  it("names a container server, whose localhost is the container", async () => {
    await writeRuntimeMetadata(cwd, runtimeFor(cwd));
    await expect(loopbackReach(cwd, "http://localhost:8081")).resolves.toBe("container");
  });

  it("knows nothing of a process server started with the allow list off", async () => {
    await writeRuntimeMetadata(cwd, binaryRuntime({ injected: [] }));
    await expect(loopbackReach(cwd, "http://localhost:8081")).resolves.toBe("unknown");
  });

  it("knows nothing of a server the record does not name, or of no record", async () => {
    await expect(loopbackReach(cwd, "http://localhost:8081")).resolves.toBe("unknown");
    await writeRuntimeMetadata(cwd, binaryRuntime());
    await expect(loopbackReach(cwd, "http://localhost:9999")).resolves.toBe("unknown");
    await expect(loopbackReach(cwd, "https://example.zitadel.cloud")).resolves.toBe("unknown");
  });
});

describe("checkLocalServerHealth", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  /** A server whose process answers, and whose database answers as `database` says. */
  async function aServerWhoseDatabaseIs(database: "up" | "down"): Promise<string> {
    const server = createServer((req, res) => {
      if (req.url === "/readyz") {
        res.writeHead(database === "up" ? 200 : 503).end(database === "up" ? "ok" : "fail");
        return;
      }
      res.writeHead(req.url === "/livez" || req.url === "/healthz" ? 200 : 404).end("ok");
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "localhost", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("server did not expose a TCP address");
    }
    return `http://localhost:${String(address.port)}`;
  }

  it("is healthy once the server's database answers", async () => {
    await expect(checkLocalServerHealth(await aServerWhoseDatabaseIs("up"))).resolves.toBe(true);
  });

  it("is not healthy while the database does not answer, though the process does", async () => {
    await expect(checkLocalServerHealth(await aServerWhoseDatabaseIs("down"))).resolves.toBe(false);
  });
});

describe("retargetMalformedRuntime", () => {
  const malformed = new ZitadelError("E_VALIDATION", `${LOCAL_RUNTIME_FILE} is malformed`, {
    details: { x: 1 },
  });

  it.each([
    ["a Windows path with a space", "C:\\work\\my app"],
    ["a Windows path with an apostrophe", "C:\\work\\it's"],
    ["a POSIX path with a space", "/home/dev/my app"],
  ])("hands over %s as arguments, not as commands", (_name, dir) => {
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
