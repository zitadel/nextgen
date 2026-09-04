import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_LOCAL_SERVER_URL,
  LOCAL_RUNTIME_FILE,
  defaultLocalServerImageForCliVersion,
  detectHealthyLocalServer,
  ensureContainerIdentity,
  ensureLocalState,
  localContainerName,
  localRuntimePaths,
  readRuntimeMetadata,
  removeLocalData,
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
    ["0.1.0", "ghcr.io/zitadel/nextgen:latest"],
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

  // The marker is what lets `start` tell a runtime it may reuse from one it
  // must restart, so it has to survive the write/read cycle unchanged.
  it("round-trips the launch contract", async () => {
    const metadata: RuntimeMetadata = { ...runtimeFor(cwd), launch_contract: 1 };

    await writeRuntimeMetadata(cwd, metadata);

    await expect(readRuntimeMetadata(cwd)).resolves.toEqual(metadata);
  });

  // A record from an older CLI carries no marker, and a corrupt one must read
  // the same way: "no contract", which `start` treats as a restart.
  it("drops a launch contract that is not a positive integer", async () => {
    const paths = await ensureLocalState(cwd);
    const metadata = runtimeFor(cwd);
    for (const junk of ["1", 0, -1, 1.5, null]) {
      await writeFile(
        paths.runtimeFile,
        `${JSON.stringify({ ...metadata, launch_contract: junk }, null, 2)}\n`,
      );
      await expect(readRuntimeMetadata(cwd)).resolves.toEqual(metadata);
    }
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

describe("detectHealthyLocalServer", () => {
  // `checkLocalServerHealth` probes real URLs (including the fixed default
  // localhost:8080, which a dev machine may genuinely occupy), so stub the
  // global fetch and answer per-origin instead of binding real sockets.
  let healthyOrigins: ReadonlySet<string>;

  beforeEach(() => {
    healthyOrigins = new Set();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        if (url.pathname === "/healthz" && healthyOrigins.has(url.origin)) {
          return new Response("ok", { status: 200 });
        }
        throw new TypeError("fetch failed (stub: connection refused)");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the runtime-metadata URL when that server is healthy", async () => {
    await writeRuntimeMetadata(cwd, runtimeFor(cwd));
    healthyOrigins = new Set(["http://localhost:8081"]);

    await expect(detectHealthyLocalServer(cwd)).resolves.toBe("http://localhost:8081");
  });

  it("falls back to the default URL when the metadata URL is unhealthy", async () => {
    await writeRuntimeMetadata(cwd, runtimeFor(cwd));
    healthyOrigins = new Set([DEFAULT_LOCAL_SERVER_URL]);

    await expect(detectHealthyLocalServer(cwd)).resolves.toBe(DEFAULT_LOCAL_SERVER_URL);
  });

  it("probes the default URL only once when the metadata already points there", async () => {
    await writeRuntimeMetadata(cwd, {
      ...runtimeFor(cwd),
      port: 8080,
      server_url: DEFAULT_LOCAL_SERVER_URL,
    });

    await expect(detectHealthyLocalServer(cwd)).resolves.toBeUndefined();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("returns the default URL when no metadata exists but the default server is healthy", async () => {
    healthyOrigins = new Set([DEFAULT_LOCAL_SERVER_URL]);

    await expect(detectHealthyLocalServer(cwd)).resolves.toBe(DEFAULT_LOCAL_SERVER_URL);
  });

  it("swallows malformed runtime metadata instead of throwing", async () => {
    const paths = localRuntimePaths(cwd);
    await ensureLocalState(cwd);
    await writeFile(paths.runtimeFile, "{not json", "utf8");

    await expect(detectHealthyLocalServer(cwd)).resolves.toBeUndefined();
  });

  it("returns undefined when nothing is running", async () => {
    await expect(detectHealthyLocalServer(cwd)).resolves.toBeUndefined();
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
