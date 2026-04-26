import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { defineConfig } from "tsup";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8")) as { version: string };

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
});
