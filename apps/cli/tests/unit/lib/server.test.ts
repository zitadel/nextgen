import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it, type Serve } from "@tests/helpers/fixtures";

import { localRuntimePaths } from "@/lib/local-server/runtime";
import {
  DEFAULT_SERVER,
  hostUnlessDefault,
  isLoopbackUrl,
  parseServer,
  resolveServer,
} from "@/lib/server";
import { aBinaryRecord } from "@tests/helpers/runtime-record";

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
    expect(parseServer("  ")).toEqual({ ok: false, problem: "The server URL cannot be empty" });
  });
});

describe("isLoopbackUrl", () => {
  it.for(["http://localhost:8080", "http://127.0.0.1", "http://[::1]:3000/path"])(
    "accepts %s",
    (url) => {
      expect(isLoopbackUrl(url)).toBe(true);
    },
  );

  it.for(["https://example.com", "http://10.0.0.1:8080", "not a url", ""])("rejects %s", (url) => {
    expect(isLoopbackUrl(url)).toBe(false);
  });
});

describe("hostUnlessDefault", () => {
  it("says nothing for the default server", () => {
    expect(hostUnlessDefault(DEFAULT_SERVER)).toBeUndefined();
  });

  it("names the host of any other server", () => {
    expect(hostUnlessDefault("https://auth.example.com/some/path")).toBe("auth.example.com");
  });

  it("says nothing for an address that is not a URL", () => {
    expect(hostUnlessDefault("not a url")).toBeUndefined();
  });
});
