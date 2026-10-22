import nuxtModule from "vite-plugin-nuxt-module";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    nuxtModule({
      // The exports map names `.js` files (a `"type": "module"` package) and `.d.ts` declarations.
      extension: ".js",
      entry: { index: "src/index.ts", server: "src/server.ts" },
    }),
  ],
});
