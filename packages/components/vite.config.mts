import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { defineConfig, type Plugin } from "vite";

/**
 * Dev playground only. The library itself is built by `tsdown` (see
 * `tsdown.config.ts`) and tests run via `vitest.config.ts`.
 *
 * `vite dev` serves `dev/index.html` (atom playground + `<zitadel-login>` demo)
 * and additionally aliases `/visualizer.html` to the static visualizer at
 * `docs/design/flowengine/visualizer.html`. Both routes import the components
 * directly from `src/`, so there is no separate build step.
 */

const repoRoot = resolve(import.meta.dirname, "..", "..");
const componentsSrc = resolve(import.meta.dirname, "src", "index.ts");
const visualizerHtml = resolve(
  repoRoot,
  "docs/design/flowengine/visualizer.html",
);

/**
 * Serve the docs visualizer through Vite so its dynamic `import()` resolves
 * the components package via Vite's TS pipeline (no build, hot reload).
 *
 * The HTML contains the placeholder `__COMPONENTS_BUNDLE__` which is replaced
 * with a `/@fs/...` URL pointing at `packages/components/src/index.ts`. Vite
 * already allows `/@fs/<repo-root>` access via `server.fs.allow`.
 */
function visualizerAlias(): Plugin {
  const componentsBundleUrl = `/@fs${componentsSrc}`;
  return {
    name: "zitadel:serve-visualizer",
    configureServer(server) {
      server.middlewares.use("/visualizer.html", async (req, res, next) => {
        if (req.method && req.method !== "GET" && req.method !== "HEAD") {
          return next();
        }
        try {
          const raw = await readFile(visualizerHtml, "utf8");
          const html = raw.replace(/__COMPONENTS_BUNDLE__/g, componentsBundleUrl);
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(html);
        } catch (error) {
          next(error as Error);
        }
      });
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname, "dev"),
  cacheDir: "../../node_modules/.vite/packages/components",
  plugins: [nxViteTsPaths(), visualizerAlias()],
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
});
