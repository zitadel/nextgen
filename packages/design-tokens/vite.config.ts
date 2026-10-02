import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Library build for @zitadel/design-tokens. Vite bundles the single typed
// entry (src/generated/tokens.ts) and vite-plugin-dts emits its declarations,
// so Vite owns all of dist — matching the SDK packages. The CSS surfaces ship
// straight from src/generated via the package exports and are never bundled.
export default defineConfig({
  build: {
    lib: {
      entry: "./src/generated/tokens.ts",
      formats: ["es"],
      fileName: "tokens",
    },
  },
  plugins: [
    dts({
      tsconfigPath: "tsconfig.lib.json",
      include: ["src/generated/tokens.ts"],
      entryRoot: "src/generated",
    }),
  ],
});
