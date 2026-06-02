import { resolve } from "node:path";

import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { apiMockPublicDir } from "@zitadel-nextgen/api-mock/public-dir";
import { defineConfig } from "vite";
import { hmrPlugin, presets } from "vite-plugin-web-components-hmr";

import { workspaceStylesFullReload } from "./vite/lit-dev-hmr";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const packageRoot = resolve(import.meta.dirname, ".");

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
  root: resolve(packageRoot, "dev"),
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [workspaceRoot] },
    watch: {
      ignored: ["**/.git/**", "**/node_modules/**", "**/dist/**"],
    },
  },
  publicDir: apiMockPublicDir,
  cacheDir: "../../node_modules/.vite/packages/components",
  plugins: [
    nxViteTsPaths(),
    // Lit atoms only — dev/pages/*.ts is plain TS (innerHTML); wc-hmr breaks its HMR.
    hmrPlugin({
      include: [resolve(packageRoot, "src/**/*.ts")],
      presets: [presets.lit],
    }),
    workspaceStylesFullReload(),
  ],
  resolve: { conditions: ["@zitadel/source"] },
  optimizeDeps: {
    exclude: [
      "@zitadel/components",
      "@zitadel/shared-component-styles",
      "@zitadel/design-tokens",
      "@zitadel/api-client",
      "@zitadel-nextgen/api-mock",
    ],
  },
});
