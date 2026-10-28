import nuxtModule from "@mridang/vite-plugin-nuxt-module";
import { defineConfig } from "vite";

import { minify } from "@zitadel/vite";

export default defineConfig({
  plugins: [
    nuxtModule({
      // The exports map names `.js` files (a `"type": "module"` package) and `.d.ts` declarations.
      extension: ".js",
      entry: { index: "src/index.ts", server: "src/server.ts" },
      // The other SDKs ship a source map beside each module too.
      sourcemap: true,
    }),
  ],
  // Minified like the other SDKs. The runtime directory is left as is: Nuxt compiles it inside the app.
  build: { minify: true, rolldownOptions: { output: { minify } } },
});
