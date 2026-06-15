import angular from '@analogjs/vite-plugin-angular';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Angular library build via Vite (no ng-packagr). vite-plugin-angular drives
// Angular's own compiler (NgtscProgram) to emit partial-Ivy JS; `ngc` emits the
// matching partial-Ivy `.d.ts` as a second step (see the package.json build
// script) because TypeScript-only emitters cannot produce Angular's `ɵfac`/`ɵcmp`
// metadata. Angular, RxJS and workspace deps are externalized — the consumer
// provides them. The plugin reads `tsconfig.lib.prod.json` (JS only, no
// declarations) to avoid the declaration-only empty-bundle trap.
export default defineConfig({
  plugins: [
    angular({
      jit: false,
      tsconfig: fileURLToPath(
        new URL('./tsconfig.lib.prod.json', import.meta.url),
      ),
    }),
  ],
  build: {
    lib: {
      entry: 'src/public-api.ts',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [/^@angular\//, /^@zitadel\//, /^rxjs($|\/)/, 'tslib'],
    },
  },
});
