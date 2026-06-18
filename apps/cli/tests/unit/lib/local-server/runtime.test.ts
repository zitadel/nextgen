import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LOCAL_RUNTIME_FILE,
  defaultLocalServerImageForCliVersion,
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
