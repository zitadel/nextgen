import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

import { baseTest, edgeProject, edgeSpecs } from "@zitadel/vitest-config";

// auth.ts imports "server-only", whose default entry throws to keep server
// modules out of client bundles. Tests run outside both module graphs, so
// substitute an empty module (see the stub for details).
const alias = {
  "server-only": fileURLToPath(new URL("./src/__tests__/stubs/server-only.ts", import.meta.url)),
};

/**
 * Next compiles a `"use client"` module, in the server graph the edge entries
 * run in, into references that throw when called there, and runs the real module
 * only in the client graph. Vitest has one graph, where the real module would
 * run against the server build of React, which has no `createContext`. This
 * does what Next does: it swaps each such module for its throwing references.
 */
function clientReferences(): Plugin {
  return {
    name: "client-references",
    enforce: "post",
    transform(code) {
      if (!/^\s*["']use client["']/.test(code)) return null;
      // The build lists its exports in one trailing `export{a,b as c}`, on the last
      // line of minified output.
      const names = [...code.matchAll(/\bexport\s*\{([^}]*)\}/g)].flatMap((match) =>
        (match[1] ?? "")
          .split(",")
          .map((name) =>
            name
              .trim()
              .split(/\s+as\s+/)
              .pop(),
          )
          .filter((name): name is string => !!name),
      );
      return names
        .map(
          (name) =>
            `export function ${name}() { throw new Error("${name} is a client reference and cannot be called on the server"); }`,
        )
        .join("\n");
    },
  };
}

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/sdk-next",
    projects: [
      {
        cacheDir: ".vitest/jsdom",
        // The browser build of @lit/react binds element properties; its Node
        // build only collects them for server rendering.
        resolve: { alias, conditions: ["browser"] },
        test: {
          name: "jsdom",
          globals: true,
          environment: "jsdom",
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: [edgeSpecs],
        },
      },
      // Runs the edge specs in the edge-runtime VM; see edgeProject in vitest.shared.mjs.
      edgeProject({
        // Next's edge bundler adds both.
        conditions: ["react-server", "edge-light"],
        plugins: [clientReferences()],
      }),
    ],
  },
});
