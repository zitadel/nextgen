// A Next.js build adapter that gives each prerendered page a report-only
// Content-Security-Policy allowing its own inline scripts by hash, so pages
// stay static. It wraps the platform's adapter (Vercel's, which the build
// names in NEXT_ADAPTER_PATH) and hands it the outputs with the headers
// added; without one (next build locally) it only adds them.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** The policy of a page whose inline scripts hash to `hashes`. */
export function pagePolicy(hashes) {
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.map((hash) => `'sha256-${hash}'`).join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-uri /csp-report",
  ].join("; ");
}

/** The SHA-256 of each inline script in `html`, base64, once each. */
export function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=/.test(attributes) || /type="application\/(ld\+)?json"/.test(attributes)) continue;
    hashes.add(createHash("sha256").update(body).digest("base64"));
  }
  return [...hashes];
}

async function platformAdapter() {
  const path = process.env.NEXT_ADAPTER_PATH;
  if (!path) return undefined;
  const module = await import(path.startsWith("/") ? pathToFileURL(path).href : path);
  return module.default ?? module;
}

const platform = await platformAdapter();

/** @type {import("next").NextAdapter} */
export default {
  name: `csp hashes${platform ? ` + ${platform.name}` : ""}`,
  async modifyConfig(config, ctx) {
    return platform?.modifyConfig ? platform.modifyConfig(config, ctx) : config;
  },
  async onBuildComplete(ctx) {
    let pages = 0;
    for (const prerender of ctx.outputs.prerenders) {
      const file = prerender.fallback?.filePath;
      if (!file?.endsWith(".html")) continue;
      const hashes = inlineScriptHashes(await readFile(file, "utf8"));
      prerender.fallback.initialHeaders = {
        ...prerender.fallback.initialHeaders,
        "content-security-policy-report-only": pagePolicy(hashes),
      };
      pages++;
    }
    console.log(`csp-adapter: hashed the inline scripts of ${pages} prerendered pages`);
    await platform?.onBuildComplete?.(ctx);
  },
};
