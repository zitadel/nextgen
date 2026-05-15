import { resolve } from "node:path";

import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { apiMockPublicDir } from "@zitadel-nextgen/api-mock/public-dir";
import { defineConfig } from "vite";

/**
 * Dev playground only. The library itself is built by `tsdown` (see
 * `tsdown.config.ts`) and tests run via `vitest.config.ts`.
 *
 * `vite dev` serves `dev/index.html` (atom playground + `<zitadel-login>`
 * demo). The flow-engine visualizer at `docs/design/flowengine/visualizer.html`
 * is a self-contained static page — open it directly in a browser, no dev
 * server required.
 *
 * `publicDir` is pointed at `@zitadel-nextgen/api-mock`'s public folder so
 * the canonical MSW worker shim (`mockServiceWorker.js`) is served from
 * `/mockServiceWorker.js`. Keeping the worker file inside the api-mock
 * package means MSW's postinstall hook only manages one copy in the
 * workspace.
 */

export default defineConfig({
  root: resolve(import.meta.dirname, "dev"),
  publicDir: apiMockPublicDir,
  cacheDir: "../../node_modules/.vite/packages/components",
  plugins: [nxViteTsPaths()],
  // Workspace packages (`@zitadel-nextgen/api`, etc.) ship a conditional
  // `exports` map: `@zitadel-nextgen/source` resolves to `.ts` for hot
  // workspace iteration, the default `import` condition resolves to
  // pre-built `.mjs` for external production consumers. Set the source
  // condition here so Vite dev / vitest skip the rebuild step.
  resolve: { conditions: ["@zitadel-nextgen/source"] },
});
