import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

import { svelteTypes } from './vite-plugin-svelte-types';

// Svelte library build. vite-plugin-svelte compiles the components to JS;
// svelteTypes() emits the `.d.ts` via svelte2tsx (the engine svelte-package
// wraps) so a single `vite build` produces both. Svelte and workspace deps are
// externalized — the consumer provides them.
export default defineConfig({
  build: {
    lib: {
      entry: './src/lib/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [/^@zitadel\//, /^svelte($|\/)/],
    },
  },
  plugins: [svelte(), svelteTypes({ input: 'src/lib' })],
});
