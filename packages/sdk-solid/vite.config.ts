import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

import { libraryBuild } from "../../vite.shared.mjs";

export default defineConfig({
  plugins: [
    libraryBuild(import.meta.dirname),
    solid(),
    dts({ tsconfigPath: "./tsconfig.lib.json" }),
  ],
});
