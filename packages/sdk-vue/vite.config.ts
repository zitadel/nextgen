import vue from "@vitejs/plugin-vue";
import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

import { libraryBuild } from "../../vite.shared.mjs";

export default defineConfig({
  plugins: [libraryBuild(import.meta.dirname), vue(), dts({ tsconfigPath: "./tsconfig.lib.json" })],
});
