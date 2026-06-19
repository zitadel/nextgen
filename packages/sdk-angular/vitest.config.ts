import angular from "@analogjs/vite-plugin-angular";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The analog plugin compiles the Angular components so specs can render them
// through TestBed; it reads `tsconfig.spec.json` (the lib config plus the specs)
// so the spec files are part of its TypeScript program. `src/test-setup.ts`
// boots the Angular testing environment.
export default defineConfig({
  plugins: [
    angular({
      tsconfig: fileURLToPath(new URL("./tsconfig.spec.json", import.meta.url)),
    }),
  ],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test-setup.ts"],
  },
});
