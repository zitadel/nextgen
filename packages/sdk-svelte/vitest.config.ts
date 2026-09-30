import { svelte } from "@sveltejs/vite-plugin-svelte";
import { configDefaults, defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // Use Svelte's browser build so client-side `mount()` works under jsdom.
    conditions: ["browser"],
  },
  test: {
    ...baseTest,
    name: "@zitadel/sdk-svelte",
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
    // Never run the svelte-package build output (a staged copy of the spec).
    exclude: [...configDefaults.exclude, ".svelte-kit/**"],
  },
});
