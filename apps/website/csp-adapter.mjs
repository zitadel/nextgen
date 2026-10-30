// The website's enforced Content-Security-Policy, which allows each page's
// inline scripts by hash so the pages stay prerendered, the changelog's too:
// a Next.js build adapter (next.config.ts' adapterPath) adds it to every
// prerendered page's header rules once the build has written the page. It wraps
// the platform's adapter, Vercel's on the cloud, which the build names in
// NEXT_ADAPTER_PATH. apps/docs/csp-adapter.mjs is a copy with the docs'
// policy: change both below the policy.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Enforced for a page whose inline scripts hash to
 * `hashes`. On the cloud's host the website shares an origin with the API and
 * the console, so a script that runs here acts with a signed-in user's session;
 * the policy also limits where a script, an image or a request may come
 * from or go to, so what a script could carry off.
 */
function pagePolicy(hashes) {
  return [
    "default-src 'self'",
    // Vercel builds its toolbar's loader into every deployment's bundle,
    // which fetches the toolbar from vercel.live.
    `script-src 'self' https://vercel.live${hashes.map((hash) => ` 'sha256-${hash}'`).join("")}`,
    // React's and the login previews' style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    // Vercel's analytics on the same origin.
    "connect-src 'self'",
    // The toolbar's page, which makes its own requests under vercel.live's
    // policy.
    "frame-src https://vercel.live",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-uri /csp-report",
  ].join("; ");
}

/** The SHA-256 of each inline script in `html`, base64, once each. */
function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const [, attributes, body] of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi,
  )) {
    if (!body || /\bsrc\s*=/i.test(attributes)) continue;
    hashes.add(createHash("sha256").update(body).digest("base64"));
  }
  return [...hashes];
}

const platformPath = process.env.NEXT_ADAPTER_PATH;
const platform = platformPath
  ? await import(
      platformPath.startsWith("/") ? pathToFileURL(platformPath).href : platformPath
    ).then((module) => module.default ?? module)
  : undefined;

/** @type {import("next").NextAdapter} */
export default {
  name: platform ? `csp hashes + ${platform.name}` : "csp hashes",
  async modifyConfig(config, ctx) {
    return platform?.modifyConfig ? platform.modifyConfig(config, ctx) : config;
  },
  async onBuildComplete(ctx) {
    // Header rules replace earlier rules with the same name. A policy in
    // initialHeaders/.meta instead appends to next.config's fallback, which
    // would leave script-src 'none' enforcing alongside every page's hashes.
    const manifestPath = join(ctx.distDir, "routes-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    let pages = 0;
    for (const { pathname, fallback } of ctx.outputs.prerenders) {
      if (!fallback?.filePath?.endsWith(".html")) continue;
      const policy = pagePolicy(inlineScriptHashes(await readFile(fallback.filePath, "utf8")));
      // Escape literal path characters for Next's path-to-regexp source and
      // the adapter's already-compiled matcher; permit the trailing slash.
      const source = pathname.replace(/[\\()*+?:{}]/g, "\\$&");
      const regex = `^${pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`;
      const headers = { "Content-Security-Policy": policy };
      // The platform's header rules, after next.config's fallback.
      ctx.routing.beforeMiddleware.push({ source, sourceRegex: regex, headers });
      // The same rules for next start, which reads this build manifest.
      manifest.headers.push({
        source,
        regex,
        headers: Object.entries(headers).map(([key, value]) => ({ key, value })),
      });
      pages++;
    }
    await writeFile(manifestPath, JSON.stringify(manifest));
    console.log(`csp-adapter: allowed the inline scripts of ${pages} prerendered pages by hash`);
    await platform?.onBuildComplete?.(ctx);
  },
};
