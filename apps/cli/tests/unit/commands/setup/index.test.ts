import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  localContainerName,
  localRuntimePaths,
  writeRuntimeMetadata,
  type RuntimeMetadata,
} from "../../../../src/lib/local-server/runtime";
import { expectedPublicCliCommand, parseJson, runCliForTest } from "../../../helpers/run-cli";

/**
 * Unit-level guardrails for the `setup` command. The happy path
 * (project create + patch + apply round-trip) is covered by the
 * integration tests in `tests/integration/setup-next.test.ts`. The
 * cases here focus on the pre-flight branches that short-circuit
 * before any network or filesystem mutation, so they run without an
 * api-mock.
 */
const tempDirs: string[] = [];
const servers: Server[] = [];

async function makeTempDir(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-test-"));
  tempDirs.push(cwd);
  return cwd;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("setup command pre-flight", () => {
  it("emits status: skipped when zitadel.json already exists", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "zitadel.json"), JSON.stringify({ project: "proj_x" }));

    const res = await runCliForTest(["setup", "--cwd", cwd, "--non-interactive", "--json"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; reason?: string };
    expect(json.status).toBe("skipped");
    expect(json.reason).toBe("already-initialized");
  });

  it("throws E_CONFLICT when .zitadel/secret exists without zitadel.json", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify({ project_id: "proj_x" }));

    const res = await runCliForTest(["setup", "--cwd", cwd, "--non-interactive", "--json"]);

    expect(res.exitCode).toBe(5);
    const json = parseJson(res.stdout) as { status: string; code: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_CONFLICT");
  });

  it("throws E_FRAMEWORK_NOT_DETECTED for an empty dir when non-interactive without --framework", async () => {
    const cwd = await makeTempDir();

    const res = await runCliForTest(["setup", "--cwd", cwd, "--non-interactive", "--json"]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { status: string; code: string; hint?: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_FRAMEWORK_NOT_DETECTED");
    expect(json.hint).toContain("--framework");
  });

  it("still requires --framework in non-interactive local setup after runtime start", async () => {
    const cwd = await makeTempDir();
    const serverUrl = await startHealthServer();
    await writeRuntimeMetadata(cwd, runtimeFor(cwd, serverUrl));

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--server",
      "local",
      "--non-interactive",
      "--json",
    ]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { status: string; code: string; hint?: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_FRAMEWORK_NOT_DETECTED");
    expect(json.hint).toContain("--framework");
  });

  it("keeps the framework in local-runtime-missing setup guidance", async () => {
    const cwd = await makeTempDir();
    await writeRuntimeMetadata(cwd, runtimeFor(cwd, "http://localhost:9"));

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--framework",
      "next",
      "--server",
      "local",
      "--non-interactive",
      "--json",
    ]);

    expect(res.exitCode).toBe(4);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      hint?: string;
      next_commands?: string[];
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_LOCAL_SERVER_NOT_RUNNING");
    expect(json.hint).toContain("Start local Zitadel first");
    expect(json.next_commands).toEqual([
      expectedPublicCliCommand("start"),
      expectedPublicCliCommand("setup --framework next --non-interactive --server local"),
    ]);
  });

  it("explains non-empty dirs whose framework can't be inferred or scaffolded", async () => {
    const cwd = await makeTempDir();
    // A non-empty dir that isn't a known framework — Orca's detector fails
    // and the empty-directory scaffold branch doesn't trigger.
    await writeFile(join(cwd, "README.md"), "Not a Next.js project.");

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--framework",
      "next",
      "--non-interactive",
      "--json",
    ]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      details: { entries: string[]; reason: string };
      hint?: string;
      message: string;
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_FRAMEWORK_NOT_DETECTED");
    expect(json.message).toContain("not a fresh scaffold target");
    expect(json.hint).toContain("Directory contains README.md");
    expect(json.details.entries).toContain("README.md");
  });

  it("points cloud project creation failures at the local alpha path", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "app"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^16" } }),
    );
    const serverUrl = await startNotFoundServer();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--server",
      serverUrl,
      "--non-interactive",
      "--json",
      "--skip-install",
    ]);

    expect(res.exitCode).toBe(4);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      hint?: string;
      message: string;
      next_commands?: string[];
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_NOT_FOUND");
    expect(json.message).toContain("has no such endpoint");
    // The retry pins the resolved dev port: the issuer registered with the
    // project derives from it, so the rerun must reproduce it verbatim.
    expect(json.hint).toContain(
      "--framework next --dev-port 3000 --non-interactive --server local",
    );
    expect(json.next_commands).toEqual([
      expectedPublicCliCommand("start"),
      expectedPublicCliCommand(
        "setup --framework next --dev-port 3000 --non-interactive --server local",
      ),
    ]);
  });

  it("keeps the sign-in preset in cloud-failure retry guidance", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "app"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^16" } }),
    );
    const serverUrl = await startNotFoundServer();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--preset",
      "passkey-first",
      "--server",
      serverUrl,
      "--non-interactive",
      "--json",
      "--skip-install",
    ]);

    expect(res.exitCode).toBe(4);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      hint?: string;
      next_commands?: string[];
    };
    expect(json.status).toBe("error");
    // Following the printed retry verbatim must reproduce the requested
    // sign-in preset, not silently fall back to the default.
    expect(json.hint).toContain("--preset passkey-first");
    expect(json.next_commands).toEqual([
      expectedPublicCliCommand("start"),
      expectedPublicCliCommand(
        "setup --framework next --preset passkey-first --dev-port 3000 --non-interactive --server local",
      ),
    ]);
  });

  it("sends a project name in create-project payload", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "app"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^16" } }),
    );
    const capture = await startCreateProjectCaptureServer();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--server",
      capture.url,
      "--non-interactive",
      "--json",
      "--skip-install",
    ]);

    expect(res.exitCode).toBe(0);
    expect(capture.body).toBeTruthy();
    expect(capture.body).toMatchObject({
      name: expect.any(String),
      preview_origins: expect.arrayContaining([expect.any(String)]),
      seed_defaults: false,
    });
    const projectName = capture.body?.name;
    expect(typeof projectName).toBe("string");
    if (typeof projectName !== "string") {
      throw new Error("expected create-project payload name to be a string");
    }
    expect(projectName.trim().length).toBeGreaterThan(0);
  });

  it("warns about the split brand pane's narrow-container fallback, not about this app", async () => {
    const cwd = await makeTempDir();
    // Widget posture (a pre-existing Next app, ADR 044): the card is meant to
    // move into a layout the CLI doesn't own, so a narrow container is the
    // likely end state.
    await mkdir(join(cwd, "app"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^16" } }),
    );
    const capture = await startCreateProjectCaptureServer();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--design",
      "split-right",
      "--server",
      capture.url,
      "--non-interactive",
      "--json",
      "--skip-install",
    ]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; warnings: string[] };
    expect(json.status).toBe("ok");
    expect(json.warnings).toHaveLength(1);
    // The wrapper setup scaffolds around the widget is full-width, so the
    // brand pane does render in the page we just wrote. Telling the user it
    // shows the compact mark "instead" sends them hunting a rendering bug
    // that isn't happening — the warning states the container-width contract
    // and the branding.json fix for the narrow case.
    expect(json.warnings[0]).not.toMatch(/this app/i);
    expect(json.warnings[0]).toContain("container is wide");
    expect(json.warnings[0]).toContain(".zitadel/branding/branding.json");
  });

  it("warns in page posture too — the collapse is a container query, not a posture", async () => {
    const cwd = await makeTempDir();
    // A pre-existing React app: not route-based, so `derivePosture` returns
    // "page" without a scaffold (ADR 044). A full-page split login hits the
    // same collapse on a phone that an embedded card hits in a sidebar, and
    // the template emits no compact mark without logo_url/hero_url — so
    // suppressing the advice here would leave that dead state unexplained.
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { react: "^19", vite: "^7" } }),
    );
    // The React patcher merges the /__nextgen dev proxy into the Vite config
    // and fails loudly without one.
    await writeFile(
      join(cwd, "vite.config.ts"),
      'import { defineConfig } from "vite";\n\nexport default defineConfig({});\n',
    );
    const capture = await startCreateProjectCaptureServer();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--design",
      "split",
      "--server",
      capture.url,
      "--non-interactive",
      "--json",
      "--skip-install",
    ]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; warnings: string[] };
    expect(json.status).toBe("ok");
    expect(json.warnings).toHaveLength(1);
    expect(json.warnings[0]).toContain("The split design");
    expect(json.warnings[0]).toContain(".zitadel/branding/branding.json");
  });
});

describe("setup --renderer surface", () => {
  it("--help advertises only implemented renderers", async () => {
    const res = await runCliForTest(["setup", "--help"]);

    expect(res.exitCode).toBe(0);
    // oclif renders the flag's `options` as `<options: a|b>`; a renderer that
    // getRenderer would reject with E_NOT_IMPLEMENTED must not be offered as
    // a selectable value, only mentioned as not yet available (ADR 006).
    // Whitespace is collapsed because oclif wraps help text mid-sentence.
    const help = res.stdout.replace(/\s+/g, " ");
    expect(res.stdout).toContain("<options: react>");
    expect(help).not.toContain("react|web-component");
    expect(help).toContain("Not yet available: web-component.");
  });

  it("rejects a declared-but-unpublished renderer at parse time", async () => {
    const cwd = await makeTempDir();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--renderer",
      "web-component",
      "--non-interactive",
      "--json",
    ]);

    // Fails during flag parsing — before any remote project is created. The
    // registry's E_NOT_IMPLEMENTED path still guards renderer ids read from
    // persisted config (see the renderer registry unit tests).
    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { status: string; code: string; message: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("web-component");
  });
});

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

async function startNotFoundServer(): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(404, { "content-type": "application/json" }).end(
      JSON.stringify({ message: "not found" }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "localhost", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("not-found server did not expose a TCP address");
  }
  return `http://localhost:${String(address.port)}`;
}

async function startCreateProjectCaptureServer(): Promise<{
  url: string;
  body: Record<string, unknown> | null;
}> {
  let body: Record<string, unknown> | null = null;
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "POST" && path === "/projects") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      res.writeHead(201, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: "proj_test",
          name: "demo",
          project_secret: "sk_proj_test_full",
          preview_secret: "sk_proj_test_preview",
          preview_origins: [],
          created_at: "2026-06-01T00:00:00.000Z",
        }),
      );
      return;
    }
    if (req.method === "POST" && path === "/schemas") {
      res.writeHead(201, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: "sch_test",
          created_at: "2026-06-01T00:00:00.000Z",
        }),
      );
      return;
    }
    if (req.method === "POST" && path === "/flow_definitions") {
      res.writeHead(201, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: "flow_test",
          created_at: "2026-06-01T00:00:00.000Z",
        }),
      );
      return;
    }
    if (req.method === "POST" && path === "/branding") {
      res.writeHead(201, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: "brand_test",
          revision: 1,
          created_at: "2026-06-01T00:00:00.000Z",
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "localhost", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("capture server did not expose a TCP address");
  }
  return {
    url: `http://localhost:${String(address.port)}`,
    get body() {
      return body;
    },
  };
}

function runtimeFor(cwd: string, serverUrl: string): RuntimeMetadata {
  return {
    schema_version: 1,
    backend: "docker",
    container_name: localContainerName(cwd),
    container_id: "container-test-id",
    image: "ghcr.io/zitadel/nextgen:test",
    port: Number(new URL(serverUrl).port),
    server_url: serverUrl,
    data_dir: localRuntimePaths(cwd).dataDir,
    created_at: "2026-06-09T00:00:00.000Z",
    cli_version: "0.0.0-test",
  };
}
