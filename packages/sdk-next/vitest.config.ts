import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // auth.ts imports "server-only", whose default entry throws to keep
      // server modules out of client bundles. Tests run outside both module
      // graphs — substitute an empty module (see the stub for details).
      "server-only": fileURLToPath(
        new URL("./src/__tests__/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
