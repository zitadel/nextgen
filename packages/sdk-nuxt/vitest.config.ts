import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Stub Nuxt's `#imports` virtual module so vitest can resolve sources
      // that pull from it (e.g. `useRuntimeConfig`) without bootstrapping
      // Nuxt's module resolver.
      '#imports': fileURLToPath(
        new URL('./src/__tests__/stubs/nuxt-imports.ts', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
  },
});
