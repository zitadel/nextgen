import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

import { failOnDiagnostics, libraryBuild } from "@zitadel/vite";

export default defineConfig({
  plugins: [
    libraryBuild(import.meta.dirname),
    solid(),
    dts({ tsconfigPath: "./tsconfig.lib.json", afterDiagnostic: failOnDiagnostics }),
  ],
});
