// @ts-nocheck
// TS 6 currently crashes while checking the Waku/Fumapress Vite plugin chain.
import tailwindcss from "@tailwindcss/vite";
import mdx from "fumadocs-mdx/vite";
import press from "fumapress/vite";
import { defineConfig } from "waku/config";

export default defineConfig({
  vite: {
    cacheDir: "../../node_modules/.vite/apps/docs",
    plugins: [...press(), ...mdx(), tailwindcss()],
  },
});
