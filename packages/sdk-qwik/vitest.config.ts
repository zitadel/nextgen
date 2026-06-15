import { qwikVite } from '@builder.io/qwik/optimizer';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [qwikVite()],
  test: {
    // Qwik's `createDOM()` provides its own DOM; the jsdom environment conflicts
    // with it (`node.isAncestor is not a function`), so run under node.
    environment: 'node',
    globals: true,
  },
});
