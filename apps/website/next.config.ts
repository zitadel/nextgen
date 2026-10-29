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

const dev = process.env.NODE_ENV === "development";
const policy = (directives: string[]) => directives.join("; ");
const enforcedPolicy = [
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "report-uri /csp-report",
];
// Reported on, not enforced. Inline scripts run unchecked ('unsafe-inline'):
// a nonce would take a render per request, and the pages are prerendered.
// What it limits is where a script, an image or a request may come from or
// go to, so what a script could carry off.
const reportOnlyPolicy = [
  "default-src 'self'",
  // React rebuilds server error stacks with eval in development only.
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  // React's and the login previews' style attributes.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  // Vercel's analytics on the same origin; next dev's reload socket.
  `connect-src 'self'${dev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "report-uri /csp-report",
];

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
  async headers() {
    // Every response, the pages' and the other routes'. On the cloud's host
    // the website shares an origin with the API and the console, so a script
    // that runs here acts with a signed-in user's session.
    return [
      {
        source: "/:path*",
        headers: [
          // Enforced: nothing frames the website, embeds a plugin or moves its
          // base URL.
          { key: "Content-Security-Policy", value: policy(enforcedPolicy) },
          { key: "Content-Security-Policy-Report-Only", value: policy(reportOnlyPolicy) },
        ],
      },
    ];
  },
};

export default config;
