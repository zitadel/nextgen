import { type Entry, entryPath } from "./changelog/entries";
import { UPDATED } from "./choose-version/features";
import { origin } from "./links";

// What search engines read on the cloud's host: /robots.txt and
// /sitemap.xml, served by their routes from these. The robots file speaks
// for the whole host, the other services' paths too (repo-root vercel.json).

/**
 * The robots file. Production lets crawlers read the pages and the docs and
 * keeps them off the API, the console and the cloud's functions, which
 * have nothing to index; every other deployment (a pull request's preview)
 * keeps them off everything, so no preview competes with production.
 */
export function robotsTxt(production: boolean): string {
  if (!production) return "User-agent: *\nDisallow: /\n";
  return [
    "User-agent: *",
    "Disallow: /api/",
    "Disallow: /console/",
    "Disallow: /cloud/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

/**
 * The website's pages, with absolute URLs on the production host: the front
 * page, the changelog and each entry's page, and the guide to choosing a
 * version. An entry's page last changed when it landed.
 */
export function sitemapXml(entries: Pick<Entry, "slug" | "date">[]): string {
  const day = (date: string) => new Date(date).toISOString().slice(0, 10);
  const pages: { path: string; lastmod?: string }[] = [
    { path: "/" },
    { path: "/changelog", lastmod: entries[0] && day(entries[0].date) },
    { path: "/choose-version", lastmod: UPDATED },
    ...entries.map((entry) => ({ path: entryPath(entry.slug), lastmod: day(entry.date) })),
  ];
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pages.map(({ path, lastmod }) =>
      [
        "  <url>",
        `    <loc>${origin}${path}</loc>`,
        ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
        "  </url>",
      ].join("\n"),
    ),
    "</urlset>",
    "",
  ].join("\n");
}
