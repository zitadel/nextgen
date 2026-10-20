import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

import { baseTest, edgeProject, edgeSpecs } from "../../vitest.shared.mjs";

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
      const names = [...code.matchAll(/^export function (\w+)/gm)].map((match) => match[1]);
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
        resolve: { alias },
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
        // `/middleware` is the SDK's edge entry (see the README), and the JWT
        // helpers it verifies sessions with: both must run in the edge VM. So
        // must `/client` (its edge spec), which registers the elements in the
        // browser.
        include: [
          "src/__tests__/middleware.test.ts",
          "src/__tests__/lib/jwt.test.ts",
          "src/__tests__/index.test.ts",
          "src/__tests__/server.test.ts",
        ],
        // Next's edge bundler adds both.
        conditions: ["react-server", "edge-light"],
        plugins: [clientReferences()],
      }),
    ],
  },
});
