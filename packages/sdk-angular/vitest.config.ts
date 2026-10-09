import angular from "@analogjs/vite-plugin-angular";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

// The analog plugin compiles the Angular components so specs can render them
// through TestBed; it reads `tsconfig.spec.json` (the lib config plus the specs)
// so the spec files are part of its TypeScript program. `src/test-setup.ts`
// boots the Angular testing environment.
export default defineConfig({
  cacheDir: ".vitest",
  plugins: [
    angular({
      tsconfig: fileURLToPath(new URL("./tsconfig.spec.json", import.meta.url)),
    }),
  ],
  test: {
    ...baseTest,
    name: "@zitadel/sdk-angular",
    environment: "jsdom",
    // The analog plugin defaults the pool to `vmThreads`, whose jsdom context
    // lacks web-stream globals (`TransformStream`) that MSW needs to serve the
    // mock Flow API. The suite is zoneless, so Vitest's default `forks` pool
    // runs it as-is.
    pool: "forks",
    setupFiles: ["src/test-setup.ts"],
  },
});
