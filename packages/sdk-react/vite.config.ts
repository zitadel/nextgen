import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// React library build. esbuild compiles the TSX; vite-plugin-dts emits the
// `.d.ts`. React and workspace deps are externalized — the consumer provides
// them.
export default defineConfig({
  build: {
    lib: {
      entry: "./src/index.tsx",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [/^@zitadel\//, /^react($|\/)/, /^react-dom($|\/)/, /^@lit\/react($|\/)/],
      // Every export is a hook-using client component. Without the directive a
      // Next App Router server component importing it crashes in React's
      // `react-server` build; the bundler drops source-level directives, so it
      // goes on as a banner.
      output: { banner: '"use client";' },
    },
  },
  plugins: [
    dts({ tsconfigPath: "./tsconfig.lib.json", include: ["src"], exclude: ["src/**/*.spec.*"] }),
  ],
});
