import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "tsdown";
import { z } from "zod";

const pkgSchema = z.object({
  version: z.templateLiteral([z.coerce.number(), ".", z.coerce.number(), ".", z.coerce.number()]),
});

const pkg = pkgSchema.parse(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf8")),
);

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
  define: {
    __ZITADEL_CLI_VERSION__: JSON.stringify(pkg.version),
  },
  target: false,
});
