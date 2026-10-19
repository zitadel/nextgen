import type { NextConfig } from "next";

// The share of page loads that send Speed Insights (app/layout.tsx), from 0
// (none) to 1 (every one, the default when unset); set per environment on
// Vercel. A value outside 0–1 fails the build rather than reaching the
// browser unnoticed.
const sampleRate = process.env.WEBSITE_SPEED_INSIGHTS_SAMPLE_RATE;
if (sampleRate && !(Number(sampleRate) >= 0 && Number(sampleRate) <= 1)) {
  throw new Error(
    `WEBSITE_SPEED_INSIGHTS_SAMPLE_RATE must be a number from 0 to 1, got "${sampleRate}".`,
  );
}

// The cloud routes /, /_next/* and the favicons (/favicon.ico, /favicons/*)
// to this app (repo-root vercel.json), so it needs no base path or asset
// prefix: its other assets already load from /_next/.
const config: NextConfig = {
  reactStrictMode: true,
  // Keeps `next dev` from writing Next's agent rules into AGENTS.md when an
  // AI coding agent runs it (apps/AGENTS.md).
  agentRules: false,
  turbopack: {
    // Turbopack reads no size from an AVIF and warns on every build, but
    // emits the file unchanged: the page takes only its URL (page.tsx).
    ignoreIssue: [{ path: "**/*.avif", title: "AVIF image not supported" }],
  },
};

export default config;
