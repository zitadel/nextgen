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
 * Unbundled, multi-entry build for oclif: each command compiles to its own
 * `dist/commands/<name>.mjs` so oclif can discover and lazy-load them at
 * runtime. `@oclif/*` (core + plugins) stays external — resolved from
 * node_modules at runtime, never bundled — which is what lets the plugin
 * system work.
 */
export default defineConfig({
  entry: {
    "commands/setup": "src/commands/setup/index.ts",
    "commands/apply": "src/commands/apply.ts",
    "commands/plan": "src/commands/plan.ts",
    "commands/doctor": "src/commands/doctor/index.ts",
    "commands/logs": "src/commands/logs.ts",
    "commands/reset": "src/commands/reset.ts",
    "commands/start": "src/commands/start.ts",
    "commands/stop": "src/commands/stop.ts",
    "commands/eject": "src/commands/eject.ts",
    "commands/status": "src/commands/status.ts",
    "commands/schemas/list": "src/commands/schemas/list.ts",
    "commands/branding/eject": "src/commands/branding/eject.ts",
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
