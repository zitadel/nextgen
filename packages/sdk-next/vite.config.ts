import react from "@vitejs/plugin-react";
import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

import { libraryBuild } from "../../vite.shared.mjs";

export default defineConfig({
  plugins: [
    // Next compiles a `"use client"` or `"use server"` module on its own, so each module keeps
    // its own output file (and its directive), and Rolldown reports every directive it keeps.
    libraryBuild(import.meta.dirname, { allow: ["MODULE_LEVEL_DIRECTIVE"] }),
    react(),
    dts({ tsconfigPath: "./tsconfig.lib.json", copyDtsFiles: true }),
  ],
  build: { rolldownOptions: { output: { preserveModules: true, preserveModulesRoot: "src" } } },
});
