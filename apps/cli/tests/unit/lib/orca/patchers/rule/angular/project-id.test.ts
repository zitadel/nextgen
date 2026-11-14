import { execFile } from "node:child_process";
import { readFile, rm, stat, utimes } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { promisify } from "node:util";

import { describe, expect } from "vitest";

import { ZitadelError } from "@/lib/errors";
import { AngularPatcher } from "@/lib/orca/patchers/rule/angular";
import type { FileOp } from "@/lib/orca/patchers/rule/file-writer/types";
import {
  appComponentTemplate,
  appTemplateHtml,
  LAUNCHER_PATH,
  launcherTemplate,
  PROJECT_ID_MODULE_PATH,
  projectIdModule,
  proxyConfTemplate,
} from "@/lib/orca/patchers/rule/angular/templates";
import type { PatchContext, PatchExecOptions } from "@/lib/orca/patchers/types";
import { it } from "@tests/helpers/fixtures";
import { write } from "@tests/helpers/git-repo";
import { rejectionOf } from "@tests/helpers/thrown-value";

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

/** Each managed app file the plan writes, as a fresh setup writes it. */
function managedAppFiles(c: PatchContext): Record<string, string | undefined> {
  const patcher = new AngularPatcher();
  const plan = patcher.plan(c);
  const files = patcher.artifacts({ framework: c.framework, rendererId: c.rendererId }).markedFiles;
  return Object.fromEntries(
    files.map((path) => {
      const write = plan.ops.find(
        (op): op is Extract<FileOp, { kind: "write" }> => op.kind === "write" && op.path === path,
      );
      const edit = plan.ops.find(
        (op): op is Extract<FileOp, { kind: "edit" }> => op.kind === "edit" && op.path === path,
      );
      return [path, write?.contents ?? edit?.edit(undefined)];
    }),
  );
}

describe("AngularPatcher.plan", () => {
  it("writes the same managed app files for setups against two projects", () => {
    const a = managedAppFiles(ctx("proj_aaaaaaaa"));

    const b = managedAppFiles(ctx("proj_bbbbbbbb"));

    expect(b).toEqual(a);
  });

  it("names no project in the managed app files", () => {
    const files = managedAppFiles(ctx("proj_aaaaaaaa"));

    expect(JSON.stringify(files)).not.toContain("proj_aaaaaaaa");
  });
});

/** The id the tests' `.env.local` holds. */
const LOCAL_ID = "proj_local";

/** An app holding the launcher, the managed `app.ts` and `files`, whose Angular CLI prints the arguments it was given. */
async function anAppWithTheLauncher(
  dir: string,
  files: Record<string, string> = {},
): Promise<void> {
  await write(dir, {
    [LAUNCHER_PATH]: launcherTemplate(),
    "src/app/app.ts": appComponentTemplate(ctx()),
    "node_modules/@angular/cli/bin/ng.js": "console.log(JSON.stringify(process.argv.slice(2)));\n",
    ...files,
  });
}

/** How a launcher runs in `dir`: this process's environment, without ZITADEL_PROJECT_ID, plus `env`. */
function launchedIn(dir: string, env: Record<string, string> = {}) {
  const { ZITADEL_PROJECT_ID: _unset, ...inherited } = process.env;
  return { cwd: dir, env: { ...inherited, ...env } };
}

/** The module the launcher wrote in `dir`. */
const moduleIn = (dir: string): Promise<string> => {
  return readFile(join(dir, PROJECT_ID_MODULE_PATH), "utf8");
};

/** A time long enough ago that a write in the test would show in the file's mtime. */
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");

describe("the generated zitadel-ng.cjs, run by Node", () => {
  it("writes the project id .env.local holds into the module", async ({ dir }) => {
    await anAppWithTheLauncher(dir, { ".env.local": `ZITADEL_PROJECT_ID=${LOCAL_ID}\n` });

    await run(process.execPath, [LAUNCHER_PATH, "build"], launchedIn(dir));

    expect(await moduleIn(dir)).toBe(projectIdModule(LOCAL_ID));
  });

  it("writes the environment's id without .env.local", async ({ dir }) => {
    await anAppWithTheLauncher(dir);

    await run(
      process.execPath,
      [LAUNCHER_PATH, "build"],
      launchedIn(dir, { ZITADEL_PROJECT_ID: "proj_ci" }),
    );

    expect(await moduleIn(dir)).toBe(projectIdModule("proj_ci"));
  });

  it("prefers the environment's id to .env.local's, as the dev proxy does", async ({ dir }) => {
    await anAppWithTheLauncher(dir, { ".env.local": `ZITADEL_PROJECT_ID=${LOCAL_ID}\n` });

    await run(
      process.execPath,
      [LAUNCHER_PATH, "build"],
      launchedIn(dir, { ZITADEL_PROJECT_ID: "proj_ci" }),
    );

    expect(await moduleIn(dir)).toBe(projectIdModule("proj_ci"));
  });

  it("leaves a module that already holds the id untouched, so a watcher is not woken", async ({
    dir,
  }) => {
    await anAppWithTheLauncher(dir, {
      ".env.local": `ZITADEL_PROJECT_ID=${LOCAL_ID}\n`,
      [PROJECT_ID_MODULE_PATH]: projectIdModule(LOCAL_ID),
    });
    await utimes(join(dir, PROJECT_ID_MODULE_PATH), LONG_AGO, LONG_AGO);

    await run(process.execPath, [LAUNCHER_PATH, "serve"], launchedIn(dir));

    expect((await stat(join(dir, PROJECT_ID_MODULE_PATH))).mtime).toEqual(LONG_AGO);
  });

  it("passes the Angular CLI the arguments it was given, unchanged", async ({ dir }) => {
    await anAppWithTheLauncher(dir, { ".env.local": `ZITADEL_PROJECT_ID=${LOCAL_ID}\n` });

    const { stdout } = await run(
      process.execPath,
      [LAUNCHER_PATH, "build", "--watch", "--configuration", "development"],
      launchedIn(dir),
    );

    expect(JSON.parse(stdout)).toEqual(["build", "--watch", "--configuration", "development"]);
  });

  it("exits non-zero without a project id, naming what to set", async ({ dir }) => {
    await anAppWithTheLauncher(dir);

    const refusal = await rejectionOf(() =>
      run(process.execPath, [LAUNCHER_PATH, "build"], launchedIn(dir)),
    );

    expect(refusal).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("ZITADEL_PROJECT_ID is not set"),
    });
  });

  it("writes the module app.ts imports", async ({ dir }) => {
    await anAppWithTheLauncher(dir, { ".env.local": `ZITADEL_PROJECT_ID=${LOCAL_ID}\n` });

    await run(process.execPath, [LAUNCHER_PATH, "build"], launchedIn(dir));

    const specifier = appComponentTemplate(ctx()).match(
      /import \{ ZITADEL_PROJECT_ID \} from "(.+)";/,
    )?.[1];
    const imported = posix.join(dirname("src/app/app.ts"), `${specifier}.ts`);
    expect(await readFile(join(dir, imported), "utf8")).toBe(projectIdModule(LOCAL_ID));
  });
});

/** The managed `src/app/app.ts` an earlier CLI wrote for project `proj-1`, naming it as a literal. */
const LITERAL_APP_COMPONENT = `// zitadel-cli: managed-file v1
import { Component, OnInit } from "@angular/core";
import {
  ZitadelLoginComponent,
  ZitadelSessionComponent,
  configureZitadel,
} from "@zitadel/sdk-angular";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [ZitadelLoginComponent, ZitadelSessionComponent],
  templateUrl: "./app.html",
})
export class App implements OnInit {
  protected readonly project = configureZitadel({
    projectId: "proj-1",
    proxyPath: "/__nextgen",
  });
  protected readonly path = window.location.pathname;

  ngOnInit(): void {
    if (this.path === "/") {
      window.location.replace("/login");
    }
  }
}
`;

/** The Angular release an app runs, and the builder `ng new` gave it. */
type Angular = Readonly<{ version: string; serveBuilder: string; buildPackage: string }>;

const ANGULAR_19: Angular = {
  version: "^19.2.0",
  serveBuilder: "@angular-devkit/build-angular:dev-server",
  buildPackage: "@angular-devkit/build-angular",
};

const ANGULAR_20: Angular = {
  version: "^20.3.0",
  serveBuilder: "@angular/build:dev-server",
  buildPackage: "@angular/build",
};

const ANGULAR_22: Angular = {
  version: "^22.2.0",
  serveBuilder: "@angular/build:dev-server",
  buildPackage: "@angular/build",
};

/** The scripts `ng new` writes, and the `dev` an earlier setup added. */
const EARLIER_SCRIPTS = {
  ng: "ng",
  start: "ng serve",
  build: "ng build",
  watch: "ng build --watch --configuration development",
  test: "ng test",
  dev: "ng serve",
};

/** An Angular app an earlier CLI set up: `app.ts` names its project, and its scripts run `ng`. */
async function anEarlierSetUpApp(dir: string, angular: Angular): Promise<void> {
  await write(dir, {
    "package.json": `${JSON.stringify(
      {
        name: "app",
        scripts: EARLIER_SCRIPTS,
        dependencies: { "@angular/core": angular.version, "@zitadel/sdk-angular": "^0.6.0" },
        devDependencies: { [angular.buildPackage]: angular.version },
      },
      null,
      2,
    )}\n`,
    "angular.json": `${JSON.stringify(
      {
        projects: {
          app: {
            architect: {
              build: {},
              serve: {
                builder: angular.serveBuilder,
                options: { proxyConfig: "proxy.conf.cjs", port: 3000 },
              },
            },
          },
        },
      },
      null,
      2,
    )}\n`,
    "src/main.ts":
      'import { bootstrapApplication } from "@angular/platform-browser";\nimport { App } from "./app/app";\n\nbootstrapApplication(App);\n',
    "src/app/app.routes.ts":
      'import { Routes } from "@angular/router";\n\nexport const routes: Routes = [\n  { path: "login", children: [] },\n  { path: "register", children: [] },\n  { path: "profile", children: [] },\n];\n',
    "src/app/app.ts": LITERAL_APP_COMPONENT,
    "src/app/app.html": appTemplateHtml(ctx()),
    "proxy.conf.cjs": proxyConfTemplate(),
  });
}

/** The same app with its `app.ts` deleted. */
async function anEarlierSetUpAppWithoutAppTs(dir: string, angular: Angular): Promise<void> {
  await anEarlierSetUpApp(dir, angular);
  await rm(join(dir, "src/app/app.ts"));
}

/** An Angular 22 app this CLI set up, whose scripts run the launcher, with the launcher deleted. */
async function aLaunchedAppWithoutTheLauncher(dir: string): Promise<void> {
  await anEarlierSetUpApp(dir, ANGULAR_22);
  await write(dir, {
    "src/app/app.ts": appComponentTemplate(ctx()),
    "package.json": `${JSON.stringify({
      name: "app",
      scripts: { build: "node zitadel-ng.cjs build", dev: "node zitadel-ng.cjs serve" },
      dependencies: { "@angular/core": "^22.2.0" },
      devDependencies: { "@angular/build": "^22.2.0" },
    })}\n`,
  });
}

/** The scripts, `app.ts` and launcher of the app in `dir`, as a repair might change them. */
async function scriptsAndRoot(dir: string): Promise<Record<string, string | undefined>> {
  const read = (path: string) => {
    return readFile(join(dir, path), "utf8").catch(() => {
      return undefined;
    });
  };
  return {
    scripts: JSON.stringify(JSON.parse((await read("package.json")) ?? "{}").scripts),
    "src/app/app.ts": await read("src/app/app.ts"),
    [LAUNCHER_PATH]: await read(LAUNCHER_PATH),
  };
}

/** How `doctor --fix` runs a repair in `dir`. */
const missingOnlyIn = (dir: string): PatchExecOptions => {
  return { cwd: dir, dryRun: false, force: false, missingOnly: true };
};

/** How setup patches `dir`. */
const setUpIn = (dir: string): PatchExecOptions => {
  return { cwd: dir, dryRun: false, force: false };
};

const EARLIER_SET_UP = [
  ["19", ANGULAR_19],
  ["20", ANGULAR_20],
  ["22", ANGULAR_22],
] as const;

describe("AngularPatcher.verify", () => {
  describe("with an app an earlier CLI set up", () => {
    it.for(EARLIER_SET_UP)(
      "finds every wiring applied on Angular %s",
      async ([, angular], { dir }) => {
        await anEarlierSetUpApp(dir, angular);

        const statuses = await new AngularPatcher().verify(ctx(), { cwd: dir });

        expect(statuses.filter((status) => status.state !== "applied")).toEqual([]);
      },
    );
  });
});

describe("AngularPatcher.repair", () => {
  describe("with an app an earlier CLI set up", () => {
    it.for(EARLIER_SET_UP)(
      "leaves its scripts and app.ts as they are, and adds no launcher, on Angular %s",
      async ([, angular], { dir }) => {
        await anEarlierSetUpApp(dir, angular);
        const before = await scriptsAndRoot(dir);

        await new AngularPatcher().repair(ctx(), missingOnlyIn(dir));

        expect(await scriptsAndRoot(dir)).toEqual(before);
      },
    );

    it.for(EARLIER_SET_UP)(
      "restores no app.ts that imports the module, and no launcher, on Angular %s",
      async ([, angular], { dir }) => {
        await anEarlierSetUpAppWithoutAppTs(dir, angular);
        const before = await scriptsAndRoot(dir);

        await new AngularPatcher().repair(ctx(), missingOnlyIn(dir));

        expect(await scriptsAndRoot(dir)).toEqual(before);
      },
    );
  });

  describe("with an app whose scripts run the launcher", () => {
    it("restores the launcher", async ({ dir }) => {
      await aLaunchedAppWithoutTheLauncher(dir);

      await new AngularPatcher().repair(ctx(), missingOnlyIn(dir));

      expect(await readFile(join(dir, LAUNCHER_PATH), "utf8")).toBe(launcherTemplate());
    });
  });
});

describe("AngularPatcher.patch", () => {
  describe("with an app ng new created", () => {
    it.for(EARLIER_SET_UP)(
      "runs its serve, build and test scripts through the launcher on Angular %s",
      async ([, angular], { dir }) => {
        await anEarlierSetUpAppWithoutAppTs(dir, angular);

        await new AngularPatcher().patch(ctx(), setUpIn(dir));

        expect(JSON.parse(await readFile(join(dir, "package.json"), "utf8")).scripts).toEqual({
          ng: "ng",
          start: "node zitadel-ng.cjs serve",
          build: "node zitadel-ng.cjs build",
          watch: "node zitadel-ng.cjs build --watch --configuration development",
          test: "node zitadel-ng.cjs test",
          dev: "node zitadel-ng.cjs serve",
        });
      },
    );

    it("writes the module for the project it sets the app up for", async ({ dir }) => {
      await anEarlierSetUpAppWithoutAppTs(dir, ANGULAR_22);

      await new AngularPatcher().patch(ctx("proj_setup"), setUpIn(dir));

      expect(await moduleIn(dir)).toBe(projectIdModule("proj_setup"));
    });

    it("has git ignore the module", async ({ dir }) => {
      await anEarlierSetUpAppWithoutAppTs(dir, ANGULAR_22);

      await new AngularPatcher().patch(ctx(), setUpIn(dir));

      expect(await readFile(join(dir, ".gitignore"), "utf8")).toContain(
        `/${PROJECT_ID_MODULE_PATH}\n`,
      );
    });
  });

  describe("with a script setup cannot run through the launcher", () => {
    it("refuses, naming the script", async ({ dir }) => {
      await anEarlierSetUpAppWithoutAppTs(dir, ANGULAR_22);
      await write(dir, {
        "package.json": `${JSON.stringify({
          name: "app",
          scripts: { start: "ng s --open", build: "ng build" },
          devDependencies: { "@angular/build": "^22.2.0" },
        })}\n`,
      });

      const refusal = await rejectionOf(() => new AngularPatcher().patch(ctx(), setUpIn(dir)));

      expect(refusal).toBeInstanceOf(ZitadelError);
      expect(refusal).toMatchObject({
        code: "E_CONFLICT",
        message: expect.stringContaining('package.json\'s "start" (ng s --open)'),
      });
    });
  });
});
