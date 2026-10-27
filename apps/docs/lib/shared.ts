import { createGetUrl } from "fumadocs-core/source";

export const appName = "Zitadel Preview Docs";
// Every route the docs serve lives under /docs: on the cloud's host every
// other path belongs to another service (repo-root vercel.json).
export const docsRoute = "/docs";
export const docsImageRoute = "/docs/og";
// Only reached through proxy.ts, which rewrites a page's Markdown URL here.
export const docsContentRoute = "/llms.mdx/docs";

export const gitConfig = {
  user: "zitadel",
  repo: "nextgen",
  branch: "main",
};

const getDocsUrl = createGetUrl(docsRoute);

/** A page as Markdown: its URL plus .md; the overview's is /docs/index.md. */
export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs];
  if (segments.length === 0) {
    segments.push("index.md");
  } else {
    segments[segments.length - 1] += ".md";
  }

  return { segments, url: getDocsUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, "image.png"];

  return { segments, url: getImageUrl(segments, page.locale) };
}
