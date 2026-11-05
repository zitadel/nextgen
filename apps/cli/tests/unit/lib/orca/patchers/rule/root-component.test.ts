import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  angularEntry,
  assertMountsRootComponent,
  type RootMount,
  viteEntry,
} from "../../../../../../src/lib/orca/patchers/rule/root-component";

/** A React root, as the React patcher writes and mounts it. */
const REACT_ROOT: RootMount = {
  path: "src/App.tsx",
  binding: { name: "App", named: false },
  extension: true,
  calls: ["render", "hydrateRoot", "hydrate"],
  mounts: "jsx",
};

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A project directory holding `files`, keyed by their path from the root. */
async function project(files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-root-component-"));
  dirs.push(cwd);
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), contents);
  }
  return cwd;
}

/** create-vite's `main.*` for React, importing the root from `specifier`. */
function reactMain(specifier: string): string {
  return `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '${specifier}'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`;
}

describe("viteEntry", () => {
  it("reads the module script index.html loads", async () => {
    const cwd = await project({
      "index.html":
        '<!doctype html>\n<html>\n  <body>\n    <div id="root"></div>\n' +
        '    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n',
    });

    expect(await viteEntry(cwd)).toBe("src/main.tsx");
  });

  it("passes over commented-out, classic and remote scripts", async () => {
    const cwd = await project({
      "index.html":
        '<!-- <script type="module" src="/src/old.tsx"></script> -->\n' +
        '<script src="/legacy.js"></script>\n' +
        '<script type="module" src="https://cdn.example.com/x.js"></script>\n' +
        "<script src='./src/index.jsx' type=module></script>\n",
    });

    expect(await viteEntry(cwd)).toBe("src/index.jsx");
  });

  it("finds none without an index.html", async () => {
    expect(await viteEntry(await project({}))).toBeUndefined();
  });
});

describe("angularEntry", () => {
  it("reads the application builder's browser entry", async () => {
    const cwd = await project({
      "angular.json": JSON.stringify({
        projects: { demo: { architect: { build: { options: { browser: "src/boot.ts" } } } } },
      }),
    });

    expect(await angularEntry(cwd)).toBe("src/boot.ts");
  });

  it("reads the browser builder's main entry of the default project", async () => {
    const cwd = await project({
      "angular.json": JSON.stringify({
        defaultProject: "web",
        projects: {
          web: { targets: { build: { options: { main: "./apps/web/main.ts" } } } },
          admin: { architect: { build: { options: { browser: "apps/admin/main.ts" } } } },
        },
      }),
    });

    expect(await angularEntry(cwd)).toBe("apps/web/main.ts");
  });

  it("falls back to the Angular CLI's src/main.ts", async () => {
    expect(await angularEntry(await project({}))).toBe("src/main.ts");
    expect(await angularEntry(await project({ "angular.json": "{ not json" }))).toBe("src/main.ts");
  });
});

describe("assertMountsRootComponent", () => {
  it("passes an entry that mounts the root setup writes, before it exists", async () => {
    // create-vite's react-ts template once setup's scaffolder removed its demo App.tsx.
    const cwd = await project({ "src/main.tsx": reactMain("./App.tsx") });

    await expect(assertMountsRootComponent(cwd, "src/main.tsx", REACT_ROOT)).resolves.toBe(
      undefined,
    );
  });

  it("refuses an entry that mounts a root component at another path", async () => {
    // create-vite's JavaScript react template.
    const cwd = await project({
      "src/main.jsx": reactMain("./App.jsx"),
      "src/App.jsx": "export default function App() { return <h1>Mine</h1> }\n",
    });

    await expect(assertMountsRootComponent(cwd, "src/main.jsx", REACT_ROOT)).rejects.toMatchObject({
      code: "E_CONFLICT",
      message: "src/main.jsx mounts src/App.jsx, not the src/App.tsx setup writes",
      hint: expect.stringContaining('import App from "./App.tsx"'),
      details: { path: "src/App.jsx", entry: "src/main.jsx", writes: "src/App.tsx" },
    });
  });

  it("says --force can't fix it", async () => {
    const cwd = await project({
      "src/main.jsx": reactMain("./App.jsx"),
      "src/App.jsx": "export default function App() {}\n",
    });

    await expect(assertMountsRootComponent(cwd, "src/main.jsx", REACT_ROOT)).rejects.toMatchObject({
      hint: expect.stringContaining("--force can't fix this"),
    });
  });

  // Vite tries `.jsx` before `.tsx`, so the app keeps loading its own root
  // even once setup's sits beside it.
  it("resolves a specifier without an extension the way Vite does", async () => {
    const cwd = await project({
      "src/main.jsx": reactMain("./App"),
      "src/App.jsx": "export default function App() {}\n",
    });

    await expect(assertMountsRootComponent(cwd, "src/main.jsx", REACT_ROOT)).rejects.toMatchObject({
      details: { path: "src/App.jsx" },
    });
  });

  it("resolves a root-relative specifier and the @/ alias from the project root", async () => {
    const rootRelative = await project({
      "src/main.jsx": reactMain("/src/Root.jsx"),
      "src/Root.jsx": "export default function Root() {}\n",
    });
    const aliased = await project({
      "src/main.jsx": reactMain("@/shell/Root"),
      "src/shell/Root.jsx": "export default function Root() {}\n",
    });

    await expect(
      assertMountsRootComponent(rootRelative, "src/main.jsx", REACT_ROOT),
    ).rejects.toMatchObject({ details: { path: "src/Root.jsx" } });
    await expect(
      assertMountsRootComponent(aliased, "src/main.jsx", REACT_ROOT),
    ).rejects.toMatchObject({ details: { path: "src/shell/Root.jsx" } });
  });

  // A TypeScript entry may import `./App.js` and get `App.tsx`.
  it("resolves a .js specifier to the TypeScript file it names", async () => {
    const cwd = await project({ "src/main.tsx": reactMain("./App.js") });

    await expect(assertMountsRootComponent(cwd, "src/main.tsx", REACT_ROOT)).resolves.toBe(
      undefined,
    );
  });

  it("names the root among the components a render call mounts side by side", async () => {
    const cwd = await project({
      "src/main.jsx": `import { createRoot } from "react-dom/client";
import { Toaster } from "./components/Toaster.jsx";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<><Toaster /><App /></>);
`,
      "src/components/Toaster.jsx": "export function Toaster() {}\n",
      "src/App.jsx": "export default function App() {}\n",
    });

    await expect(assertMountsRootComponent(cwd, "src/main.jsx", REACT_ROOT)).rejects.toMatchObject({
      details: { path: "src/App.jsx" },
    });
  });

  // Providers wrap the app; the component inside them is the root.
  it("looks past providers of the app's own", async () => {
    const cwd = await project({
      "src/main.tsx": `import { createRoot } from "react-dom/client";
import { ThemeProvider } from "./theme";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
);
`,
      "src/theme.tsx": "export function ThemeProvider() {}\n",
    });

    await expect(assertMountsRootComponent(cwd, "src/main.tsx", REACT_ROOT)).resolves.toBe(
      undefined,
    );
  });

  it("lets setup go ahead where it cannot see the root", async () => {
    // A router from a package, a root defined in the entry itself, an alias it
    // does not know, an entry it cannot parse, and no entry at all.
    const cases = {
      "src/router.jsx": `import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
createRoot(el).render(<RouterProvider router={router} />);
`,
      "src/inline.jsx": `import { createRoot } from "react-dom/client";
function Root() { return null; }
createRoot(el).render(<Root />);
`,
      "src/alias.jsx": `import { createRoot } from "react-dom/client";
import App from "#root/App";
createRoot(el).render(<App />);
`,
      "src/broken.jsx": "import App from './App.jsx'\ncreateRoot(el).render(<App",
    };
    const cwd = await project({ ...cases, "src/App.jsx": "export default function App() {}\n" });

    for (const entry of [...Object.keys(cases), "src/missing.jsx", undefined]) {
      await expect(assertMountsRootComponent(cwd, entry, REACT_ROOT)).resolves.toBe(undefined);
    }
  });

  it("reads a root passed as the mount call's first argument, and only that one", async () => {
    const angular: RootMount = {
      path: "src/app/app.ts",
      binding: { name: "App", named: true },
      extension: false,
      calls: ["bootstrapApplication", "bootstrapModule"],
      mounts: "argument",
    };
    // Angular 17–19 generate app.component.ts; app.config.ts is the second
    // argument, not a root.
    const cwd = await project({
      "src/main.ts": `import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
`,
      "src/app/app.config.ts": "export const appConfig = {};\n",
      "src/app/app.component.ts": "export class AppComponent {}\n",
    });

    await expect(assertMountsRootComponent(cwd, "src/main.ts", angular)).rejects.toMatchObject({
      message: "src/main.ts mounts src/app/app.component.ts, not the src/app/app.ts setup writes",
      hint: expect.stringContaining('import { App } from "./app/app"'),
    });
  });

  it("reads a root the entry constructs, when its file has the root's extension", async () => {
    const svelte: RootMount = {
      path: "src/App.svelte",
      binding: { name: "App", named: false },
      extension: true,
      calls: ["mount", "hydrate"],
      mounts: "argument",
      constructs: ".svelte",
    };
    const constructed = await project({
      "src/main.js": `import Shell from './Shell.svelte'
import { Router } from './router'

new Router()
const app = new Shell({ target: document.getElementById('app') })
export default app
`,
      "src/Shell.svelte": "<h1>Mine</h1>\n",
      "src/router.js": "export class Router {}\n",
    });
    const unrelated = await project({
      "src/main.js": "import { Router } from './router'\nnew Router()\n",
      "src/router.js": "export class Router {}\n",
    });

    await expect(
      assertMountsRootComponent(constructed, "src/main.js", svelte),
    ).rejects.toMatchObject({ details: { path: "src/Shell.svelte" } });
    await expect(assertMountsRootComponent(unrelated, "src/main.js", svelte)).resolves.toBe(
      undefined,
    );
  });
});
