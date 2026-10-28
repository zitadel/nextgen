import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

import { failOnDiagnostics, libraryBuild } from "@zitadel/vite";

export default defineConfig({
  plugins: [
    libraryBuild(import.meta.dirname),
    dts({ tsconfigPath: "./tsconfig.lib.json", afterDiagnostic: failOnDiagnostics }),
  ],
});
