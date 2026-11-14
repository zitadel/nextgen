import { execFile } from "node:child_process";
import { readFile, stat, utimes } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { promisify } from "node:util";

import { describe, expect } from "vitest";

import { ZitadelError } from "@/lib/errors";
import {
  appComponentTemplate,
  devScriptEdit,
  LAUNCHER_PATH,
  launcherScriptsEdit,
  launcherTemplate,
  PROJECT_ID_MODULE_PATH,
  projectIdModule,
  projectIdModuleEdit,
} from "@/lib/orca/patchers/rule/angular/templates";
import type { PatchContext } from "@/lib/orca/patchers/types";
import { it } from "@tests/helpers/fixtures";
import { write } from "@tests/helpers/git-repo";
import { rejectionOf, thrownBy } from "@tests/helpers/thrown-value";

const run = promisify(execFile);

function ctx(projectId = "proj-1"): PatchContext {
  return {
    framework: { id: "angular", appDir: "src/app", devPort: 3000, url: "http://localhost:3000" },
    rendererId: "react",
    project: {
      id: projectId,
      project_secret: "sk_full",
      preview_secret: "sk_preview",
      origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
    },
    issuer: "http://localhost:3000",
    server: "https://api.zitadel.cloud",
    cliVersion: "0.1.0-alpha.0",
  };
}

/** The id the tests' `.env.local` holds. */
const LOCAL_ID = "proj_local";

/** A `.env.local` as setup writes it: the id beside the project's secret. */
const ENV_LOCAL = `ZITADEL_PROJECT_ID=${LOCAL_ID}\nZITADEL_PROJECT_SECRET=sk_secret\n`;

/**
 * An Angular CLI that prints the arguments it was given and whether the
 * project secret reached its environment.
 */
const PRINTING_NG = `console.log(JSON.stringify({ args: process.argv.slice(2), secret: "ZITADEL_PROJECT_SECRET" in process.env }));\n`;

/** An app holding the launcher, the managed `app.ts` and `files`, whose Angular CLI is {@link PRINTING_NG}. */
async function anAppWithTheLauncher(
  dir: string,
  files: Record<string, string> = {},
): Promise<void> {
  await write(dir, {
    [LAUNCHER_PATH]: launcherTemplate(),
    "src/app/app.ts": appComponentTemplate(ctx()),
    "node_modules/@angular/cli/bin/ng.js": PRINTING_NG,
    ...files,
  });
}

/** How a launcher runs in `cwd`: this process's environment, without ZITADEL_PROJECT_ID, plus `env`. */
function launchedIn(cwd: string, env: Record<string, string> = {}) {
  const { ZITADEL_PROJECT_ID: _unset, ...inherited } = process.env;
  return { cwd, env: { ...inherited, ...env } };
}

/** The module in the app at `dir`. */
const moduleIn = (dir: string): Promise<string> => {
  return readFile(join(dir, PROJECT_ID_MODULE_PATH), "utf8");
};

/** What {@link PRINTING_NG} printed. */
const printed = (stdout: string): { args: string[]; secret: boolean } => JSON.parse(stdout);

/** A time long enough ago that a write in the test would show in the file's mtime. */
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");

describe("launcherTemplate", () => {
  describe("with the id in .env.local", () => {
    it("writes it into the module", async ({ dir }) => {
      await anAppWithTheLauncher(dir, { ".env.local": ENV_LOCAL });

      await run(process.execPath, [LAUNCHER_PATH, "build"], launchedIn(dir));

      expect(await moduleIn(dir)).toBe(projectIdModule(LOCAL_ID));
    });

    it("keeps the rest of the file, the project secret included, out of the Angular CLI's environment", async ({
      dir,
    }) => {
      await anAppWithTheLauncher(dir, { ".env.local": ENV_LOCAL });

      const { stdout } = await run(process.execPath, [LAUNCHER_PATH, "build"], launchedIn(dir));

      expect(printed(stdout).secret).toBe(false);
    });

    it("writes the app's module when run from another directory", async ({ dir }) => {
      await anAppWithTheLauncher(dir, { ".env.local": ENV_LOCAL });

      await run(
        process.execPath,
        [join(dir, LAUNCHER_PATH), "build"],
        launchedIn(join(dir, "src")),
      );

      expect(await moduleIn(dir)).toBe(projectIdModule(LOCAL_ID));
    });

    it("leaves a module that already holds the id untouched, so a watcher is not woken", async ({
      dir,
    }) => {
      await anAppWithTheLauncher(dir, {
        ".env.local": ENV_LOCAL,
        [PROJECT_ID_MODULE_PATH]: projectIdModule(LOCAL_ID),
      });
      await utimes(join(dir, PROJECT_ID_MODULE_PATH), LONG_AGO, LONG_AGO);

      await run(process.execPath, [LAUNCHER_PATH, "serve"], launchedIn(dir));

      expect((await stat(join(dir, PROJECT_ID_MODULE_PATH))).mtime).toEqual(LONG_AGO);
    });
  });

  describe("with the id in the environment", () => {
    it("writes it into the module without .env.local", async ({ dir }) => {
      await anAppWithTheLauncher(dir);

      await run(
        process.execPath,
        [LAUNCHER_PATH, "build"],
        launchedIn(dir, { ZITADEL_PROJECT_ID: "proj_ci" }),
      );

      expect(await moduleIn(dir)).toBe(projectIdModule("proj_ci"));
    });

    it("prefers it to .env.local's, as the dev proxy does", async ({ dir }) => {
      await anAppWithTheLauncher(dir, { ".env.local": ENV_LOCAL });

      await run(
        process.execPath,
        [LAUNCHER_PATH, "build"],
        launchedIn(dir, { ZITADEL_PROJECT_ID: "proj_ci" }),
      );

      expect(await moduleIn(dir)).toBe(projectIdModule("proj_ci"));
    });
  });

  it("passes the Angular CLI the arguments it was given, unchanged", async ({ dir }) => {
    await anAppWithTheLauncher(dir, { ".env.local": ENV_LOCAL });

    const { stdout } = await run(
      process.execPath,
      [LAUNCHER_PATH, "build", "--watch", "--configuration", "development"],
      launchedIn(dir),
    );

    expect(printed(stdout).args).toEqual(["build", "--watch", "--configuration", "development"]);
  });

  it("exits non-zero without a project id, naming what to set", async ({ dir }) => {
    await anAppWithTheLauncher(dir);

    const refusal = await rejectionOf(() =>
      run(process.execPath, [LAUNCHER_PATH, "test"], launchedIn(dir)),
    );

    expect(refusal).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("ZITADEL_PROJECT_ID is not set"),
    });
  });

  it("writes the file app.ts imports", async ({ dir }) => {
    await anAppWithTheLauncher(dir, { ".env.local": ENV_LOCAL });

    await run(process.execPath, [LAUNCHER_PATH, "build"], launchedIn(dir));

    const specifier = appComponentTemplate(ctx()).match(
      /import \{ ZITADEL_PROJECT_ID \} from "(.+)";/,
    )?.[1];
    const imported = posix.join(dirname("src/app/app.ts"), `${specifier}.ts`);
    expect(await readFile(join(dir, imported), "utf8")).toBe(projectIdModule(LOCAL_ID));
  });
});

describe("appComponentTemplate", () => {
  it("names no project", () => {
    const template = appComponentTemplate(ctx("proj_aaaaaaaa"));

    expect(template).not.toContain("proj_aaaaaaaa");
  });
});

describe("projectIdModuleEdit", () => {
  it("writes the module for the project when it is absent", () => {
    const written = projectIdModuleEdit("proj_setup")(undefined);

    expect(written).toBe(projectIdModule("proj_setup"));
  });

  it("leaves a module that exists as it is, whichever project it holds", () => {
    const existing = projectIdModule("proj_other");

    expect(projectIdModuleEdit("proj_setup")(existing)).toBe(existing);
  });
});

describe("launcherScriptsEdit", () => {
  it.each([
    ["ng serve", "node zitadel-ng.cjs serve"],
    ["ng build", "node zitadel-ng.cjs build"],
    ["ng test", "node zitadel-ng.cjs test"],
    [
      "ng build --watch --configuration development",
      "node zitadel-ng.cjs build --watch --configuration development",
    ],
  ])("runs the plain script %s through the launcher", (command, launched) => {
    const out = launcherScriptsEdit(JSON.stringify({ scripts: { any: command } }));

    expect(JSON.parse(out).scripts.any).toBe(launched);
  });

  it.each([
    "ng",
    "ng lint",
    "ng s --open",
    "ng build && cp -r public dist",
    'concurrently "ng serve" api',
  ])("leaves the script %s as it is", (command) => {
    const source = JSON.stringify({ scripts: { any: command } });

    expect(launcherScriptsEdit(source)).toBe(source);
  });

  it("leaves package.json byte for byte once its scripts run through the launcher", () => {
    const once = launcherScriptsEdit(
      `{\n  "name": "a",\n  "scripts": { "build": "ng build" }\n}\n`,
    );

    expect(launcherScriptsEdit(once)).toBe(once);
  });
});

describe("devScriptEdit", () => {
  it("adds a `dev` script that serves through the launcher, so `npm run dev` works like the other frameworks", () => {
    const result = JSON.parse(devScriptEdit(`{ "scripts": { "start": "ng serve" } }`));

    expect(result.scripts.dev).toBe("node zitadel-ng.cjs serve");
  });

  it("preserves an existing `dev` script instead of overwriting it", () => {
    const source = `{ "scripts": { "dev": "vite" } }`;

    expect(devScriptEdit(source)).toBe(source);
  });

  it("fails fast when package.json is absent instead of fabricating one", () => {
    const refusal = thrownBy(() => devScriptEdit(undefined));

    expect(refusal).toBeInstanceOf(ZitadelError);
    expect(refusal).toMatchObject({ code: "E_VALIDATION" });
  });
});
