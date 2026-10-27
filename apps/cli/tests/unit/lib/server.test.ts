import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { localRuntimePaths } from "../../../src/lib/local-server/runtime";
import { DEFAULT_SERVER, parseServer, resolveServer } from "../../../src/lib/server";
import { aBinaryRecord } from "../../helpers/runtime-record";

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

describe("resolveServer", () => {
  it("falls back to DEFAULT_SERVER when no flag is given", async () => {
    const resolved = await resolveServer({ cwd: dir });
    expect(resolved).toEqual({ value: DEFAULT_SERVER, origin: "default" });
  });

  it("ignores the server in zitadel.json", async () => {
    await writeFile(
      join(dir, "zitadel.json"),
      JSON.stringify({ server: "https://config.example.com" }),
      "utf8",
    );
    const resolved = await resolveServer({ cwd: dir });
    expect(resolved).toEqual({ value: DEFAULT_SERVER, origin: "default" });
  });

  it("uses the --server flag", async () => {
    const resolved = await resolveServer({ cwd: dir, serverFlag: "https://flag.example.com" });
    expect(resolved).toEqual({ value: "https://flag.example.com", origin: "flag" });
  });

  it("normalises a resolved URL down to its origin", async () => {
    const resolved = await resolveServer({
      cwd: dir,
      serverFlag: "https://flag.example.com/some/path?q=1",
    });
    expect(resolved).toEqual({ value: "https://flag.example.com", origin: "flag" });
  });

  it("rejects a non-http(s) URL with E_VALIDATION", async () => {
    await expect(
      resolveServer({ cwd: dir, serverFlag: "ftp://flag.example.com" }),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("rejects an unparseable URL with E_VALIDATION", async () => {
    await expect(resolveServer({ cwd: dir, serverFlag: "not a url" })).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("resolves --server local from healthy local runtime metadata", async () => {
    const serverUrl = await startHealthServer();
    await writeLocalRuntime(serverUrl);

    const resolved = await resolveServer({ cwd: dir, serverFlag: "local" });

    expect(resolved).toEqual({ value: serverUrl, origin: "local" });
  });

  it("fails --server local when runtime metadata points at an unhealthy server", async () => {
    await writeLocalRuntime("http://localhost:9");

    await expect(resolveServer({ cwd: dir, serverFlag: "local" })).rejects.toMatchObject({
      code: "E_LOCAL_SERVER_NOT_RUNNING",
    });
  });
});

async function writeLocalRuntime(serverUrl: string): Promise<void> {
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

async function startHealthServer(): Promise<string> {
  const server = createServer((req, res) => {
    if (req.url === "/readyz") {
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

describe("parseServer", () => {
  it("gives the origin of a URL", () => {
    expect(parseServer(" https://api.example.com/some/path ")).toEqual({
      ok: true,
      value: "https://api.example.com",
    });
  });

  it("reports a URL with no scheme instead of throwing", () => {
    expect(parseServer("api.zitadel.cloud")).toMatchObject({ ok: false });
  });

  it("reports an empty answer", () => {
    expect(parseServer("  ")).toEqual({ ok: false, problem: "The server URL cannot be empty" });
  });
});
