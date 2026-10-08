import type { NextConfig } from "next";

// Scaffold of the public website, served as the `website` service of the
// cloud deployment (repo-root vercel.json). The real site (zitadel/new-website)
// brings its CSP, redirects and content on top of this.
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
