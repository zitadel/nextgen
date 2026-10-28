import { qwikVite } from "@qwik.dev/core/optimizer";
import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

import { failOnDiagnostics, libraryBuild } from "@zitadel/vite";

// qwikVite writes an app's client manifest (`q-manifest.json`, a bundle graph) in a post hook, and
// prints a warning for every import the library keeps external. A library has no use for either.
const qwik = [qwikVite()]
  .flat()
  .map((plugin) =>
    plugin && "name" in plugin && plugin.name === "vite-plugin-qwik-post"
      ? { ...plugin, generateBundle: undefined }
      : plugin,
  );

export default defineConfig({
  build: { target: "es2020" },
  plugins: [
    // Qwik ships its libraries unminified, and its plugin turns minify off for them: the app's
    // optimizer splits the inlined QRLs out of `.qwik.mjs` and needs their closures as written.
    libraryBuild(import.meta.dirname, { minify: false }),
    qwik,
    dts({
      tsconfigPath: "./tsconfig.lib.json",
      // A test-only declaration and the test helpers are not part of the package.
      exclude: ["src/**/*.spec.*", "src/**/__tests__/**", "src/browser-commands.d.ts"],
      afterDiagnostic: failOnDiagnostics,
    }),
  ],
});
