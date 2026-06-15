import { svelte } from '@sveltejs/vite-plugin-svelte';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // Use Svelte's browser build so client-side `mount()` works under jsdom.
    conditions: ['browser'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Never run the svelte-package build output (a staged copy of the spec).
    exclude: [...configDefaults.exclude, '.svelte-kit/**'],
  },
});
