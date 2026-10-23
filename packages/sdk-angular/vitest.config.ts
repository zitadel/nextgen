import angular from "@analogjs/vite-plugin-angular";
import linkerPlugin from "@angular/compiler-cli/linker/babel";
import { transformAsync } from "@babel/core";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

import { baseTest, edgeProject, edgeSpecs } from "../../vitest.shared.mjs";

/**
 * Finishes the partially compiled Angular code in the edge project, the step
 * the Angular CLI performs in a consumer's build: the published package and
 * `@angular/*` ship declarations (`ɵɵngDeclare*`) that the linker turns into
 * code, because the edge VM disallows compiling them at run time.
 */
function angularLinker(): Plugin {
  return {
    name: "angular-linker",
    async transform(code, id) {
      if (!code.includes("ɵɵngDeclare")) return null;
      const result = await transformAsync(code, {
        filename: id,
        configFile: false,
        babelrc: false,
        sourceMaps: false,
        plugins: [linkerPlugin],
      });
      return result?.code ? { code: result.code, map: null } : null;
    },
  };
}

// The edge spec loads the built package, as a consumer's app does.
const alias = {
  "@zitadel/sdk-angular": fileURLToPath(new URL("./dist/public-api.js", import.meta.url)),
};

// The analog plugin compiles the Angular components so specs can render them
// through TestBed; it reads `tsconfig.spec.json` (the lib config plus the specs)
// so the spec files are part of its TypeScript program. `src/test-setup.ts`
// boots the Angular testing environment.
export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/sdk-angular",
    projects: [
      {
        cacheDir: ".vitest/jsdom",
        plugins: [
          angular({
            tsconfig: fileURLToPath(new URL("./tsconfig.spec.json", import.meta.url)),
          }),
        ],
        test: {
          name: "jsdom",
          globals: true,
          environment: "jsdom",
          // The analog plugin defaults the pool to `vmThreads`, whose jsdom context
          // lacks web-stream globals (`TransformStream`) that MSW needs to serve the
          // mock Flow API. The suite is zoneless, so Vitest's default `forks` pool
          // runs it as-is.
          pool: "forks",
          setupFiles: ["src/test-setup.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: [edgeSpecs],
        },
      },
      // Runs the edge specs in the edge-runtime VM; see edgeProject in vitest.shared.mjs.
      edgeProject({
        alias,
        plugins: [angularLinker()],
      }),
    ],
  },
});
