import { fileURLToPath } from "node:url";

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

const policy = (directives) => directives.join("; ");
const enforcedPolicy = [
  "object-src 'none'",
  "base-uri 'self'",
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
  // Adds each prerendered page's report-only policy, with its inline
  // scripts' hashes, once the build has written the page.
  adapterPath: fileURLToPath(new URL("./csp-adapter.mjs", import.meta.url)),
  async headers() {
    // Every response, the pages' and the other routes'. On the cloud's host
    // the docs share an origin with the API and the console, so a script
    // that runs here acts with a signed-in user's session.
    return [
      {
        source: "/:path*",
        headers: [
          // Enforced: nothing frames the docs, embeds a plugin or moves their
          // base URL. Each prerendered page also carries a report-only policy
          // that allows its inline scripts by hash (csp-adapter.mjs).
          { key: "Content-Security-Policy", value: policy(enforcedPolicy) },
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
