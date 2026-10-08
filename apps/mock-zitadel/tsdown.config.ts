import { defineConfig } from "tsdown";

/**
 * Bundle the Vercel function into a single self-contained JS file.
 *
 * A Vercel Node function is not guaranteed to be able to resolve pnpm's
 * symlinked `node_modules` layout from the function's location, so the
 * workspace dependencies (`@zitadel/api-mock` and what it imports, from
 * their built `dist`) are inlined. Inlining every dependency (`noExternal`)
 * sidesteps both: the deployed entry (`api/index.mjs`) imports only the
 * plain JS this emits, with nothing left to resolve at runtime but Node
 * built-ins.
 */
export default defineConfig({
  entry: { app: "src/app.ts" },
  outDir: "dist",
  tsconfig: "tsconfig.app.json",
  format: ["esm"],
  failOnWarn: true,
  platform: "node",
  dts: true,
  // Bundle every dependency into the single self-contained output.
  // `onlyBundle: false` silences tsdown's "consider deps.onlyBundle" hint —
  // bundling everything is exactly the intent here.
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
});
