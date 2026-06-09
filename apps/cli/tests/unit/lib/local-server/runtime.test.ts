import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LOCAL_RUNTIME_FILE,
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

  it.each([
    ["server_url", "localhost:8080"],
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
