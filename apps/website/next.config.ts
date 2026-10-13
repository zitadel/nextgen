import type { NextConfig } from "next";

// The cloud routes only / and /_next/* to this app (repo-root vercel.json),
// so it needs no base path or asset prefix: its assets already load from
// /_next/.
const config: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    // Turbopack reads no size from an AVIF and warns on every build, but
    // emits the file unchanged: the page takes only its URL (page.tsx).
    ignoreIssue: [{ path: "**/*.avif", title: "AVIF image not supported" }],
  },
};

export default config;
