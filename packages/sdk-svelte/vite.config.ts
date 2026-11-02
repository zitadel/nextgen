import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

import { libraryBuild } from "@zitadel/vite";
import { svelteTypes } from "./vite-plugin-svelte-types.ts";

export default defineConfig({
  plugins: [
    libraryBuild(import.meta.dirname, { src: "src/lib" }),
    svelte(),
    svelteTypes({ input: "src/lib", tsconfig: "tsconfig.lib.json" }),
  ],
});
