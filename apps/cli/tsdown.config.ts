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

export default defineConfig({
  entry: ["src/bin/zitadel.ts"],
  outDir: "dist",
  format: ["esm"],
  dts: false,
  sourcemap: true,
  clean: true,
  shims: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  define: {
    __ZITADEL_CLI_VERSION__: JSON.stringify(pkg.version),
  },
  target: false,
});
