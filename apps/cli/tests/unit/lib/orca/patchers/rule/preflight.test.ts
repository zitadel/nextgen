import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AngularPatcher } from "../../../../../../src/lib/orca/patchers/rule/angular";
import { NextPatcher } from "../../../../../../src/lib/orca/patchers/rule/next";
import { QwikPatcher } from "../../../../../../src/lib/orca/patchers/rule/qwik";
import { ReactPatcher } from "../../../../../../src/lib/orca/patchers/rule/react";
import { SolidPatcher } from "../../../../../../src/lib/orca/patchers/rule/solid";
import { SveltePatcher } from "../../../../../../src/lib/orca/patchers/rule/svelte";
import { VuePatcher } from "../../../../../../src/lib/orca/patchers/rule/vue";
import type { PatchContext, Patcher } from "../../../../../../src/lib/orca/patchers/types";

/**
 * The file-writer stops only on a file at exactly a path setup writes. These
 * cases pin the conflicts each patcher finds at other paths, before anything
 * is written, so setup's dry-run patch reports them before it creates a
 * project.
 */
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A project directory holding `files`, keyed by their path from the root. */
async function project(files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-preflight-"));
  dirs.push(cwd);
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), contents);
  }
  return cwd;
}

function ctxFor(id: string, appDir: string, versionMajor?: number): PatchContext {
  return {
    framework: {
      id,
      appDir,
      devPort: 3000,
      url: "http://localhost:3000",
      ...(versionMajor === undefined ? {} : { versionMajor }),
    },
    rendererId: "react",
    project: {
      id: "proj-1",
      project_secret: "sk_proj_full",
      preview_secret: "sk_proj_preview",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
    },
    issuer: "http://localhost:3000",
    server: "https://api.zitadel.cloud",
    cliVersion: "0.1.0-alpha.0",
  };
}

function indexHtml(entry: string): string {
  return `<!doctype html>\n<html>\n  <body>\n    <script type="module" src="/${entry}"></script>\n  </body>\n</html>\n`;
}

/** The files every Vite template carries besides its entry. */
const VITE_APP = {
  "package.json": JSON.stringify({ name: "demo", dependencies: { vite: "^7.0.0" } }),
  "vite.config.ts": "export default {}\n",
};

/**
 * Per SPA patcher: an existing app whose entry mounts its own root at another
 * path, and the entry of the template setup scaffolds (its demo root removed,
 * so the entry imports the managed root before it exists).
 */
const SPA_CASES: Array<{
  name: string;
  patcher: Patcher;
  ctx: PatchContext;
  root: string;
  existingApp: Record<string, string>;
  foreignRoot: string;
  template: Record<string, string>;
}> = [
  {
    name: "React's JavaScript template",
    patcher: new ReactPatcher(),
    ctx: ctxFor("react", "src"),
    root: "src/App.tsx",
    existingApp: {
      "index.html": indexHtml("src/main.jsx"),
      "src/main.jsx":
        "import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\n" +
        "import App from './App.jsx'\n\n" +
        "createRoot(document.getElementById('root')).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n)\n",
      "src/App.jsx": "export default function App() {\n  return <h1>Mine</h1>\n}\n",
    },
    foreignRoot: "src/App.jsx",
    template: {
      ...VITE_APP,
      "index.html": indexHtml("src/main.tsx"),
      "src/main.tsx":
        "import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\n" +
        "import App from './App.tsx'\n\n" +
        "createRoot(document.getElementById('root')!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n)\n",
    },
  },
  {
    name: "Solid's JavaScript template",
    patcher: new SolidPatcher(),
    ctx: ctxFor("solid", "src"),
    root: "src/App.tsx",
    existingApp: {
      "index.html": indexHtml("src/index.jsx"),
      "src/index.jsx":
        "/* @refresh reload */\nimport { render } from 'solid-js/web'\nimport App from './App.jsx'\n\n" +
        "render(() => <App />, document.getElementById('root'))\n",
      "src/App.jsx": "export default function App() {\n  return <h1>Mine</h1>\n}\n",
    },
    foreignRoot: "src/App.jsx",
    template: {
      ...VITE_APP,
      "index.html": indexHtml("src/index.tsx"),
      "src/index.tsx":
        "/* @refresh reload */\nimport { render } from 'solid-js/web'\nimport App from './App.tsx'\n\n" +
        "render(() => <App />, document.getElementById('root')!)\n",
    },
  },
  {
    name: "a Vue app with its root in another file",
    patcher: new VuePatcher(),
    ctx: ctxFor("vue", "src"),
    root: "src/App.vue",
    existingApp: {
      "index.html": indexHtml("src/main.js"),
      "src/main.js":
        "import { createApp } from 'vue'\nimport Shell from './Shell.vue'\n\ncreateApp(Shell).mount('#app')\n",
      "src/Shell.vue": "<template><h1>Mine</h1></template>\n",
    },
    foreignRoot: "src/Shell.vue",
    template: {
      ...VITE_APP,
      "index.html": indexHtml("src/main.ts"),
      "src/main.ts":
        "import { createApp } from 'vue'\nimport './style.css'\nimport App from './App.vue'\n\n" +
        "createApp(App).mount('#app')\n",
    },
  },
  {
    name: "a Svelte 4 app with its root in another file",
    patcher: new SveltePatcher(),
    ctx: ctxFor("svelte", "src"),
    root: "src/App.svelte",
    existingApp: {
      "index.html": indexHtml("src/main.js"),
      "src/main.js":
        "import Shell from './Shell.svelte'\n\n" +
        "const app = new Shell({ target: document.getElementById('app') })\n\nexport default app\n",
      "src/Shell.svelte": "<h1>Mine</h1>\n",
    },
    foreignRoot: "src/Shell.svelte",
    template: {
      ...VITE_APP,
      "index.html": indexHtml("src/main.ts"),
      "src/main.ts":
        "import { mount } from 'svelte'\nimport './app.css'\nimport App from './App.svelte'\n\n" +
        "const app = mount(App, {\n  target: document.getElementById('app')!,\n})\n\nexport default app\n",
    },
  },
  {
    name: "Qwik's JavaScript template",
    patcher: new QwikPatcher(),
    ctx: ctxFor("qwik", "src"),
    root: "src/app.tsx",
    existingApp: {
      "index.html": indexHtml("src/main.jsx"),
      "src/main.jsx":
        "import '@qwik.dev/core/qwikloader.js'\n\nimport { render } from '@qwik.dev/core'\n" +
        "import { App } from './app.jsx'\n\nrender(document.getElementById('app'), <App />)\n",
      "src/app.jsx": "export const App = () => <h1>Mine</h1>\n",
    },
    foreignRoot: "src/app.jsx",
    template: {
      ...VITE_APP,
      "index.html": indexHtml("src/main.tsx"),
      "src/main.tsx":
        "import '@qwik.dev/core/qwikloader.js'\n\nimport { render } from '@qwik.dev/core'\n" +
        "import { App } from './app.tsx'\n\n" +
        "render(document.getElementById('app') as HTMLElement, <App />)\n",
    },
  },
  {
    name: "an Angular 17–19 app",
    patcher: new AngularPatcher(),
    ctx: ctxFor("angular", "src/app"),
    root: "src/app/app.ts",
    existingApp: {
      "angular.json": JSON.stringify({
        projects: { demo: { architect: { build: { options: { browser: "src/main.ts" } } } } },
      }),
      "src/main.ts":
        "import { bootstrapApplication } from '@angular/platform-browser';\n" +
        "import { appConfig } from './app/app.config';\n" +
        "import { AppComponent } from './app/app.component';\n\n" +
        "bootstrapApplication(AppComponent, appConfig)\n  .catch((err) => console.error(err));\n",
      "src/app/app.config.ts": "export const appConfig = { providers: [] };\n",
      "src/app/app.component.ts": "export class AppComponent {}\n",
    },
    foreignRoot: "src/app/app.component.ts",
    template: {
      "package.json": JSON.stringify({
        name: "demo",
        dependencies: { "@angular/core": "^20.0.0" },
      }),
      "angular.json": JSON.stringify({
        defaultProject: "demo",
        projects: {
          demo: {
            architect: {
              build: { options: { browser: "src/main.ts" } },
              serve: { options: {} },
            },
          },
        },
      }),
      "src/main.ts":
        "import { bootstrapApplication } from '@angular/platform-browser';\n" +
        "import { appConfig } from './app/app.config';\nimport { App } from './app/app';\n\n" +
        "bootstrapApplication(App, appConfig)\n  .catch((err) => console.error(err));\n",
      "src/app/app.config.ts": "export const appConfig = { providers: [] };\n",
      "src/app/app.routes.ts":
        "import { Routes } from '@angular/router';\n\nexport const routes: Routes = [];\n",
    },
  },
];

describe("SPA patchers' root component", () => {
  it.each(SPA_CASES.map((c) => [c.name, c] as const))(
    "refuses %s, even with --force, and writes nothing",
    async (_name, { patcher, ctx, root, existingApp, foreignRoot }) => {
      const cwd = await project(existingApp);

      await expect(patcher.patch(ctx, { cwd, dryRun: false, force: true })).rejects.toMatchObject({
        code: "E_CONFLICT",
        details: { path: foreignRoot, writes: root },
      });
      expect(existsSync(join(cwd, root))).toBe(false);
      expect(existsSync(join(cwd, "zitadel.json"))).toBe(false);
    },
  );

  it.each(SPA_CASES.map((c) => [c.patcher.constructor.name, c] as const))(
    "%s patches the entry of the template setup scaffolds",
    async (_name, { patcher, ctx, root, template }) => {
      const cwd = await project(template);

      const result = await patcher.patch(ctx, { cwd, dryRun: true, force: false });

      expect(result.filesWritten).toContain(join(cwd, root));
    },
  );
});

describe("NextPatcher's request boundary", () => {
  const NEXT_APP = {
    "package.json": JSON.stringify({ name: "demo", dependencies: { next: "^16.0.0" } }),
    "app/layout.tsx": "export default function Layout() {}\n",
  };
  const MIDDLEWARE = "export function middleware() {}\n";

  it("refuses a middleware.ts beside the proxy.ts Next 16 gets, even with --force", async () => {
    const cwd = await project({ ...NEXT_APP, "middleware.ts": MIDDLEWARE });

    await expect(
      new NextPatcher().patch(ctxFor("next", "app", 16), { cwd, dryRun: false, force: true }),
    ).rejects.toMatchObject({
      code: "E_CONFLICT",
      message: "Next.js 16 won't start with both middleware.ts and the proxy.ts setup writes",
      details: { path: "middleware.ts", writes: "proxy.ts" },
    });
    expect(existsSync(join(cwd, "proxy.ts"))).toBe(false);
  });

  // `next dev` reads the boundary from the project root and from src/ alike.
  it("refuses a boundary in src/ for an app at the project root", async () => {
    const cwd = await project({ ...NEXT_APP, "src/middleware.js": MIDDLEWARE });

    await expect(
      new NextPatcher().patch(ctxFor("next", "app", 16), { cwd, dryRun: true, force: false }),
    ).rejects.toMatchObject({ details: { path: "src/middleware.js", writes: "proxy.ts" } });
  });

  it("refuses a second middleware file under another extension", async () => {
    const cwd = await project({ ...NEXT_APP, "middleware.js": MIDDLEWARE });

    await expect(
      new NextPatcher().patch(ctxFor("next", "app", 15), { cwd, dryRun: true, force: false }),
    ).rejects.toMatchObject({
      code: "E_CONFLICT",
      message: "Next.js runs one middleware file, and this app already has middleware.js",
    });
  });

  it("refuses a proxy.ts when it cannot tell the Next version", async () => {
    const cwd = await project({ ...NEXT_APP, "src/proxy.ts": "export function proxy() {}\n" });

    await expect(
      new NextPatcher().patch(ctxFor("next", "src/app"), { cwd, dryRun: true, force: false }),
    ).rejects.toMatchObject({
      code: "E_CONFLICT",
      hint: expect.stringContaining(
        'Pin next to the version range the app runs, such as "^16.0.0"',
      ),
      details: { path: "src/proxy.ts", writes: "src/middleware.ts" },
    });
  });

  // Before Next 16, proxy.ts was no convention: it is just a file of the app's.
  it("leaves a proxy.ts alone on Next 15", async () => {
    const cwd = await project({ ...NEXT_APP, "proxy.ts": "export const target = 1;\n" });

    const result = await new NextPatcher().patch(ctxFor("next", "app", 15), {
      cwd,
      dryRun: true,
      force: false,
    });

    expect(result.filesWritten).toContain(join(cwd, "middleware.ts"));
  });

  // At the path setup writes, the file-writer decides: --force replaces it.
  it("leaves a boundary at the path setup writes to the file-writer", async () => {
    const cwd = await project({ ...NEXT_APP, "proxy.ts": "export function proxy() {}\n" });

    const result = await new NextPatcher().patch(ctxFor("next", "app", 16), {
      cwd,
      dryRun: true,
      force: true,
    });

    expect(result.files).toContainEqual({
      path: join(cwd, "proxy.ts"),
      kind: "file",
      action: "update",
    });
  });
});
