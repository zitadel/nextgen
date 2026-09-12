import { defineConfig } from "tsdown";

/**
 * Telemetry channel stamped into the bundle (replaces `__ZITADEL_TELEMETRY_CHANNEL__`).
 * Defaults to `development` so every contributor/CI build routes to the dev
 * Mixpanel project; only the release pipeline sets
 * `ZITADEL_TELEMETRY_BUILD_CHANNEL=production` (see `cli:build-release`) so the
 * published CLI routes to production. Releases bump the version, so this build's
 * input hash changes and moon rebuilds rather than serving a dev-stamped cache.
 */
const telemetryChannel = (process.env.ZITADEL_TELEMETRY_BUILD_CHANNEL || "development")
  .trim()
  .toLowerCase();

/**
 * Single-entry build for oclif's explicit command strategy: `src/index.ts`
 * exports the `COMMANDS` table (hand-written commands plus the ones built
 * from the resource registry) and oclif loads `dist/index.mjs` at runtime.
 * `@oclif/*` (core + plugins) stays external — resolved from node_modules at
 * runtime, never bundled — which is what lets the plugin system work.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  outDir: "dist",
  format: ["esm"],
  dts: false,
  sourcemap: true,
  clean: true,
  shims: true,
  external: [/^@oclif\//],
  target: false,
  define: {
    __ZITADEL_TELEMETRY_CHANNEL__: JSON.stringify(telemetryChannel),
  },
});
