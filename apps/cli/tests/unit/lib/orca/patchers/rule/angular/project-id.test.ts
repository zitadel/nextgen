import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { AngularPatcher } from "@/lib/orca/patchers/rule/angular";
import type { FileOp } from "@/lib/orca/patchers/rule/file-writer/types";
import {
  appComponentProjectIdEdit,
  appComponentProjectIdVerdict,
  appComponentTemplate,
  launcherEdit,
  launcherTemplate,
  PROJECT_ID_GUARD,
} from "@/lib/orca/patchers/rule/angular/templates";
import type { PatchContext } from "@/lib/orca/patchers/types";

const run = promisify(execFile);

function ctx(projectId = "proj-1", useCase?: PatchContext["useCase"]): PatchContext {
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
    ...(useCase ? { useCase } : {}),
  };
}

/** The managed `src/app/app.ts` setup wrote for project `proj-1` before it read the id from the environment. */
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

/** What the current template has that the literal one did not, before the component. */
const DECLARATION = `// The project id: zitadel-ng.cjs, which the dev and build scripts run,
// defines it from ZITADEL_PROJECT_ID in the environment or in .env.local.
// Without it (ng test, a plain ng build) the login widget says it has none.
declare const ZITADEL_PROJECT_ID: string | undefined;

`;

/** The line of the current template that reads the define. */
const DEFINE_LINE =
  '    projectId: typeof ZITADEL_PROJECT_ID === "string" ? ZITADEL_PROJECT_ID : "",\n';

/** `app.ts` as setup wrote it for `c`'s project and use case before it read the id from the environment. */
function literalAppComponent(c: PatchContext): string {
  const current = appComponentTemplate(c);
  const previous = current
    .replace(DECLARATION, "")
    .replace(DEFINE_LINE, `    projectId: ${JSON.stringify(c.project.id)},\n`);
  if (!current.includes(DECLARATION) || previous.includes("ZITADEL_PROJECT_ID")) {
    throw new Error("expected the define-reading component in the managed template");
  }
  return previous;
}

/** Each app file the plan manages, as a fresh setup writes it. */
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

describe("the managed app.ts", () => {
  it("names no project, so setups against two projects write the same app files", () => {
    const a = managedAppFiles(ctx("proj_aaaaaaaa"));
    const b = managedAppFiles(ctx("proj_bbbbbbbb"));

    expect(Object.keys(a)).toEqual([
      "src/app/app.ts",
      "src/app/app.html",
      "proxy.conf.cjs",
      "zitadel-ng.cjs",
    ]);
    expect(b).toEqual(a);
    expect(a["src/app/app.ts"]).toContain(DEFINE_LINE);
    expect(a["src/app/app.ts"]).not.toContain("proj_aaaaaaaa");
  });

  it("is the literal one an earlier setup wrote, with the id read from the define", () => {
    expect(literalAppComponent(ctx())).toBe(LITERAL_APP_COMPONENT);
  });

  it.each([
    ["a minimal", undefined],
    ["a business", "business" as const],
  ])("moves %s component an earlier setup wrote onto the define", (_name, useCase) => {
    const c = ctx("proj-1", useCase);
    const literal = literalAppComponent(c);

    const out = appComponentProjectIdEdit(c)(literal);

    expect(out).toBe(appComponentTemplate(c));
    expect(appComponentProjectIdEdit(c)(out)).toBe(out);
    expect(appComponentProjectIdVerdict("proj-1")(literal)).toBe("detached");
    expect(appComponentProjectIdVerdict("proj-1")(out)).toBe("applied");
  });

  it("moves a CRLF component with CRLF line ends", () => {
    const crlf = LITERAL_APP_COMPONENT.replace(/\n/g, "\r\n");

    const out = appComponentProjectIdEdit(ctx())(crlf);

    expect(out).toBe(appComponentTemplate(ctx()).replace(/\n/g, "\r\n"));
    expect(appComponentProjectIdVerdict("proj-1")(crlf)).toBe("detached");
  });

  it("leaves a component whose id line was changed by hand to the developer, and reads it as unknown", () => {
    const edited = LITERAL_APP_COMPONENT.replace(
      '    projectId: "proj-1",\n',
      '    projectId: "proj-1", // ours\n',
    );

    expect(appComponentProjectIdEdit(ctx())(edited)).toBe(edited);
    expect(appComponentProjectIdVerdict("proj-1")(edited)).toEqual({
      unknown: expect.stringContaining("must read ZITADEL_PROJECT_ID"),
    });
  });

  it("leaves a component the developer adopted alone", () => {
    const adopted = LITERAL_APP_COMPONENT.replace("// zitadel-cli: managed-file v1\n", "");

    expect(appComponentProjectIdEdit(ctx())(adopted)).toBe(adopted);
    expect(appComponentProjectIdVerdict("proj-1")(adopted)).toBe("applied");
  });
});

describe("the generated zitadel-ng.cjs, run by Node", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => {
        return rm(dir, { recursive: true, force: true });
      }),
    );
  });

  /** An app holding the launcher and `files`, whose Angular CLI prints the arguments it was given. */
  async function anApp(files: Record<string, string> = {}): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-ng-"));
    dirs.push(dir);
    const all: Record<string, string> = {
      "zitadel-ng.cjs": launcherTemplate(),
      "node_modules/@angular/cli/bin/ng.js":
        "console.log(JSON.stringify(process.argv.slice(2)));\n",
      ...files,
    };
    for (const [path, contents] of Object.entries(all)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), contents);
    }
    return dir;
  }

  async function launch(
    dir: string,
    env: Record<string, string> = {},
  ): Promise<{ args: string[] } | { exitCode: number; stderr: string }> {
    const { ZITADEL_PROJECT_ID: _unset, ...inherited } = process.env;
    try {
      const { stdout } = await run(process.execPath, ["zitadel-ng.cjs", "build", "--watch"], {
        cwd: dir,
        env: { ...inherited, ...env },
      });
      return { args: JSON.parse(stdout) };
    } catch (error) {
      const failed = error as { code: number; stderr: string };
      return { exitCode: failed.code, stderr: failed.stderr };
    }
  }

  it("defines the project id .env.local holds, after the Angular CLI's own arguments", async () => {
    const dir = await anApp({
      ".env.local": "ZITADEL_URL=http://localhost:8080\nZITADEL_PROJECT_ID=proj_local\n",
    });

    expect(await launch(dir)).toEqual({
      args: ["build", "--watch", "--define", 'ZITADEL_PROJECT_ID="proj_local"'],
    });
  });

  it("defines the id the env file holds once it changes", async () => {
    const dir = await anApp({ ".env.local": "ZITADEL_PROJECT_ID=proj_before\n" });
    await writeFile(join(dir, ".env.local"), "ZITADEL_PROJECT_ID=proj_after\n");

    expect(await launch(dir)).toEqual({
      args: ["build", "--watch", "--define", 'ZITADEL_PROJECT_ID="proj_after"'],
    });
  });

  it("prefers the environment's id, as the dev proxy does", async () => {
    const dir = await anApp({ ".env.local": "ZITADEL_PROJECT_ID=proj_local\n" });

    expect(await launch(dir, { ZITADEL_PROJECT_ID: "proj_ci" })).toEqual({
      args: ["build", "--watch", "--define", 'ZITADEL_PROJECT_ID="proj_ci"'],
    });
  });

  it("refuses to run the Angular CLI without a project id", async () => {
    const dir = await anApp();

    expect(await launch(dir)).toEqual({
      exitCode: 1,
      stderr: expect.stringContaining("ZITADEL_PROJECT_ID is not set"),
    });
  });

  it("is written only where none exists", () => {
    expect(launcherEdit(undefined)).toBe(launcherTemplate());
    expect(launcherEdit("// the developer's own\n")).toBe("// the developer's own\n");
  });
});

describe("doctor --fix on an Angular app an earlier setup wrote", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => {
        return rm(dir, { recursive: true, force: true });
      }),
    );
  });

  /** An Angular app set up with the current CLI, then put back the way an earlier setup left it. */
  async function anAppSetUpBefore(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-angular-"));
    dirs.push(dir);
    const files: Record<string, string> = {
      "package.json": `${JSON.stringify(
        {
          name: "app",
          scripts: { ng: "ng", start: "ng serve", build: "ng build", test: "ng test" },
          dependencies: { "@angular/core": "^22.2.0" },
        },
        null,
        2,
      )}\n`,
      "angular.json": `${JSON.stringify(
        {
          projects: {
            app: {
              architect: { build: { configurations: { production: {} } }, serve: { options: {} } },
            },
          },
        },
        null,
        2,
      )}\n`,
      "src/main.ts":
        'import { bootstrapApplication } from "@angular/platform-browser";\nimport { App } from "./app/app";\n\nbootstrapApplication(App);\n',
      "src/app/app.routes.ts":
        'import { Routes } from "@angular/router";\n\nexport const routes: Routes = [];\n',
    };
    for (const [path, contents] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), contents);
    }
    await new AngularPatcher().patch(ctx(), { cwd: dir, dryRun: false, force: false });
    await writeFile(join(dir, "src/app/app.ts"), LITERAL_APP_COMPONENT);
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    pkg.scripts = { ...pkg.scripts, start: "ng serve", build: "ng build", dev: "ng serve" };
    await writeFile(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    await rm(join(dir, "zitadel-ng.cjs"));
    const ng = JSON.parse(await readFile(join(dir, "angular.json"), "utf8"));
    delete ng.projects.app.architect.serve.options.define;
    delete ng.projects.app.architect.build.configurations.production.define;
    await writeFile(join(dir, "angular.json"), `${JSON.stringify(ng, null, 2)}\n`);
    return dir;
  }

  /** The doctor's verdict on each wiring of the files this change touches, in plan order. */
  async function wiring(dir: string): Promise<string[]> {
    const statuses = await new AngularPatcher().verify(ctx(), { cwd: dir });
    return statuses
      .filter((s) => {
        return ["src/app/app.ts", "package.json", "zitadel-ng.cjs", "angular.json"].includes(
          s.path,
        );
      })
      .map((s) => {
        return `${s.path} ${s.wiring} ${s.state}`;
      });
  }

  it("is reported by the doctor, and moved onto the launcher by the repair", async () => {
    const dir = await anAppSetUpBefore();

    expect(await wiring(dir)).toEqual([
      "src/app/app.ts convenience detached",
      "angular.json infrastructure applied",
      "zitadel-ng.cjs infrastructure detached",
      "package.json infrastructure detached",
      "angular.json convenience detached",
      "package.json convenience applied",
    ]);

    await new AngularPatcher().repair(ctx(), {
      cwd: dir,
      dryRun: false,
      force: false,
      missingOnly: true,
    });

    expect(await wiring(dir)).toEqual([
      "src/app/app.ts convenience applied",
      "angular.json infrastructure applied",
      "zitadel-ng.cjs infrastructure applied",
      "package.json infrastructure applied",
      "angular.json convenience applied",
      "package.json convenience applied",
    ]);
    expect(await readFile(join(dir, "src/app/app.ts"), "utf8")).toBe(appComponentTemplate(ctx()));
    expect(await readFile(join(dir, "zitadel-ng.cjs"), "utf8")).toBe(launcherTemplate());
    const ng = JSON.parse(await readFile(join(dir, "angular.json"), "utf8")).projects.app.architect;
    expect(ng.serve.options.define).toEqual({ ZITADEL_PROJECT_ID: PROJECT_ID_GUARD.message });
    expect(ng.build.configurations.production.define).toEqual({
      ZITADEL_PROJECT_ID: PROJECT_ID_GUARD.message,
    });
    expect(JSON.parse(await readFile(join(dir, "package.json"), "utf8")).scripts).toEqual({
      ng: "ng",
      start: "node zitadel-ng.cjs serve",
      build: "node zitadel-ng.cjs build",
      test: "ng test",
      dev: "node zitadel-ng.cjs serve",
    });
  });
});
