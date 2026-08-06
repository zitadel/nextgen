import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resetPlatformStore,
  setupPlatformHandlers,
} from "@zitadel/api-mock/platform";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../helpers/run-cli";

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
        JSON.stringify({ name: "demo", dependencies: { react: "^19.0.0", vite: "^7.0.0" } }),
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
        JSON.stringify({ name: "demo", dependencies: { vue: "^3.0.0", vite: "^7.0.0" } }),
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
    expect(json.data.next_commands[2]).toMatch(/^npx @zitadel\/cli@\S+ plan$/);
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
      expect(json.data.next_commands[2]).toMatch(/^npx @zitadel\/cli@\S+ plan$/);
    },
  );

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
            preview_origins: ["http://localhost:3000"],
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
      preview_origins: expect.arrayContaining(["http://localhost:3000"]),
      seed_defaults: false,
    });
    const projectName = (createProjectBody as { name?: unknown }).name;
    expect(typeof projectName).toBe("string");
    if (typeof projectName !== "string") {
      throw new Error("expected create-project payload name to be a string");
    }
    expect(projectName.trim().length).toBeGreaterThan(0);
  });

  it("errors in a non-interactive empty directory without --framework", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-empty-"));
    tempDirs.push(cwd);

    const res = await setup(cwd);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { status: string; code: string; hint: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_FRAMEWORK_NOT_DETECTED");
    expect(json.hint).toContain("Run without --json/--non-interactive");
    expect(json.hint).not.toContain("next");
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
});
