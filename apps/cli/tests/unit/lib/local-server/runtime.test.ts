import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LOCAL_RUNTIME_FILE,
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
    const paths = localRuntimePaths(cwd);
    const metadata: RuntimeMetadata = {
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

    await writeRuntimeMetadata(cwd, metadata);

    await expect(readRuntimeMetadata(cwd)).resolves.toEqual(metadata);
    await expect(readFile(join(cwd, LOCAL_RUNTIME_FILE), "utf8")).resolves.toContain(
      "ghcr.io/zitadel/nextgen:test",
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
