import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

// The share of page loads that send Speed Insights (app/layout.tsx), from 0
// (none) to 1 (every one, the default when unset); set per environment on
// Vercel. A value outside 0–1 fails the build rather than reaching the
// browser unnoticed.
const sampleRate = process.env.DOCS_SPEED_INSIGHTS_SAMPLE_RATE;
if (sampleRate && !(Number(sampleRate) >= 0 && Number(sampleRate) <= 1)) {
  throw new Error(
    `DOCS_SPEED_INSIGHTS_SAMPLE_RATE must be a number from 0 to 1, got "${sampleRate}".`,
  );
}

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Keeps `next dev` from writing Next's agent rules into AGENTS.md when an
  // AI coding agent runs it (apps/AGENTS.md).
  agentRules: false,
  // Everything the docs serve lives under /docs, their scripts and styles
  // too: on the cloud's host every other path belongs to another service
  // (repo-root vercel.json), /_next/ to the website.
  assetPrefix: "/docs",
  async redirects() {
    // The root serves nothing; locally (next dev, next start) it opens the
    // docs. On the cloud's host the root is the website's start page.
    return [
      { source: "/", destination: "/docs", permanent: false },
      // The Qwik meta-framework SDK's page, from before the SDK took Qwik 2's
      // name for its router (Qwik Router, formerly Qwik City).
      { source: "/docs/sdks/qwik-city", destination: "/docs/sdks/qwik-router", permanent: true },
      {
        source: "/docs/sdks/qwik-city.md",
        destination: "/docs/sdks/qwik-router.md",
        permanent: true,
      },
    ];
  },
};

export default withMDX(config);
