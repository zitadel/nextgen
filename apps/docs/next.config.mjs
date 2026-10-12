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
    // The root serves nothing; locally (next dev, next start) it opens the
    // docs. On the cloud's host the root belongs to the server.
    return [{ source: "/", destination: "/docs", permanent: false }];
  },
};

export default withMDX(config);
