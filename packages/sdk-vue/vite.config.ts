import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// Vue library build (render-function components, no SFCs). esbuild compiles the
// TS; vite-plugin-dts emits the `.d.ts`. Vue and workspace deps are
// externalized — the consumer provides them.
export default defineConfig({
  build: {
    lib: {
      entry: './src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [/^@zitadel\//, /^vue($|\/)/],
    },
  },
  plugins: [dts({ include: ['src'], exclude: ['src/**/*.spec.*'] })],
});
