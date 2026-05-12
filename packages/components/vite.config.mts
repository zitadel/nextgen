import { resolve } from "node:path";

import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { defineConfig } from "vite";

/**
 * Dev playground only. The library itself is built by `tsdown` (see
 * `tsdown.config.ts`) and tests run via `vitest.config.ts`.
 *
 * `vite dev` serves `dev/index.html` (atom playground + `<zitadel-login>`
 * demo). The flow-engine visualizer at `docs/design/flowengine/visualizer.html`
 * is a self-contained static page — open it directly in a browser, no dev
 * server required.
 */

export default defineConfig({
  root: resolve(import.meta.dirname, "dev"),
  cacheDir: "../../node_modules/.vite/packages/components",
  plugins: [nxViteTsPaths()],
});
