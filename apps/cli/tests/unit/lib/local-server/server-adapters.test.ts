import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type BinaryRuntimeMetadata,
  type DockerRuntimeMetadata,
  writeRuntimeMetadata,
} from "../../../../src/lib/local-server/runtime";
import { RuntimeFileStore, TcpPorts } from "../../../../src/lib/local-server/server-adapters";

const servers: Server[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function listenOn(host: string | undefined): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    servers.push(server);
    server.listen({ port: 0, host }, () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

describe("TcpPorts", () => {
  it("reports a port nothing holds as free", async () => {
    const port = await listenOn("127.0.0.1");
    await new Promise<void>((resolve) => servers.pop()?.close(() => resolve()));

    await expect(new TcpPorts().isFree(port)).resolves.toBe(true);
  });

  it("reports a port held on all interfaces as taken", async () => {
    const port = await listenOn(undefined);

    await expect(new TcpPorts().isFree(port)).resolves.toBe(false);
  });

  it("reports a port held on the loopback address alone as taken", async () => {
    const port = await listenOn("127.0.0.1");

    await expect(new TcpPorts().isFree(port)).resolves.toBe(false);
  });
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
