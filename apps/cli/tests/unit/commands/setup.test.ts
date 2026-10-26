import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetPlatformStore, setupPlatformHandlers } from "@zitadel/api-mock/platform";
import { DEFAULT_SETUP_PRESET, DEFAULT_SETUP_USE_CASE } from "@zitadel/config/defaults";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../helpers/clack")).clackDouble());

vi.mock("../../../src/commands/setup/prompts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  askCustomSettings: vi.fn(),
}));

import { confirm, intro, isCancel, multiselect, select, text } from "@clack/prompts";

import { customExample, SETUP_FLAG_NAMES } from "../../../src/lib/idp";
import {
  localServerHostsPlatform,
  retryOptionsFromFlags,
  setupRetryFlags,
  ssoFromFlags,
} from "../../../src/commands/setup";
import { askCustomSettings } from "../../../src/commands/setup/prompts";
import type { Asker } from "../../../src/lib/input";
import { writeRuntimeMetadata } from "../../../src/lib/local-server/runtime";
import Setup from "../../../src/commands/setup";
import { aFakeAppGeneratorPath } from "../../helpers/app-generator";
import { parseJson, runCliForTest } from "../../helpers/run-cli";
import { asTerminal } from "../../helpers/terminal";

const tempDirs: string[] = [];
const server = setupServer(...setupPlatformHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

function setup(cwd: string, extra: string[] = []) {
  return runCliForTest([
    "setup",
    "--cwd",
    cwd,
    "--json",
    "--server",
    "https://api.zitadel.cloud",
    ...extra,
  ]);
}

/** What `zitadel start` records beside the local admin: which server it started. */
async function recordStartedServer(dir: string, serverUrl: string): Promise<void> {
  await writeRuntimeMetadata(dir, {
    schema_version: 1,
    backend: "docker",
    container_name: "zitadel-server-test",
    container_id: "container-1",
    image: "ghcr.io/zitadel/nextgen:test",
    port: Number(new URL(serverUrl).port),
    server_url: serverUrl,
    data_dir: join(dir, ".zitadel/local/nextgen-data"),
    created_at: "2026-06-09T00:00:00.000Z",
    cli_version: "0.0.0-test",
  });
}

/** An empty directory named as npm requires a package to be, which a new app's must be. */
async function makeNewAppDirectory(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "zitadel-setup-new-"));
  tempDirs.push(parent);
  const cwd = join(parent, "my-app");
  await mkdir(cwd);
  return cwd;
}

/** What a prompt answers when the person cancels it; the clack double's `isCancel` knows it. */
const CANCELLED = Symbol("cancelled");

/** A minimal detectable Next.js App Router project (no Zitadel files yet). */
async function makeNextProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, "app"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "demo", dependencies: { next: "^15" } }),
  );
  await writeFile(join(cwd, "app/layout.tsx"), "export default function L() {}\n");
  return cwd;
}

const FRAMEWORK_FIXTURES = [
  {
    framework: "next",
    expectedFile: "app/login/page.tsx",
    async create() {
      return makeNextProject();
    },
  },
  {
    framework: "nuxt",
    expectedFile: "app/pages/login.vue",
    async create() {
      const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-nuxt-"));
      tempDirs.push(cwd);
      await mkdir(join(cwd, "app"), { recursive: true });
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify({ name: "demo", dependencies: { nuxt: "^4.0.0" } }),
      );
      await writeFile(join(cwd, "nuxt.config.ts"), "export default defineNuxtConfig({})\n");
      return cwd;
    },
  },
  {
    framework: "react",
    expectedFile: "src/App.tsx",
    async create() {
      const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-react-"));
      tempDirs.push(cwd);
      await mkdir(join(cwd, "src"), { recursive: true });
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify({ name: "demo", dependencies: { react: "^19.0.0", vite: "^8.0.0" } }),
      );
      await writeFile(join(cwd, "vite.config.ts"), "export default {}\n");
      return cwd;
    },
  },
  {
    framework: "vue",
    expectedFile: "src/App.vue",
    async create() {
      const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-vue-"));
      tempDirs.push(cwd);
      await mkdir(join(cwd, "src"), { recursive: true });
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify({ name: "demo", dependencies: { vue: "^3.0.0", vite: "^8.0.0" } }),
      );
      await writeFile(join(cwd, "vite.config.ts"), "export default {}\n");
      return cwd;
    },
  },
  {
    framework: "angular",
    expectedFile: "src/app/app.ts",
    async create() {
      const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-angular-"));
      tempDirs.push(cwd);
      await mkdir(join(cwd, "src/app"), { recursive: true });
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify({ name: "demo", dependencies: { "@angular/core": "^20.0.0" } }),
      );
      await writeFile(
        join(cwd, "angular.json"),
        JSON.stringify({
          defaultProject: "demo",
          projects: { demo: { architect: { serve: { options: {} } } } },
        }),
      );
      await writeFile(
        join(cwd, "src/app/app.routes.ts"),
        "import { Routes } from '@angular/router';\n\nexport const routes: Routes = [];\n",
      );
      return cwd;
    },
  },
] as const;

afterEach(async () => {
  server.resetHandlers();
  resetPlatformStore();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("setup command", () => {
  it("skips when the project is already initialized", async () => {
    const cwd = await makeNextProject();
    await writeFile(join(cwd, "zitadel.json"), JSON.stringify({ project: "existing" }));

    const res = await setup(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; reason: string };
    expect(json.status).toBe("skipped");
    expect(json.reason).toBe("already-initialized");
  });

  it("errors with E_CONFLICT when a secret exists without zitadel.json", async () => {
    const cwd = await makeNextProject();
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/secret"), "{}");

    const res = await setup(cwd);

    expect(res.exitCode).toBe(5);
    const json = parseJson(res.stdout) as { status: string; code: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_CONFLICT");
  });

  it("dry-run returns ok with a stub project and contacts no platform", async () => {
    const cwd = await makeNextProject();

    const res = await setup(cwd, ["--dry-run", "--framework", "next"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: {
        install: { status: string; reason: string; command: string };
        next_commands: string[];
        project: { project_id: string };
      };
    };
    expect(json.status).toBe("ok");
    expect(json.data.project.project_id).toBe("dry-run-0000");
    expect(json.data.install).toMatchObject({
      status: "skipped",
      reason: "dry-run",
      command: "npm install",
    });
    expect(json.data.next_commands.slice(0, 2)).toEqual(["npm install", "npm run dev"]);
    expect(json.data.next_commands[2]).toMatch(
      /^npx @zitadel\/cli@\S+ deploy --dry-run --env-file \.env\.development\.local/,
    );
  });

  // `data.sso` is a list, one entry per provider, because setup can enable
  // several. An agent that kept parsing the old object would read nothing, so
  // the shape is pinned here rather than left to the summary box.
  it("reports the enabled providers as a list in the json envelope", async () => {
    const cwd = await makeNextProject();

    const res = await setup(cwd, [
      "--dry-run",
      "--framework",
      "next",
      "--sso",
      "google",
      "--sso-client-id",
      "1234-abc.apps.googleusercontent.com",
    ]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      data: {
        sso: Array<{
          provider: string;
          client_id: string;
          connection: string;
          callback_uri: string;
        }>;
      };
    };
    expect(Array.isArray(json.data.sso)).toBe(true);
    expect(json.data.sso).toHaveLength(1);
    expect(json.data.sso[0]).toMatchObject({
      provider: "google",
      client_id: "1234-abc.apps.googleusercontent.com",
      connection: ".zitadel/idps/google.json",
    });
    // The connection's own route: an agent registering the OAuth application
    // reads it from here, since a JSON run shows no prompt.
    expect(json.data.sso[0]?.callback_uri).toMatch(
      /^http:\/\/localhost:\d+\/__nextgen\/idp\/google\/callback$/,
    );
  });

  // A scripted `--sso` run without `--json` shows no prompt, so the summary
  // box is the only place the developer reads the URI to register.
  it("names the connection's redirect URI in the summary of a scripted --sso run", async () => {
    const cwd = await makeNextProject();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--server",
      "https://api.zitadel.cloud",
      "--non-interactive",
      "--dry-run",
      "--skip-install",
      "--framework",
      "next",
      "--sso",
      "google",
      "--sso-client-id",
      "1234-abc.apps.googleusercontent.com",
    ]);

    expect(res.exitCode).toBe(0);
    const output = `${res.stdout}${res.stderr}`;
    expect(output).toContain("Redirect URI");
    expect(output).toMatch(/http:\/\/localhost:\d+\/__nextgen\/idp\/google\/callback/);
  });

  describe("a custom provider", () => {
    const ACME = [
      "--sso",
      "custom",
      "--sso-slug",
      "acme-sso",
      "--sso-display-name",
      "Acme SSO",
      "--sso-issuer",
      "https://sso.acme.example",
    ];

    it("is reported under the slug the developer gave it", async () => {
      const cwd = await makeNextProject();

      const res = await setup(cwd, [
        "--dry-run",
        "--framework",
        "next",
        ...ACME,
        "--sso-client-id",
        "acme-client-id",
      ]);

      expect(res.exitCode).toBe(0);
      const json = parseJson(res.stdout) as {
        data: { sso: Array<Record<string, unknown>> };
      };
      expect(json.data.sso).toHaveLength(1);
      expect(json.data.sso[0]).toMatchObject({
        provider: "custom",
        slug: "acme-sso",
        client_id: "acme-client-id",
        connection: ".zitadel/idps/acme-sso.json",
      });
    });

    it("must be described completely, before anything is created", async () => {
      const cwd = await makeNextProject();

      const res = await setup(cwd, [
        "--framework",
        "next",
        "--sso",
        "custom",
        "--sso-slug",
        "acme-sso",
        "--sso-client-id",
        "acme-client-id",
      ]);

      expect(res.exitCode).not.toBe(0);
      const json = parseJson(res.stdout) as { code: string; message: string };
      expect(json.code).toBe("E_VALIDATION");
      expect(json.message).toBe("A custom connection needs --sso-display-name, --sso-issuer");
    });

    it("refuses a name belonging to a built-in provider", async () => {
      const cwd = await makeNextProject();

      const res = await setup(cwd, [
        "--dry-run",
        "--framework",
        "next",
        "--sso",
        "custom",
        "--sso-slug",
        "google",
        "--sso-display-name",
        "Mine",
        "--sso-issuer",
        "https://sso.acme.example",
        "--sso-client-id",
        "id",
      ]);

      expect(res.exitCode).not.toBe(0);
      expect((parseJson(res.stdout) as { message: string }).message).toContain("built-in provider");
    });

    it("refuses the --sso-* description for a provider the catalog describes", async () => {
      const cwd = await makeNextProject();

      const res = await setup(cwd, [
        "--dry-run",
        "--framework",
        "next",
        "--sso",
        "google",
        "--sso-issuer",
        "https://sso.acme.example",
        "--sso-client-id",
        "id",
      ]);

      expect(res.exitCode).not.toBe(0);
      expect((parseJson(res.stdout) as { message: string }).message).toBe(
        "--sso-issuer only applies to a custom connection",
      );
    });

    it("refuses a description with no --sso to attach it to", async () => {
      const cwd = await makeNextProject();

      const res = await setup(cwd, ["--dry-run", "--framework", "next", "--sso-slug", "acme-sso"]);

      expect(res.exitCode).not.toBe(0);
      expect((parseJson(res.stdout) as { message: string }).message).toBe(
        "--sso-slug needs --sso custom",
      );
    });
  });

  // No provider is an empty list, not a missing key or null: a consumer can
  // iterate the field without checking which of three shapes it holds.
  it("reports an empty list when no provider was enabled", async () => {
    const cwd = await makeNextProject();

    const res = await setup(cwd, ["--dry-run", "--framework", "next"]);

    const json = parseJson(res.stdout) as { data: { sso: unknown[] } };
    expect(json.data.sso).toEqual([]);
  });

  // Every project starts unattached, so setup is where the developer first
  // learns the project is temporary and that `zitadel claim` exists.
  //
  // Asserted through `--dry-run`, which previews the real output verbatim:
  // the install, start, and verify actions all name a project dry run never
  // created, so the claim nudge appearing alongside them is the consistent
  // behaviour, not a leak. Suppressing only this one would make dry run a
  // dishonest preview of the surface under test.
  it("tells a new cloud project it is temporary until claimed", async () => {
    const cwd = await makeNextProject();

    const res = await setup(cwd, ["--dry-run", "--framework", "next"]);

    const json = parseJson(res.stdout) as {
      data: { next_actions: string[]; next_commands: string[] };
    };
    expect(json.data.next_actions.join("\n")).toContain("temporary and its data may be lost");
    expect(json.data.next_commands.at(-1)).toMatch(
      /^npx @zitadel\/cli@\S+ claim --env-file \.env\.development\.local --cwd \S+$/,
    );
  });

  // A bootstrapped local server hosts its own platform project and claim
  // page. A real run probes the server's runtime document before nudging
  // (localServerHostsPlatform, covered below); dry run contacts no platform,
  // so its preview shows the nudge optimistically.
  it("nudges claim when setting up against the local server (dry run previews it)", async () => {
    const cwd = await makeNextProject();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--json",
      "--server",
      "http://localhost:8080",
      "--dry-run",
      "--framework",
      "next",
    ]);

    const json = parseJson(res.stdout) as {
      data: { next_actions: string[]; next_commands: string[] };
    };
    expect(json.data.next_actions.join("\n")).toContain("temporary and its data may be lost");
    expect(json.data.next_commands.at(-1)).toMatch(
      /^npx @zitadel\/cli@\S+ claim --env-file \.env\.development\.local --cwd \S+$/,
    );
  });

  // The probe behind the real-run local nudge: only a runtime document
  // naming the well-known platform project counts, and every failure mode
  // (wrong project, missing document, dead server) fails closed so setup
  // never nudges into a claim that would 401 at complete.
  it("detects the platform plane from the local runtime document, failing closed", async () => {
    server.use(
      http.get("http://localhost:9931/console/runtime.json", () =>
        HttpResponse.json({
          mode: "standalone",
          console_project_id: "proj_platform",
          publishable_key: "pk_platform",
        }),
      ),
      http.get("http://localhost:9932/console/runtime.json", () =>
        HttpResponse.json({ mode: "standalone", console_project_id: "proj_someone" }),
      ),
      http.get("http://localhost:9933/console/runtime.json", () =>
        HttpResponse.json({ error: "nope" }, { status: 404 }),
      ),
      http.get("http://localhost:9934/console/runtime.json", () => HttpResponse.error()),
    );

    await expect(localServerHostsPlatform("http://localhost:9931")).resolves.toBe(true);
    await expect(localServerHostsPlatform("http://localhost:9932")).resolves.toBe(false);
    await expect(localServerHostsPlatform("http://localhost:9933")).resolves.toBe(false);
    await expect(localServerHostsPlatform("http://localhost:9934")).resolves.toBe(false);
  });

  it("says nothing about teams when setting up against a self-hosted server", async () => {
    const cwd = await makeNextProject();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--json",
      "--server",
      "https://zitadel.example.com",
      "--dry-run",
      "--framework",
      "next",
    ]);

    const json = parseJson(res.stdout) as {
      data: { next_actions: string[]; next_commands: string[] };
    };
    expect(json.data.next_actions.join("\n")).not.toContain("Claim your Project");
    expect(json.data.next_commands.join("\n")).not.toMatch(/claim/);
  });

  it.each(FRAMEWORK_FIXTURES)(
    "dry-run setup supports $framework projects",
    async ({ create, expectedFile, framework }) => {
      const cwd = await create();

      const res = await setup(cwd, ["--dry-run", "--skip-install", "--framework", framework]);

      expect(res.exitCode).toBe(0);
      const json = parseJson(res.stdout) as {
        status: string;
        data: {
          install: { status: string; reason: string };
          framework: string;
          files_written: string[];
          next_commands: string[];
        };
      };
      expect(json.status).toBe("ok");
      expect(json.data.framework).toBe(framework);
      expect(json.data.install).toMatchObject({ status: "skipped", reason: "dry-run" });
      expect(json.data.files_written).toContain(expectedFile);
      expect(json.data.next_commands.slice(0, 2)).toEqual(["npm install", "npm run dev"]);
      expect(json.data.next_commands[2]).toMatch(
        /^npx @zitadel\/cli@\S+ deploy --dry-run --env-file \.env\.development\.local/,
      );
    },
  );

  // The INSTALLED section reports the dependency the patcher actually added;
  // it used to hardcode @zitadel/sdk-next from the Next-only era, which lied
  // for every other framework.
  it("names the actually installed SDK package in the summary box", async () => {
    const react = FRAMEWORK_FIXTURES.find((fixture) => fixture.framework === "react");
    if (!react) throw new Error("react fixture missing");
    const cwd = await react.create();

    // No `--json`: the summary box is human-facing consola narration.
    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--server",
      "https://api.zitadel.cloud",
      "--dry-run",
      "--skip-install",
      "--framework",
      "react",
    ]);

    expect(res.exitCode).toBe(0);
    const output = `${res.stdout}${res.stderr}`;
    expect(output).toContain("@zitadel/sdk-react");
    expect(output).not.toContain("@zitadel/sdk-next");
  });

  it("creates CLI-managed projects with a name and without server default seeding", async () => {
    const cwd = await makeNextProject();
    let createProjectBody: unknown;

    server.use(
      http.post("*/projects", async ({ request }) => {
        createProjectBody = await request.json();
        return HttpResponse.json(
          {
            id: "proj-test",
            name: "demo",
            project_secret: "sk_proj_test_full",
            preview_secret: "sk_proj_test_preview",
            origins: [{ pattern: "http://localhost:3000", kind: "primary" }],
            created_at: "2026-04-21T14:03:11.000Z",
          },
          { status: 201 },
        );
      }),
    );

    const res = await setup(cwd, ["--non-interactive", "--skip-install", "--framework", "next"]);

    expect(res.exitCode).toBe(0);
    expect(createProjectBody).toMatchObject({
      name: expect.any(String),
      origins: expect.arrayContaining([{ pattern: "http://localhost:3000", kind: "primary" }]),
      seed_defaults: false,
    });
    const projectName = (createProjectBody as { name?: unknown }).name;
    expect(typeof projectName).toBe("string");
    if (typeof projectName !== "string") {
      throw new Error("expected create-project payload name to be a string");
    }
    expect(projectName.trim().length).toBeGreaterThan(0);
  });

  // A runtime document naming the platform project does not guarantee a claim
  // can complete, so attaching the project to the local admin must not fail a
  // setup that has already written the app files.
  it("keeps the project unclaimed when attaching it to the local admin fails", async () => {
    const cwd = await makeNextProject();
    await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel/local/admin.json"),
      JSON.stringify({
        email: "admin@zitadel.localhost",
        password: "local-admin-password",
        user_id: "user_localadmin",
        team_id: "team_localadmin",
      }),
    );
    await recordStartedServer(cwd, "http://localhost:9941");
    server.use(
      http.get("http://localhost:9941/console/runtime.json", () =>
        HttpResponse.json({
          mode: "standalone",
          console_project_id: "proj_platform",
          publishable_key: "pk_platform",
        }),
      ),
      http.post("http://localhost:9941/api/v1/projects/:projectId/claim/init", () =>
        HttpResponse.json({ code: "internal", message: "claim unavailable" }, { status: 500 }),
      ),
    );

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--json",
      "--server",
      "http://localhost:9941",
      "--non-interactive",
      "--skip-install",
      "--framework",
      "next",
    ]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; data: { next_commands: string[] } };
    expect(json.status).toBe("ok");
    const secret = JSON.parse(await readFile(join(cwd, ".zitadel/secret"), "utf8")) as {
      team_id?: string;
    };
    expect(secret.team_id).toBeUndefined();
    expect(json.data.next_commands.at(-1)).toMatch(
      /^npx @zitadel\/cli@\S+ claim --env-file \.env\.development\.local --cwd \S+$/,
    );
  });

  it("says the project went unattached when a local platform server has no local admin here", async () => {
    const cwd = await makeNextProject();
    server.use(
      http.get("http://localhost:9942/console/runtime.json", () =>
        HttpResponse.json({
          mode: "standalone",
          console_project_id: "proj_platform",
          publishable_key: "pk_platform",
        }),
      ),
    );

    const res = await runCliForTest(
      [
        "setup",
        "--cwd",
        cwd,
        "--json",
        "--server",
        "http://localhost:9942",
        "--non-interactive",
        "--skip-install",
        "--framework",
        "next",
      ],
      // The search for local state ends at the home directory; pinning it
      // keeps the developer's own `~/.zitadel/local` out of the test.
      { HOME: cwd, USERPROFILE: cwd },
    );

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      warnings: string[];
      data: { next_actions: string[]; next_commands: string[] };
    };
    expect(json.warnings).toHaveLength(1);
    expect(json.warnings[0]).toContain(
      `No local admin for http://localhost:9942 in ${cwd} or its parents`,
    );
    expect(json.warnings[0]).toContain("If `zitadel start` started this server");
    expect(json.data.next_actions.join("\n")).not.toContain("No local admin");
    // No project to manage there, so the console is not suggested.
    expect(json.data.next_commands.join("\n")).not.toMatch(/ console$/m);
  });

  it("passes over a local admin that belongs to another server", async () => {
    const cwd = await makeNextProject();
    await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel/local/admin.json"),
      JSON.stringify({
        email: "admin@zitadel.localhost",
        password: "another-servers-password",
        user_id: "user_localadmin",
        team_id: "team_localadmin",
      }),
    );
    await recordStartedServer(cwd, "http://localhost:9999");
    // No sign-in or claim handlers: a request made with that admin would fail
    // the test as an unhandled request.
    server.use(
      http.get("http://localhost:9944/console/runtime.json", () =>
        HttpResponse.json({
          mode: "standalone",
          console_project_id: "proj_platform",
          publishable_key: "pk_platform",
        }),
      ),
    );

    const res = await runCliForTest(
      [
        "setup",
        "--cwd",
        cwd,
        "--json",
        "--server",
        "http://localhost:9944",
        "--non-interactive",
        "--skip-install",
        "--framework",
        "next",
      ],
      { HOME: cwd, USERPROFILE: cwd },
    );

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { warnings: string[] };
    expect(json.warnings[0]).toContain("No local admin for http://localhost:9944");
  });

  it("attaches the project to a local admin created in a parent directory and offers the console", async () => {
    const parent = await mkdtemp(join(tmpdir(), "zitadel-setup-parent-"));
    tempDirs.push(parent);
    await mkdir(join(parent, ".zitadel/local"), { recursive: true });
    await writeFile(
      join(parent, ".zitadel/local/admin.json"),
      JSON.stringify({
        email: "admin@zitadel.localhost",
        password: "local-admin-password",
        user_id: "user_localadmin",
        team_id: "team_localadmin",
      }),
    );
    await recordStartedServer(parent, "http://localhost:9943");
    const cwd = join(parent, "my-app");
    await mkdir(join(cwd, "app"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^15" } }),
    );
    await writeFile(join(cwd, "app/layout.tsx"), "export default function L() {}\n");
    const local = "http://localhost:9943";
    server.use(
      http.get(`${local}/console/runtime.json`, () =>
        HttpResponse.json({
          mode: "standalone",
          console_project_id: "proj_platform",
          publishable_key: "pk_platform",
        }),
      ),
      http.post(`${local}/api/v1/auth_attempts`, () =>
        HttpResponse.json({ attempt_id: "att_1" }, { status: 201 }),
      ),
      http.post(`${local}/api/v1/auth_attempts/:attempt/challenges`, () =>
        HttpResponse.json({ challenge_id: "ch_1" }, { status: 201 }),
      ),
      http.post(`${local}/api/v1/auth_attempts/:attempt/challenges/:challenge/verify`, () =>
        HttpResponse.json({ attempt_id: "att_1" }),
      ),
      http.post(`${local}/api/v1/auth_attempts/:attempt/handoff`, () =>
        HttpResponse.json({ handoff_token: "handoff_1" }),
      ),
      http.post(
        `${local}/api/v1/sessions/exchange`,
        () =>
          new HttpResponse(null, {
            headers: { "set-cookie": "__nextgen_session=admin_session; Path=/; HttpOnly" },
          }),
      ),
      http.post(`${local}/api/v1/projects/:projectId/claim/init`, () =>
        HttpResponse.json({ challenge_id: "claim_ch_1" }, { status: 201 }),
      ),
      http.get(`${local}/api/v1/sessions/me/csrf`, () =>
        HttpResponse.json({ csrf_token: "csrf_admin" }),
      ),
      // A cookie-authenticated write: refused without the session's CSRF
      // token, as the server does (ADR 053 §5).
      http.post(`${local}/api/v1/projects/:projectId/claim/complete`, ({ request }) =>
        request.headers.get("x-zitadel-csrf") === "csrf_admin"
          ? HttpResponse.json({ team_id: "team_localadmin", claimed_at: "2027-01-01T00:00:00Z" })
          : HttpResponse.json({ code: "auth.csrf_invalid", message: "no" }, { status: 403 }),
      ),
    );

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--json",
      "--server",
      local,
      "--non-interactive",
      "--skip-install",
      "--framework",
      "next",
    ]);

    expect(res.exitCode).toBe(0);
    const secret = JSON.parse(await readFile(join(cwd, ".zitadel/secret"), "utf8")) as {
      team_id?: string;
    };
    expect(secret.team_id).toBe("team_localadmin");
    const json = parseJson(res.stdout) as {
      data: { next_actions: string[]; next_commands: string[] };
    };
    expect(json.data.next_commands.at(-1)).toMatch(/^npx @zitadel\/cli@\S+ console$/);
    expect(json.data.next_actions.join("\n")).toContain(
      "Manage the project in the local console as admin@zitadel.localhost",
    );
  });

  it("errors in a non-interactive empty directory without --framework", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-empty-"));
    tempDirs.push(cwd);

    const res = await setup(cwd);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      hint: string;
      next_commands?: string[];
      details?: { frameworks?: string[] };
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_FRAMEWORK_NOT_DETECTED");
    // Every choice, not a prompt the caller cannot see. And no rerun: the
    // suggested command pins `--server local`, which this run did not ask for.
    expect(json.hint).toContain("only in a terminal");
    expect(json.hint).toContain("next, nuxt");
    expect(json.details?.frameworks).toContain("next");
    expect(json.next_commands ?? []).toEqual([]);
  });

  it("reproduces a non-default --use-case in the retry guidance when project creation fails", async () => {
    const cwd = await makeNextProject();

    // Force the project-create call to fail so the command surfaces its retry
    // guidance — the retry must reproduce the chosen use case verbatim, since
    // agents follow the suggested `setup ...` command literally.
    server.use(
      http.post("*/projects", () =>
        HttpResponse.json({ code: "E_INTERNAL", message: "boom" }, { status: 500 }),
      ),
    );

    const res = await setup(cwd, [
      "--non-interactive",
      "--skip-install",
      "--framework",
      "next",
      "--use-case",
      "business",
    ]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { status: string };
    expect(json.status).toBe("error");
    // `--use-case business` only appears in the reconstructed retry flags, so
    // its presence proves the non-default use case survived into the guidance.
    expect(res.stdout).toContain("--use-case business");
  });

  describe("when the default resources of a new app cannot be uploaded", () => {
    const failingUpload = async () => {
      const cwd = await makeNewAppDirectory();
      server.use(
        http.post("*/schemas", () =>
          HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
        ),
      );
      const res = await runCliForTest(
        [
          ...["setup", "--cwd", cwd, "--json", "--server", "https://api.zitadel.cloud"],
          ...["--framework", "next", "--non-interactive", "--skip-install"],
        ],
        { PATH: await aFakeAppGeneratorPath() },
      );
      return parseJson(res.stdout) as { hint?: string; next_commands?: string[] };
    };

    it("says the new app is gone again", async () => {
      const json = await failingUpload();

      expect(json.hint).toContain("so setup removed the new app again");
    });

    it("does not suggest --force, which the emptied directory does not need", async () => {
      const json = await failingUpload();

      expect(json.next_commands ?? []).toEqual([]);
    });
  });
});

describe("a retry after a failure before the wizard", () => {
  it("keeps the custom settings that were typed, though they do not make a connection yet", () => {
    const retry = retryOptionsFromFlags({ sso: "custom", "sso-slug": "acme-sso" });

    expect(setupRetryFlags(retry)).toContain("--sso custom --sso-slug acme-sso");
  });

  it("quotes what was typed for a shell", () => {
    const retry = retryOptionsFromFlags({
      sso: "custom",
      "sso-slug": "acme-sso",
      "sso-display-name": "Acme's SSO",
    });

    expect(setupRetryFlags(retry)).toContain("--sso-display-name 'Acme'\\''s SSO'");
  });

  it("restates a whole connection as before", () => {
    const retry = retryOptionsFromFlags({
      sso: "custom",
      "sso-slug": "acme-sso",
      "sso-display-name": "Acme",
      "sso-issuer": "https://sso.acme.example",
    });

    expect(setupRetryFlags(retry)).toContain("--sso-issuer https://sso.acme.example");
  });

  it("drops --non-interactive while a provider is being configured, typed in part or not", () => {
    const retry = retryOptionsFromFlags({
      sso: "custom",
      "sso-slug": "acme-sso",
      "non-interactive": true,
    });

    expect(setupRetryFlags(retry)).not.toContain("--non-interactive");
  });

  it("does not carry a provider this CLI does not offer", () => {
    const retry = retryOptionsFromFlags({ sso: "nonesuch", "sso-slug": "acme-sso" });

    expect(setupRetryFlags(retry)).not.toContain("--sso");
  });
});

describe("a custom provider named with --sso", () => {
  const partial = { sso: "custom", "sso-slug": "acme-sso" };
  const ask = vi.fn() as unknown as Asker;

  it("has the settings it was not given asked for when a person is there", async () => {
    vi.mocked(askCustomSettings).mockResolvedValueOnce({
      slug: "acme-sso",
      displayName: "Acme",
      issuer: "https://sso.acme.example",
      scopes: "openid",
    });

    const draft = await ssoFromFlags(partial, false, false, ask, "0.0.0-test");

    expect(draft?.selection).toMatchObject({ kind: "custom", connection: { displayName: "Acme" } });
  });

  it("is asked about with what was already typed", async () => {
    vi.mocked(askCustomSettings).mockClear();
    vi.mocked(askCustomSettings).mockResolvedValueOnce({
      slug: "acme-sso",
      displayName: "Acme",
      issuer: "https://sso.acme.example",
      scopes: "openid",
    });

    await ssoFromFlags(partial, false, false, ask, "0.0.0-test");

    expect(askCustomSettings).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "acme-sso" }),
      ask,
    );
  });

  it("is not asked about when nobody is there to answer", async () => {
    vi.mocked(askCustomSettings).mockClear();

    await expect(ssoFromFlags(partial, true, false, ask, "0.0.0-test")).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
    expect(askCustomSettings).not.toHaveBeenCalled();
  });
});

describe("setup with a custom provider described in part", () => {
  it("names what is missing when the run cannot ask, whatever the server is doing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-sso-"));
    tempDirs.push(cwd);

    const res = await setup(cwd, ["--sso", "custom", "--sso-slug", "acme-sso"]);

    expect(parseJson(res.stdout)).toMatchObject({ code: "E_VALIDATION" });
  });

  it("names what is missing before it looks for the local server", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-sso-"));
    tempDirs.push(cwd);

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--json",
      "--server",
      "local",
      "--sso",
      "custom",
      "--sso-slug",
      "acme-sso",
    ]);

    expect(parseJson(res.stdout)).toMatchObject({ code: "E_VALIDATION" });
  });

  it("shows the example with setup's own flags", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-sso-"));
    tempDirs.push(cwd);

    const res = await setup(cwd, ["--sso", "custom", "--sso-slug", "acme-sso"]);

    expect(parseJson(res.stdout)).toMatchObject({
      hint: expect.stringContaining(customExample(SETUP_FLAG_NAMES)),
    });
  });

  it("refuses a setting that is wrong before anything else", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-sso-"));
    tempDirs.push(cwd);

    const res = await setup(cwd, ["--sso", "custom", "--sso-slug", "Acme"]);

    expect(parseJson(res.stdout)).toMatchObject({ message: expect.stringContaining("--sso-slug") });
  });
});

describe("setup asked on a terminal", () => {
  // The built CLI bundles its own prompts, so a prompt can only be answered
  // by running the command from source, where `input` is the one module asked.
  const settingUp = (cwd: string, ...extra: string[]) =>
    asTerminal(() => Setup.run(["--cwd", cwd, "--server", "https://api.zitadel.cloud", ...extra]));

  it("still asks whether to proceed with the detected framework when --force is given", async () => {
    // --force permits overwriting files here. It must never answer a question.
    const cwd = await makeNextProject();
    vi.mocked(confirm).mockResolvedValueOnce(false as never);

    await settingUp(cwd, "--force").catch(() => undefined);

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Detected next. Proceed?" }),
    );
  });

  it("stops without writing anything when the framework is declined", async () => {
    const cwd = await makeNextProject();
    vi.mocked(confirm).mockResolvedValueOnce(false as never);

    await expect(settingUp(cwd)).rejects.toThrow();

    await expect(readFile(join(cwd, "zitadel.json"), "utf8")).rejects.toThrow();
  });

  describe("in a directory without an app", () => {
    beforeEach(async () => {
      vi.stubEnv("PATH", await aFakeAppGeneratorPath());
      vi.mocked(isCancel).mockImplementation((value) => value === CANCELLED);
      vi.mocked(text).mockClear();
      vi.mocked(intro).mockClear();
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    /** Picks Next.js to scaffold, then answers every question after it. */
    function answeringEveryQuestion(): void {
      vi.mocked(select)
        .mockResolvedValueOnce("next" as never)
        .mockResolvedValueOnce(DEFAULT_SETUP_USE_CASE as never)
        .mockResolvedValueOnce(DEFAULT_SETUP_PRESET as never);
      vi.mocked(text).mockResolvedValueOnce("3000" as never);
      vi.mocked(multiselect).mockResolvedValueOnce([] as never);
    }

    it("creates no app when a question after the framework is cancelled", async () => {
      const cwd = await makeNewAppDirectory();
      vi.mocked(select).mockResolvedValueOnce("next" as never);
      vi.mocked(text).mockResolvedValueOnce(CANCELLED as never);

      await expect(settingUp(cwd)).rejects.toThrow();

      expect(text).toHaveBeenCalledWith(expect.objectContaining({ message: "Dev server port" }));
      expect(await readdir(cwd)).toEqual([]);
    });

    it("creates the app once every question is answered", async () => {
      const cwd = await makeNewAppDirectory();
      answeringEveryQuestion();

      await settingUp(cwd, "--skip-install");

      expect(await readdir(cwd)).toEqual(expect.arrayContaining(["app", "zitadel.json"]));
    });

    it("asks every question under the heading the framework question opened", async () => {
      const cwd = await makeNewAppDirectory();
      answeringEveryQuestion();

      await settingUp(cwd, "--skip-install");

      expect(intro).toHaveBeenCalledTimes(1);
    });
  });
});

describe("setup --dev-port on an app already set up", () => {
  /** A Next app with a `dev` script, through setup on the detected port, 3000. */
  async function aSetUpNextApp(): Promise<string> {
    const cwd = await makeNextProject();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", scripts: { dev: "next dev" }, dependencies: { next: "^15" } }),
    );
    const res = await setup(cwd, ["--non-interactive", "--skip-install"]);
    expect(res.exitCode, res.stdout).toBe(0);
    return cwd;
  }

  function moveTo(cwd: string, port: number) {
    return setup(cwd, ["--non-interactive", "--dev-port", String(port)]);
  }

  /** The fields of `package.json`, `zitadel.json` and `.zitadel/secret` these tests read. */
  type MovedFile = {
    scripts?: { dev?: string };
    environments?: unknown;
    primary_origins?: unknown;
    preview_origins?: unknown;
    project_id?: string;
  };

  async function readJsonFile(cwd: string, path: string): Promise<MovedFile> {
    return JSON.parse(await readFile(join(cwd, path), "utf8")) as MovedFile;
  }

  async function projectOrigins(cwd: string): Promise<unknown> {
    const { project_id } = await readJsonFile(cwd, ".zitadel/secret");
    const res = await fetch(`https://api.zitadel.cloud/projects/${project_id}`);
    return ((await res.json()) as { origins: unknown }).origins;
  }

  it("moves the dev script, the issuer and the allowed origin to the new port", async () => {
    const cwd = await aSetUpNextApp();

    const res = await moveTo(cwd, 3101);

    expect(res.exitCode, res.stdout).toBe(0);
    const json = parseJson(res.stdout) as { status: string; data: Record<string, unknown> };
    expect(json.status).toBe("ok");
    expect(json.data).toMatchObject({
      moved: true,
      previous_issuer: "http://localhost:3000",
      issuer: "http://localhost:3101",
    });
    expect((await readJsonFile(cwd, "package.json")).scripts?.dev).toBe("next dev --port 3101");
    expect(await readFile(join(cwd, ".env.local"), "utf8")).toContain(
      "ZITADEL_ISSUER=http://localhost:3101\n",
    );
    expect((await readJsonFile(cwd, "zitadel.json")).environments).toEqual({
      development: { issuer: "http://localhost:3101" },
    });
    expect((await readJsonFile(cwd, ".zitadel/secret")).primary_origins).toEqual([
      "http://localhost:3101",
    ]);
    expect(await readFile(join(cwd, "README.md"), "utf8")).toContain("http://localhost:3101/login");
    expect(await projectOrigins(cwd)).toEqual([
      { pattern: "http://localhost:3101", kind: "primary" },
    ]);
  });

  it("changes nothing when the server refuses the new origin", async () => {
    const cwd = await aSetUpNextApp();
    const before = await readFile(join(cwd, "package.json"), "utf8");
    const env = await readFile(join(cwd, ".env.local"), "utf8");
    server.use(
      http.post("*/projects/:project_id/origins", () =>
        HttpResponse.json({ code: "unavailable", message: "down" }, { status: 503 }),
      ),
    );

    const res = await moveTo(cwd, 3101);

    expect(res.exitCode).not.toBe(0);
    expect(await readFile(join(cwd, "package.json"), "utf8")).toBe(before);
    expect(await readFile(join(cwd, ".env.local"), "utf8")).toBe(env);
  });

  it("reports nothing moved for the port the app is already on", async () => {
    const cwd = await aSetUpNextApp();

    const res = await moveTo(cwd, 3000);

    expect(res.exitCode, res.stdout).toBe(0);
    const json = parseJson(res.stdout) as { data: { moved: boolean; files_written: string[] } };
    expect(json.data.moved).toBe(false);
    expect(await projectOrigins(cwd)).toEqual([
      { pattern: "http://localhost:3000", kind: "primary" },
    ]);
  });

  it("refuses a port outside 1..65535", async () => {
    const cwd = await aSetUpNextApp();

    const res = await moveTo(cwd, 70000);

    const json = parseJson(res.stdout) as { code: string };
    expect(json.code).toBe("E_VALIDATION");
  });
});
