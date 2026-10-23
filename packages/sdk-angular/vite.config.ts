import angular from "@analogjs/vite-plugin-angular";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import { libraryBuild } from "../../vite.shared.mjs";

// Analog's plugin drives Angular's own compiler, so it writes the partial-Ivy
// JavaScript and the matching `.d.ts` (with Angular's `ɵɵComponentDeclaration`
// metadata) itself; there is no separate `ngc` step or `unplugin-dts`. The build
// does not type-check templates (Analog leaves that off, and switching it on
// crashes on TypeScript 6), so `typecheck` runs `ngc --noEmit` under
// `strictTemplates` instead.
export default defineConfig({
  plugins: [
    libraryBuild(import.meta.dirname),
    angular({
      jit: false,
      tsconfig: fileURLToPath(new URL("./tsconfig.lib.json", import.meta.url)),
    }),
  ],
});
