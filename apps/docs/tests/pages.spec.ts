import { type APIRequestContext, expect, test } from "@playwright/test";

import {
  escapeHtml,
  failures,
  type IndexedPage,
  mapLimit,
  markdownUrl,
  parseIndex,
  siteLinks,
} from "./support";

/**
 * Every page, through the index agents read first: /docs/llms.txt lists each
 * page with its site-relative URL (skills/zitadel/SKILL.md tells agents to
 * prefix it with the docs' origin). The suite keeps no list of its own, so a
 * page is covered the moment it is written.
 */

// Requests in flight at once over the page list.
const concurrency = 8;

async function indexedPages(request: APIRequestContext): Promise<IndexedPage[]> {
  const response = await request.get("/docs/llms.txt");
  expect(response.status()).toBe(200);
  const pages = parseIndex(await response.text());
  expect(pages.length).toBeGreaterThan(0);
  return pages;
}

test("the index lists every section, each page once, under /docs", async ({ request }) => {
  const response = await request.get("/docs/llms.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");
  const index = await response.text();

  // The sections skills/zitadel/SKILL.md describes to agents.
  for (const section of ["Get started", "Concepts", "CLI", "SDKs", "API reference"]) {
    expect(index, `section ${section}`).toMatch(new RegExp(`^- ${section}$`, "m"));
  }

  const pages = parseIndex(index);
  const urls = pages.map((page) => page.url);
  expect(urls).toEqual(
    expect.arrayContaining(["/docs", "/docs/get-started/quickstart", "/docs/cli"]),
  );
  expect(
    urls.filter((url) => url !== "/docs" && !url.startsWith("/docs/")),
    "index entries outside /docs",
  ).toEqual([]);
  expect(new Set(urls).size).toBe(urls.length);
});

test("every page answers as HTML, titled", async ({ request }) => {
  test.setTimeout(120_000);
  const pages = await indexedPages(request);

  const results = await mapLimit(pages, concurrency, async ({ title, url }) => {
    const response = await request.get(url);
    const type = response.headers()["content-type"] ?? "";
    if (response.status() !== 200) return `${url}: ${response.status()}`;
    if (!type.startsWith("text/html")) return `${url}: ${type}`;
    const html = await response.text();
    const expected = `<title>${escapeHtml(title)}</title>`;
    if (!html.includes(expected)) return `${url}: no ${expected}`;
    return null;
  });
  expect(failures(results), "pages whose HTML is wrong").toEqual([]);
});

test("every page has a Markdown twin whose links resolve", async ({ request }) => {
  test.setTimeout(120_000);
  const pages = await indexedPages(request);
  const listed = new Set(pages.map((page) => page.url));
  const links = new Set<string>();

  const results = await mapLimit(pages, concurrency, async ({ title, url }) => {
    const twin = markdownUrl(url);
    const response = await request.get(twin);
    const type = response.headers()["content-type"] ?? "";
    if (response.status() !== 200) return `${twin}: ${response.status()}`;
    if (!type.startsWith("text/markdown")) return `${twin}: ${type}`;
    const markdown = await response.text();
    for (const link of siteLinks(markdown)) links.add(link);
    const heading = `# ${title} (${url})`;
    if (!markdown.startsWith(heading)) return `${twin}: does not open with "${heading}"`;
    return null;
  });
  expect(failures(results), "pages whose Markdown twin is wrong").toEqual([]);

  // A link to a page the index does not list is a page that moved, or a typo.
  const unlisted = [...links].filter((link) => !listed.has(link));
  const dead = await mapLimit(unlisted, concurrency, async (link) =>
    (await request.get(link)).status() === 200 ? null : link,
  );
  expect(failures(dead), "links to pages that do not answer").toEqual([]);
});

test("every page negotiates Markdown through Accept", async ({ request }) => {
  test.setTimeout(120_000);
  const pages = await indexedPages(request);

  // The same URL as the HTML; proxy.ts rewrites it to the Markdown twin. (On
  // the cloud the response carries no `Vary: Accept`: Vercel caches each
  // representation under the path the rewrite chose and strips the header.)
  const results = await mapLimit(pages, concurrency, async ({ title, url }) => {
    const response = await request.get(url, { headers: { Accept: "text/markdown" } });
    const type = response.headers()["content-type"] ?? "";
    if (response.status() !== 200) return `${url}: ${response.status()}`;
    if (!type.startsWith("text/markdown")) return `${url}: ${type}`;
    const heading = `# ${title} (${url})`;
    if (!(await response.text()).startsWith(heading))
      return `${url}: does not open with "${heading}"`;
    return null;
  });
  expect(failures(results), "pages that do not negotiate Markdown").toEqual([]);
});

test("a page that does not exist is a 404, as HTML and as Markdown", async ({ request }) => {
  expect((await request.get("/docs/no-such-page")).status()).toBe(404);
  expect((await request.get("/docs/no-such-page.md")).status()).toBe(404);
  const negotiated = await request.get("/docs/no-such-page", {
    headers: { Accept: "text/markdown" },
  });
  expect(negotiated.status()).toBe(404);
});

test("llms-full.txt carries every page but the API operations", async ({ request }) => {
  const pages = await indexedPages(request);
  const response = await request.get("/docs/llms-full.txt");
  expect(response.status()).toBe(200);
  const full = await response.text();

  // An operation page is /docs/reference/api/<tag>/<operation>; the tag's own
  // page, one level up, is content like any other. With the operations and
  // the schemas they reference the file was twenty times this size (#1685).
  const operation = /^\/docs\/reference\/api\/[^/]+\/[^/]+$/;
  const missing = pages
    .filter((page) => !operation.test(page.url))
    .filter((page) => !full.includes(`# ${page.title} (${page.url})`))
    .map((page) => page.url);
  expect(missing, "pages missing from llms-full.txt").toEqual([]);
  const operations = pages.filter((page) => operation.test(page.url));
  expect(operations.length).toBeGreaterThan(0);
  expect(
    operations.filter((page) => full.includes(`(${page.url})`)).map((page) => page.url),
    "API operations in llms-full.txt",
  ).toEqual([]);
  expect(full.length).toBeLessThan(500_000);
});

test("scripts and styles load from /docs/_next/", async ({ request }) => {
  const html = await (await request.get("/docs/cli")).text();
  // With Skew Protection on, the cloud appends `?dpl=<deployment>` to each URL.
  const assets = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map(
        ([, asset = ""]) => asset,
      ),
    ),
  ];
  const next = assets.filter((asset) => asset.includes("/_next/"));
  expect(next.length).toBeGreaterThan(0);
  // On the cloud only /docs reaches this service (assetPrefix in next.config.mjs).
  expect(
    next.filter((asset) => !asset.startsWith("/docs/_next/")),
    "assets outside /docs/_next/",
  ).toEqual([]);

  const results = await mapLimit(next, concurrency, async (asset) => {
    const response = await request.get(asset);
    const type = response.headers()["content-type"] ?? "";
    const cache = response.headers()["cache-control"] ?? "";
    if (response.status() !== 200) return `${asset}: ${response.status()}`;
    if (!type.includes(asset.includes(".css") ? "text/css" : "javascript"))
      return `${asset}: ${type}`;
    if (!cache.includes("immutable")) return `${asset}: cache-control "${cache}"`;
    return null;
  });
  expect(failures(results), "assets that do not load as built").toEqual([]);
});
