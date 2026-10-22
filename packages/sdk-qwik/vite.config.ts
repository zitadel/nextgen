import { qwikVite } from "@qwik.dev/core/optimizer";
import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

import { libraryBuild } from "../../vite.shared.mjs";

export default defineConfig({
  plugins: [
    libraryBuild(import.meta.dirname),
    qwikVite(),
    dts({ tsconfigPath: "./tsconfig.lib.json" }),
  ],
});
