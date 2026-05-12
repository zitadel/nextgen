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
 * `docs/design/flowengine/visualizer.html` so the docs URL referenced from
 * `docs/design/flowengine/README.md` resolves through the dev server.
 */

const repoRoot = resolve(import.meta.dirname, "..", "..");
const visualizerHtml = resolve(
  repoRoot,
  "docs/design/flowengine/visualizer.html",
);

/**
 * Serve the docs visualizer through Vite as a plain static file. The
 * visualizer is self-contained (it loads `liquidjs` from esm.sh via an
 * import map) and does not import the components package, so no string
 * substitution or `/@fs/` rewriting is needed.
 */
function visualizerAlias(): Plugin {
  return {
    name: "zitadel:serve-visualizer",
    configureServer(server) {
      server.middlewares.use("/visualizer.html", async (req, res, next) => {
        if (req.method && req.method !== "GET" && req.method !== "HEAD") {
          return next();
        }
        try {
          const html = await readFile(visualizerHtml, "utf8");
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
