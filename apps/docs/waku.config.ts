// @ts-nocheck
// TS 6 currently crashes while checking the Waku/Fumapress Vite plugin chain.
import tailwindcss from "@tailwindcss/vite";
import mdx from "fumadocs-mdx/vite";
import press from "fumapress/vite";
import { defineConfig } from "waku/config";

// DOCS_BASE_PATH mounts the whole site under one prefix ("/docs" on the
// cloud host, where one rewrite then owns every docs path). Default: the
// site root, which is what the standalone docs deployment serves.
// scripts/vercel-base-path.mjs relocates the Vercel build output to match.
const basePath = normalizeBasePath(process.env.DOCS_BASE_PATH);

export default defineConfig({
  basePath,
  vite: {
    cacheDir: "../../node_modules/.vite/apps/docs",
    plugins: [...press(), ...mdx(), tailwindcss()],
  },
});

function normalizeBasePath(value) {
  const trimmed = (value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}
