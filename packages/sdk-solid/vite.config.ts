import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import solid from 'vite-plugin-solid';

// Solid library build. vite-plugin-solid compiles the JSX; vite-plugin-dts
// emits the `.d.ts`. solid-js and workspace deps are externalized — the
// consumer provides them.
export default defineConfig({
  build: {
    lib: {
      entry: './src/index.tsx',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [/^solid-js($|\/)/, /^@zitadel\//],
    },
  },
  plugins: [solid(), dts({ include: ['src'], exclude: ['src/**/*.spec.*'] })],
});
