import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// React library build. esbuild compiles the TSX; vite-plugin-dts emits the
// `.d.ts`. React and workspace deps are externalized — the consumer provides
// them.
export default defineConfig({
  build: {
    lib: {
      entry: './src/index.tsx',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        /^@zitadel\//,
        /^react($|\/)/,
        /^react-dom($|\/)/,
        /^@lit\/react($|\/)/,
      ],
    },
  },
  plugins: [dts({ include: ['src'], exclude: ['src/**/*.spec.*'] })],
});
