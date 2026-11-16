import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it, type Serve } from "@tests/fixtures";

import { localRuntimePaths } from "@/lib/server/local/runtime";
import { Server } from "@/lib/server";
import { aBinaryRecord } from "@tests/helpers/runtime-record";

describe("Server.resolve", () => {
  it("falls back to Server.DEFAULT when no flag is given", async ({ dir }) => {
    const resolved = await Server.resolve({ cwd: dir });
    expect(resolved).toEqual({ value: Server.DEFAULT, origin: "default" });
  });

  it("ignores the server in zitadel.json", async ({ dir }) => {
    await writeFile(
      join(dir, "zitadel.json"),
      JSON.stringify({ server: "https://config.example.com" }),
      "utf8",
    );
    const resolved = await Server.resolve({ cwd: dir });
    expect(resolved).toEqual({ value: Server.DEFAULT, origin: "default" });
  });

  it("uses the --server flag", async ({ dir }) => {
    const resolved = await Server.resolve({ cwd: dir, serverFlag: "https://flag.example.com" });
    expect(resolved).toEqual({ value: "https://flag.example.com", origin: "flag" });
  });

  it("normalises a resolved URL down to its origin", async ({ dir }) => {
    const resolved = await Server.resolve({
      cwd: dir,
      serverFlag: "https://flag.example.com/some/path?q=1",
    });
    expect(resolved).toEqual({ value: "https://flag.example.com", origin: "flag" });
  });

  it("rejects a non-http(s) URL with E_VALIDATION", async ({ dir }) => {
    await expect(
      Server.resolve({ cwd: dir, serverFlag: "ftp://flag.example.com" }),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("rejects an unparseable URL with E_VALIDATION", async ({ dir }) => {
    await expect(Server.resolve({ cwd: dir, serverFlag: "not a url" })).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("resolves --server local from healthy local runtime metadata", async ({ dir, serve }) => {
    const serverUrl = await startHealthServer(serve);
    await writeLocalRuntime(dir, serverUrl);

    const resolved = await Server.resolve({ cwd: dir, serverFlag: "local" });

    expect(resolved).toEqual({ value: serverUrl, origin: "local" });
  });

  it("fails --server local when runtime metadata points at an unhealthy server", async ({
    dir,
  }) => {
    await writeLocalRuntime(dir, "http://localhost:9");

    await expect(Server.resolve({ cwd: dir, serverFlag: "local" })).rejects.toMatchObject({
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

describe("Server.parse", () => {
  it("gives the origin of a URL", () => {
    expect(Server.parse(" https://api.example.com/some/path ")).toEqual({
      ok: true,
      value: "https://api.example.com",
    });
  });

  it("reports a URL with no scheme instead of throwing", () => {
    expect(Server.parse("api.zitadel.cloud")).toMatchObject({ ok: false });
  });

  it("reports an empty answer", () => {
    expect(Server.parse("  ")).toEqual({ ok: false, problem: "The server URL cannot be empty" });
  });
});

describe("Server.isLoopback", () => {
  it.for(["http://localhost:8080", "http://127.0.0.1", "http://[::1]:3000/path"])(
    "accepts %s",
    (url) => {
      expect(Server.at(url).isLoopback()).toBe(true);
    },
  );

  it.for(["https://example.com", "http://10.0.0.1:8080", "not a url", ""])("rejects %s", (url) => {
    expect(Server.at(url).isLoopback()).toBe(false);
  });
});

describe("Server.hostUnlessDefault", () => {
  it("says nothing for the default server", () => {
    expect(Server.at(Server.DEFAULT).hostUnlessDefault()).toBeUndefined();
  });

  it("names the host of any other server", () => {
    expect(Server.at("https://auth.example.com/some/path").hostUnlessDefault()).toBe(
      "auth.example.com",
    );
  });

  it("says nothing for an address that is not a URL", () => {
    expect(Server.at("not a url").hostUnlessDefault()).toBeUndefined();
  });
});

describe("Server.isCloud", () => {
  it.for([Server.DEFAULT, "https://acme.zitadel.cloud", "https://zitadel.cloud/path"])(
    "accepts %s",
    (url) => {
      expect(Server.at(url).isCloud()).toBe(true);
    },
  );

  it.for(["https://auth.example.com", "http://localhost:8080", "https://evilzitadel.cloud", "x"])(
    "rejects %s",
    (url) => {
      expect(Server.at(url).isCloud()).toBe(false);
    },
  );
});

describe("Server.consoleUrl", () => {
  it("is /console/ on the hosted cloud", () => {
    expect(Server.at("https://preview.zitadel.com/api/v1").consoleUrl()).toBe(
      "https://preview.zitadel.com/console/",
    );
  });

  it("is /ui/console/ on any other server", () => {
    expect(Server.at("https://auth.example.com").consoleUrl()).toBe(
      "https://auth.example.com/ui/console/",
    );
  });

  it("refuses an address that is not a URL", () => {
    expect(() => Server.at("not a url").consoleUrl()).toThrow(/Invalid server/);
  });
});

describe("Server.kind", () => {
  it("buckets a server without leaking its address", () => {
    expect(Server.at("https://preview.zitadel.com").kind).toBe("cloud");
    expect(Server.at("https://api.zitadel.cloud").kind).toBe("cloud");
    expect(Server.at("https://acme.zitadel.cloud").kind).toBe("cloud");
    expect(Server.at("http://localhost:8080").kind).toBe("local");
    expect(Server.at("http://127.0.0.1:8080").kind).toBe("local");
    expect(Server.at("http://127.0.0.2:8080").kind).toBe("local");
    expect(Server.at("http://[::1]:8080").kind).toBe("local");
    expect(Server.at("mock").kind).toBe("local");
    expect(Server.at("https://auth.internal.acme.com").kind).toBe("self_hosted");
    expect(Server.at("not a url").kind).toBe("unknown");
  });

  it("does not classify lookalike domains as cloud", () => {
    expect(Server.at("https://foozitadel.cloud").kind).toBe("self_hosted");
    expect(Server.at("https://notzitadel.cloud").kind).toBe("self_hosted");
    expect(Server.at("https://zitadel.cloud").kind).toBe("cloud");
    expect(Server.at("https://notpreview.zitadel.com").kind).toBe("self_hosted");
    expect(Server.at("https://zitadel.com").kind).toBe("self_hosted");
  });
});
