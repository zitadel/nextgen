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
  // The commit the cloud deploys, which every analytics event reports as
  // website_version (app/analytics.ts); empty outside Vercel.
  env: { WEBSITE_VERSION: process.env.VERCEL_GIT_COMMIT_SHA ?? "" },
  // Keeps `next dev` from writing Next's agent rules into AGENTS.md when an
  // AI coding agent runs it (apps/AGENTS.md).
  agentRules: false,
};

export default config;
