import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Everything the docs serve lives under /docs, their scripts and styles
  // too: on the cloud's host every other path belongs to the server
  // (repo-root vercel.json).
  assetPrefix: "/docs",
  async redirects() {
    // The root serves nothing; on the docs' own deployment it opens the docs.
    return [{ source: "/", destination: "/docs", permanent: false }];
  },
};

export default withMDX(config);
