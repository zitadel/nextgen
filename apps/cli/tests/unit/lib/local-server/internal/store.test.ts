import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RuntimeFileStore } from "../../../../../src/lib/local-server/internal/store";
import {
  type BinaryRuntimeMetadata,
  type DockerRuntimeMetadata,
  writeRuntimeMetadata,
} from "../../../../../src/lib/local-server/runtime";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("RuntimeFileStore", () => {
  async function folder(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-store-"));
    dirs.push(dir);
    return dir;
  }

  const binary = (cwd: string): BinaryRuntimeMetadata => ({
    schema_version: 1,
    backend: "binary",
    pid: 4242,
    command: "nextgen --migrate",
    log_path: join(cwd, "server.log"),
    server_package: "@zitadel/server",
    server_version: "1.0.0",
    port: 8081,
    server_url: "http://localhost:8081",
    data_dir: join(cwd, "data"),
    created_at: "2026-01-01T00:00:00.000Z",
    cli_version: "1.0.0",
  });

  it("reads back what it wrote", async () => {
    const cwd = await folder();
    const store = new RuntimeFileStore<BinaryRuntimeMetadata>(cwd, "binary");

    await store.write(binary(cwd));

    await expect(store.read()).resolves.toMatchObject({ pid: 4242, port: 8081 });
  });

  it("reads nothing from a directory that has no record", async () => {
    await expect(
      new RuntimeFileStore<BinaryRuntimeMetadata>(await folder(), "binary").read(),
    ).resolves.toBeUndefined();
  });

  it("does not treat a Docker record as a binary server", async () => {
    const cwd = await folder();
    const docker: DockerRuntimeMetadata = {
      schema_version: 1,
      backend: "docker",
      container_name: "zitadel-server-abc",
      container_id: "abc",
      image: "ghcr.io/zitadel/nextgen:latest",
      port: 8080,
      server_url: "http://localhost:8080",
      data_dir: join(cwd, "data"),
      created_at: "2026-01-01T00:00:00.000Z",
      cli_version: "1.0.0",
    };
    await writeRuntimeMetadata(cwd, docker);

    await expect(
      new RuntimeFileStore<BinaryRuntimeMetadata>(cwd, "binary").read(),
    ).resolves.toBeUndefined();
  });
});
