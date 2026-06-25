import { defineConfig } from "tsdown";

/**
 * Bundle the Vercel function into a single self-contained JS file.
 *
 * `@zitadel/api-mock` is consumed as raw TypeScript source (its `exports`
 * map points at `./src/*.ts`), and a Vercel Node function is not
 * guaranteed to transpile a workspace TypeScript dependency at runtime,
 * nor to be able to resolve pnpm's symlinked `node_modules` layout from
 * the function's location. Inlining every dependency (`noExternal`)
 * sidesteps both: the deployed entry (`api/index.ts`) imports only the
 * plain JS this emits, with nothing left to resolve at runtime but Node
 * built-ins.
 */
export default defineConfig({
  entry: { app: "src/app.ts" },
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  dts: true,
  noExternal: [/.*/],
});
