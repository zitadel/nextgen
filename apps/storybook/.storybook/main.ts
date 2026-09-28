import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { apiMockPublicDir } from "@zitadel/api-mock/public-dir";
import type { StorybookConfig } from "@storybook/web-components-vite";

// Dev-only Vite plugin that loads the orchestrator's `.liquid` templates as raw
// strings. It is build tooling, not part of `@zitadel/components`' published API
// (the package ships only `dist/`), so it is imported by source path here —
// mirroring how the package's own `vitest.config.ts` imports it — rather than
// through a package export that would resolve to an unpublished `.ts` file.
import { liquidRaw } from "../../../packages/components/vite-liquid-plugin.js";

import { optimizeDepsExclude, optimizeDepsInclude } from "./optimize-deps.js";

const here = dirname(fileURLToPath(import.meta.url));
const packagesDir = resolve(here, "../../../packages");
// Source dirs of the workspace packages whose edits should hot-reload in the
// dev server. pnpm symlinks these through `node_modules`, so Vite never adds
// them to its watcher (see the watch plugin below for the full explanation).
const watchedSrcDirs = [resolve(packagesDir, "components/src")];

// Token bumped on every watched-source edit, served at `RELOAD_TOKEN_PATH`. The
// preview iframe polls it and does a real `location.reload()` on change.
// Storybook turns Vite's `full-reload` into a soft re-render that keeps the
// document (and the custom-element registry) alive, so a `<zl-*>` shadow-CSS or
// atom-logic edit would never show. A real reload resets the registry so the
// freshly transformed source takes effect. (The dedicated Lit HMR plugin,
// vite-plugin-web-components-hmr, is unmaintained and pins `vite >=2`, so it is
// not viable on this Vite 8 toolchain.)
const RELOAD_TOKEN_PATH = "/__zitadel_reload_token";
const reloadPollerScript = `<script>
(function () {
  var last = null;
  setInterval(function () {
    fetch("${RELOAD_TOKEN_PATH}", { cache: "no-store" })
      .then(function (r) { return r.text(); })
      .then(function (token) {
        if (last === null) { last = token; return; }
        if (token !== last) { last = token; location.reload(); }
      })
      .catch(function () {});
  }, 500);
})();
</script>`;

/**
 * The workbench for the login surface. The framework is the web-components
 * (Vite) builder, which is the whole story now that the atoms are Lit-only —
 * the `<zl-*>` atoms and the `<zitadel-login>` orchestrator get native stories.
 * See `apps/storybook/README.md`.
 *
 * `@zitadel/api-mock`'s public dir is served statically so MSW finds
 * `mockServiceWorker.js` at `/mockServiceWorker.js` (the orchestrator stories
 * mock the Flow API through `msw-storybook-addon`).
 */
const config: StorybookConfig = {
  framework: "@storybook/web-components-vite",
  stories: ["../src/**/*.stories.ts"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-vitest"],
  staticDirs: [{ from: apiMockPublicDir, to: "/" }],
  // Inject the workspace-source reload poller into the preview iframe.
  previewHead: (head) => `${head}${reloadPollerScript}`,
  async viteFinal(viteConfig) {
    viteConfig.optimizeDeps = {
      ...viteConfig.optimizeDeps,
      exclude: [...(viteConfig.optimizeDeps?.exclude ?? []), ...optimizeDepsExclude],
      include: [...(viteConfig.optimizeDeps?.include ?? []), ...optimizeDepsInclude],
    };
    // Resolve workspace `@zitadel/*` packages that publish a `@zitadel/source`
    // export condition to their TS source, so they run from source in the dev
    // server instead of their built `dist`.
    viteConfig.resolve ??= {};
    viteConfig.resolve.conditions = ["@zitadel/source", ...(viteConfig.resolve.conditions ?? [])];
    // `@zitadel/components` intentionally does NOT publish a `@zitadel/source`
    // condition: its source imports raw `*.css?inline` and `*.liquid` assets, and
    // exposing it repo-wide would force every TS consumer (the SDKs, `login-ui`)
    // to typecheck those un-declared modules and conflict with their composite
    // `dist` project references. Alias it to source here instead — a Storybook-
    // bundler-only override that keeps the Lit shadow CSS (`?inline`) and atom
    // logic hot, without changing how the rest of the workspace resolves it.
    const componentsSrc = resolve(packagesDir, "components/src");
    const componentsAlias = [
      { find: /^@zitadel\/components\/atoms$/, replacement: resolve(componentsSrc, "atoms/index.ts") },
      { find: /^@zitadel\/components\/manifests$/, replacement: resolve(componentsSrc, "manifests.ts") },
      { find: /^@zitadel\/components\/tokens$/, replacement: resolve(componentsSrc, "tokens/index.ts") },
      { find: /^@zitadel\/components\/orchestrator$/, replacement: resolve(componentsSrc, "orchestrator/index.ts") },
      { find: /^@zitadel\/components$/, replacement: resolve(componentsSrc, "index.ts") },
    ];
    const existingAlias = viteConfig.resolve.alias;
    const normalizedAlias = Array.isArray(existingAlias)
      ? existingAlias
      : Object.entries(existingAlias ?? {}).map(([find, replacement]) => ({ find, replacement }));
    viteConfig.resolve.alias = [...componentsAlias, ...normalizedAlias];
    viteConfig.plugins ??= [];
    // The orchestrator imports its `.liquid` templates as raw strings. Running
    // `@zitadel/components` from source means Vite (not the prebuilt dist) has to
    // load them, so register the same loader the package's own build uses.
    viteConfig.plugins.push(liquidRaw());
    // pnpm symlinks these packages through `node_modules` and they live outside
    // the Storybook app root, so Vite never adds them to its file watcher — edits
    // go undetected. Add the real source dirs, re-read the changed module from
    // disk, and bump the reload token the preview poller watches.
    viteConfig.plugins.push({
      name: "zitadel-watch-workspace-src",
      configureServer(server) {
        let reloadToken = String(Date.now());
        server.middlewares.use((req, res, next) => {
          if (req.url !== RELOAD_TOKEN_PATH) return next();
          res.setHeader("Content-Type", "text/plain");
          res.setHeader("Cache-Control", "no-store");
          res.end(reloadToken);
        });
        for (const dir of watchedSrcDirs) server.watcher.add(dir);
        const onChange = (file: string) => {
          const watched = watchedSrcDirs.some((dir) => file.startsWith(dir));
          if (!watched) return;
          if (!(file.endsWith(".css") || file.endsWith(".ts") || file.endsWith(".tsx"))) return;
          server.moduleGraph.onFileChange(file);
          reloadToken = String(Date.now());
        };
        server.watcher.on("change", onChange);
        server.watcher.on("add", onChange);
      },
    });
    return viteConfig;
  },
};

export default config;
