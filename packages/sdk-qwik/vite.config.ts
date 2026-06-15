import { qwikVite } from '@builder.io/qwik/optimizer';
import { defineConfig } from 'vite';

// Qwik library build (run with `--mode lib`): the optimizer emits QRL segments
// and the `.qwik.mjs` entry the consuming app's qwikVite further processes.
// Workspace + qwik deps are externalized — the consumer provides them.
export default defineConfig({
  build: {
    target: 'es2020',
    lib: {
      entry: './src/index.tsx',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.qwik.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    rollupOptions: {
      external: [/^@zitadel\//, /^@builder\.io\//],
    },
  },
  plugins: [qwikVite()],
});
