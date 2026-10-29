import { createNextStory } from "@fumadocs/story/next";
import { createMDX } from "fumadocs-mdx/next";

import moved from "./lib/moved.json" with { type: "json" };

const withMDX = createMDX();
// The live examples (components/examples): the plugin reads each
// *.story.tsx's component props and generates the example's controls.
const withStory = createNextStory();

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

const dev = process.env.NODE_ENV === "development";
const policy = (directives) => directives.join("; ");
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
  // Code blocks colour their tokens with style attributes (Shiki).
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  // Search, the feedback route, the API reference's calls to the API on the
  // same origin, Vercel's analytics; next dev's reload socket.
  `connect-src 'self'${dev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "report-uri /csp-report",
];

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
  // Loaded by Node rather than bundled, so `apiMockPublicDir` finds the
  // service worker the package ships beside itself
  // (app/docs/mock-service-worker.js).
  serverExternalPackages: ["@zitadel/api-mock"],
  async headers() {
    // Every response, the pages' and the other routes'. On the cloud's host
    // the docs share an origin with the API and the console, so a script
    // that runs here acts with a signed-in user's session.
    return [
      {
        source: "/:path*",
        headers: [
          // Enforced: nothing frames the docs, embeds a plugin or moves their
          // base URL.
          { key: "Content-Security-Policy", value: policy(enforcedPolicy) },
          { key: "Content-Security-Policy-Report-Only", value: policy(reportOnlyPolicy) },
        ],
      },
    ];
  },
  async redirects() {
    // The root serves nothing; locally (next dev, next start) it opens the
    // docs. On the cloud's host the root is the website's start page.
    return [
      { source: "/", destination: "/docs", permanent: false },
      // A page that moved, and its Markdown twin, such as the Qwik Router
      // SDK's page from before the SDK took Qwik 2's name for its router
      // (formerly Qwik City), or the CLI section's guides, now under Guides.
      ...Object.entries(moved).flatMap(([source, destination]) => [
        { source, destination, permanent: true },
        { source: `${source}.md`, destination: `${destination}.md`, permanent: true },
      ]),
    ];
  },
};

export default withStory(withMDX(config));
