import { defineConfig } from "tsdown";

/**
 * Unbundled, multi-entry build for oclif: each command compiles to its own
 * `dist/commands/<name>.mjs` so oclif can discover and lazy-load them at
 * runtime. `@oclif/*` (core + plugins) stays external — resolved from
 * node_modules at runtime, never bundled — which is what lets the plugin
 * system work.
 */
export default defineConfig({
  entry: {
    "commands/setup": "src/commands/setup.ts",
    "commands/apply": "src/commands/apply.ts",
    "commands/plan": "src/commands/plan.ts",
    "commands/doctor": "src/commands/doctor.ts",
    "commands/eject": "src/commands/eject.ts",
    "commands/status": "src/commands/status.ts",
  },
  outDir: "dist",
  format: ["esm"],
  dts: false,
  sourcemap: true,
  clean: true,
  shims: true,
  external: [/^@oclif\//],
  target: false,
});
