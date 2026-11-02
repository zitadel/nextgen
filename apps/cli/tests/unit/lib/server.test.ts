import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it, type Serve } from "../../helpers/fixtures";

import { localRuntimePaths } from "../../../src/lib/local-server/runtime";
import { DEFAULT_SERVER, parseServer, resolveServer } from "../../../src/lib/server";
import { aBinaryRecord } from "../../helpers/runtime-record";

describe("resolveServer", () => {
  it("falls back to DEFAULT_SERVER when no flag is given", async ({ dir }) => {
    const resolved = await resolveServer({ cwd: dir });
    expect(resolved).toEqual({ value: DEFAULT_SERVER, origin: "default" });
  });

  it("ignores the server in zitadel.json", async ({ dir }) => {
    await writeFile(
      join(dir, "zitadel.json"),
      JSON.stringify({ server: "https://config.example.com" }),
      "utf8",
    );
    const resolved = await resolveServer({ cwd: dir });
    expect(resolved).toEqual({ value: DEFAULT_SERVER, origin: "default" });
  });

  it("uses the --server flag", async ({ dir }) => {
    const resolved = await resolveServer({ cwd: dir, serverFlag: "https://flag.example.com" });
    expect(resolved).toEqual({ value: "https://flag.example.com", origin: "flag" });
  });

  it("normalises a resolved URL down to its origin", async ({ dir }) => {
    const resolved = await resolveServer({
      cwd: dir,
      serverFlag: "https://flag.example.com/some/path?q=1",
    });
    expect(resolved).toEqual({ value: "https://flag.example.com", origin: "flag" });
  });

  it("rejects a non-http(s) URL with E_VALIDATION", async ({ dir }) => {
    await expect(
      resolveServer({ cwd: dir, serverFlag: "ftp://flag.example.com" }),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("rejects an unparseable URL with E_VALIDATION", async ({ dir }) => {
    await expect(resolveServer({ cwd: dir, serverFlag: "not a url" })).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("resolves --server local from healthy local runtime metadata", async ({ dir, serve }) => {
    const serverUrl = await startHealthServer(serve);
    await writeLocalRuntime(dir, serverUrl);

    const resolved = await resolveServer({ cwd: dir, serverFlag: "local" });

    expect(resolved).toEqual({ value: serverUrl, origin: "local" });
  });

  it("fails --server local when runtime metadata points at an unhealthy server", async ({
    dir,
  }) => {
    await writeLocalRuntime(dir, "http://localhost:9");

    await expect(resolveServer({ cwd: dir, serverFlag: "local" })).rejects.toMatchObject({
      code: "E_LOCAL_SERVER_NOT_RUNNING",
    });
  });
});

async function writeLocalRuntime(dir: string, serverUrl: string): Promise<void> {
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

function startHealthServer(serve: Serve): Promise<string> {
  return serve((req, res) => {
    if (req.url === "/readyz") {
      res.writeHead(200).end("ok");
      return;
    }
    res.writeHead(404).end();
  });
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
    expect(parseServer("  ")).toEqual({ ok: false, problem: "Enter the server URL." });
  });
});
