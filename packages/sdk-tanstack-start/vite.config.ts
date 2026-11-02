import react from "@vitejs/plugin-react";
import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

import { failOnDiagnostics, libraryBuild } from "@zitadel/vite";

export default defineConfig({
  plugins: [
    libraryBuild(import.meta.dirname),
    react(),
    dts({ tsconfigPath: "./tsconfig.lib.json", afterDiagnostic: failOnDiagnostics }),
  ],
});
