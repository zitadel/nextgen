import { docsRoute } from "@/lib/shared";

// The docs name their pages root-relative: a Markdown link (`](/docs/…`), a
// <Card>'s `href="/docs/…"`, and the `# Title (/docs/…)` heading each page's
// Markdown opens with. They resolve on the docs' own pages, but not in a
// downloaded document or an agent's context, where no page's URL is left to
// resolve them against.
const docsReference = new RegExp(String.raw`(\]\(|href="|^# .* \()${docsRoute}(?=[/#)"])`, "gm");

/**
 * Makes `text`'s references to docs pages absolute on the origin `request`
 * arrived on, so production, preview and local docs each link to themselves.
 * Code spans keep their paths: they name a path, not a page to open.
 */
export function absoluteDocsLinks(text: string, request: Request): string {
  const { origin } = new URL(request.url);
  return text.replace(docsReference, `$1${origin}${docsRoute}`);
}

/**
 * The cache headers of a response that `absoluteDocsLinks` made: a function
 * runs per request, so the CDN keeps its answer, as it kept the prerendered
 * one. A year, which is what Next.js sends for a prerendered route: the body
 * changes only with the deployment, and Vercel's cache key holds the
 * deployment and the host, so a cached answer never names another origin.
 */
export const cdnCached = { "CDN-Cache-Control": "public, max-age=31536000" };
