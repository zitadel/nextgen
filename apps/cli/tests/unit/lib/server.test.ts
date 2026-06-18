import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { localRuntimePaths, type RuntimeMetadata } from "../../../src/lib/local-server/runtime";
import { DEFAULT_SERVER, resolveServer } from "../../../src/lib/server";

let dir: string;
let servers: Server[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zitadel-resolve-server-"));
});

afterEach(async () => {
  for (const server of servers) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  servers = [];
  await rm(dir, { recursive: true, force: true });
});

async function writeConfig(config: unknown): Promise<void> {
  await writeFile(join(dir, "zitadel.json"), JSON.stringify(config), "utf8");
}

describe("resolveServer", () => {
  it("falls back to DEFAULT_SERVER when nothing resolves and no config exists", async () => {
    const resolved = await resolveServer({ cwd: dir, env: {} });
    expect(resolved).toEqual({ value: DEFAULT_SERVER, origin: "default" });
  });

  it("prefers the --server flag above all other sources", async () => {
    await writeConfig({ server: "https://config.example.com" });
    const resolved = await resolveServer({
      cwd: dir,
      env: { ZITADEL_API_BASE: "https://env.example.com" },
      serverFlag: "https://flag.example.com",
      environment: "production",
    });
    expect(resolved).toEqual({ value: "https://flag.example.com", origin: "flag" });
  });

  it("uses ZITADEL_API_BASE env when no flag is given", async () => {
    await writeConfig({ server: "https://config.example.com" });
    const resolved = await resolveServer({
      cwd: dir,
      env: { ZITADEL_API_BASE: "https://env.example.com" },
    });
    expect(resolved).toEqual({ value: "https://env.example.com", origin: "env" });
  });

  it("reads the selected environment block from zitadel.json", async () => {
    await writeConfig({
      server: "https://top.example.com",
      environments: {
        production: { server: "https://prod.example.com" },
      },
    });
    const resolved = await resolveServer({ cwd: dir, env: {}, environment: "production" });
    expect(resolved).toEqual({ value: "https://prod.example.com", origin: "config-env" });
  });

  it("falls through to the top-level server when the env block is absent", async () => {
    await writeConfig({
      server: "https://top.example.com",
      environments: { preview: { server: "https://preview.example.com" } },
    });
    const resolved = await resolveServer({ cwd: dir, env: {}, environment: "production" });
    expect(resolved).toEqual({ value: "https://top.example.com", origin: "config-top" });
  });

  it("uses the top-level server when no environment is provided", async () => {
    await writeConfig({ server: "https://top.example.com" });
    const resolved = await resolveServer({ cwd: dir, env: {} });
    expect(resolved).toEqual({ value: "https://top.example.com", origin: "config-top" });
  });

  it("falls back to DEFAULT_SERVER when the config has no server fields", async () => {
    await writeConfig({ environments: { production: { other: "value" } } });
    const resolved = await resolveServer({ cwd: dir, env: {}, environment: "production" });
    expect(resolved).toEqual({ value: DEFAULT_SERVER, origin: "default" });
  });

  it("ignores a non-string environment server and falls through to top-level", async () => {
    await writeConfig({
      server: "https://top.example.com",
      environments: { production: { server: 123 } },
    });
    const resolved = await resolveServer({ cwd: dir, env: {}, environment: "production" });
    expect(resolved).toEqual({ value: "https://top.example.com", origin: "config-top" });
  });

  it("ignores an array-valued environments field", async () => {
    await writeConfig({ server: "https://top.example.com", environments: ["nope"] });
    const resolved = await resolveServer({ cwd: dir, env: {}, environment: "production" });
    expect(resolved).toEqual({ value: "https://top.example.com", origin: "config-top" });
  });

  it("normalises a resolved URL down to its origin", async () => {
    const resolved = await resolveServer({
      cwd: dir,
      env: {},
      serverFlag: "https://flag.example.com/some/path?q=1",
    });
    expect(resolved).toEqual({ value: "https://flag.example.com", origin: "flag" });
  });

  it("rejects a non-http(s) URL with E_VALIDATION", async () => {
    await expect(
      resolveServer({ cwd: dir, env: {}, serverFlag: "ftp://flag.example.com" }),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("rejects an unparseable URL with E_VALIDATION", async () => {
    await expect(
      resolveServer({ cwd: dir, env: {}, serverFlag: "not a url" }),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("resolves --server local from healthy local runtime metadata", async () => {
    const serverUrl = await startHealthServer();
    await writeLocalRuntime(serverUrl);

    const resolved = await resolveServer({ cwd: dir, env: {}, serverFlag: "local" });

    expect(resolved).toEqual({ value: serverUrl, origin: "local" });
  });

  it("fails --server local when runtime metadata points at an unhealthy server", async () => {
    await writeLocalRuntime("http://localhost:9");

    await expect(resolveServer({ cwd: dir, env: {}, serverFlag: "local" })).rejects.toMatchObject({
      code: "E_LOCAL_SERVER_NOT_RUNNING",
    });
  });
});

async function writeLocalRuntime(serverUrl: string): Promise<void> {
  const paths = localRuntimePaths(dir);
  const metadata: RuntimeMetadata = {
    schema_version: 1,
    backend: "docker",
    container_name: "zitadel-server-test",
    container_id: "container-1",
    image: "ghcr.io/zitadel/nextgen:test",
    port: Number(new URL(serverUrl).port),
    server_url: serverUrl,
    data_dir: paths.dataDir,
    created_at: "2026-06-09T00:00:00.000Z",
    cli_version: "0.0.0-test",
  };
  await mkdir(paths.runtimeDir, { recursive: true });
  await writeFile(paths.runtimeFile, JSON.stringify(metadata), "utf8");
}

async function startHealthServer(): Promise<string> {
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200).end("ok");
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "localhost", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("health server did not expose a TCP address");
  }
  return `http://localhost:${String(address.port)}`;
}
