import { defineConfig } from "tsdown";

/**
 * Library build for `@zitadel-nextgen/ui-react`.
 *
 * Paired React components compile to ESM. Styles ship via shared-component-styles
 * plus a `styles.css` barrel; consumers import the barrel (or pick up side
 * imports when bundling from source). Design-tokens CSS is layered in by the
 * host app (e.g. `apps/console`).
 */
export default defineConfig({
  entry: { index: "src/index.ts" },
  outDir: "dist",
  format: ["esm"],
  tsconfig: "tsconfig.lib.json",
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: [
    "react",
    "react-dom",
    /^react\//,
    /^react-dom\//,
    "lucide-react",
    /^lucide-react\//,
    "@zitadel-nextgen/design-tokens",
    /^@zitadel-nextgen\/design-tokens\//,
  ],
});
