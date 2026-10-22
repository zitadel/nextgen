import react from "@vitejs/plugin-react";
import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

import { libraryBuild } from "../../vite.shared.mjs";

export default defineConfig({
  plugins: [
    // Rolldown keeps the `"use client"` of `react.tsx` on its entry file and reports it.
    libraryBuild(import.meta.dirname, { allow: ["MODULE_LEVEL_DIRECTIVE"] }),
    react(),
    dts({ tsconfigPath: "./tsconfig.lib.json" }),
  ],
});
