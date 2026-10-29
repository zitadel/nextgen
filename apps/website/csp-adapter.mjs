// The website's report-only Content-Security-Policy, which allows each page's
// inline scripts by hash so the pages stay prerendered, the changelog's too:
// a Next.js build adapter (next.config.ts' adapterPath) adds it to every
// prerendered page's headers once the build has written the page. It wraps
// the platform's adapter, Vercel's on the cloud, which the build names in
// NEXT_ADAPTER_PATH. apps/docs/csp-adapter.mjs is a copy with the docs'
// policy: change both below the policy.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/**
 * Reported on, not enforced, for a page whose inline scripts hash to
 * `hashes`. On the cloud's host the website shares an origin with the API and
 * the console, so a script that runs here acts with a signed-in user's session;
 * the policy also limits where a script, an image or a request may come
 * from or go to, so what a script could carry off.
 */
function reportOnlyPolicy(hashes) {
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
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!body || /\bsrc=/.test(attributes)) continue;
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
    let pages = 0;
    for (const { fallback } of ctx.outputs.prerenders) {
      if (!fallback?.filePath?.endsWith(".html")) continue;
      const policy = reportOnlyPolicy(
        inlineScriptHashes(await readFile(fallback.filePath, "utf8")),
      );
      // What the platform serves the page with.
      fallback.initialHeaders = {
        ...fallback.initialHeaders,
        "content-security-policy-report-only": policy,
      };
      // What next start serves it with.
      const metaPath = fallback.filePath.replace(/\.html$/, ".meta");
      const meta = JSON.parse(await readFile(metaPath, "utf8").catch(() => "null"));
      if (meta) {
        meta.headers = { ...meta.headers, "content-security-policy-report-only": policy };
        await writeFile(metaPath, JSON.stringify(meta));
      }
      pages++;
    }
    console.log(`csp-adapter: allowed the inline scripts of ${pages} prerendered pages by hash`);
    await platform?.onBuildComplete?.(ctx);
  },
};
