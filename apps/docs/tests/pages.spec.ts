import { readFileSync } from "node:fs";

import { type APIRequestContext, expect, test } from "@playwright/test";

import {
  descriptionProblem,
  escapeHtml,
  failures,
  type IndexedPage,
  indexStrays,
  mapLimit,
  markdownUrl,
  metaContent,
  parseIndex,
  siteLinks,
} from "./support";

/**
 * Every page, through the index agents read first: /docs/llms.txt lists each
 * page with its site-relative Markdown URL (skills/zitadel/SKILL.md tells
 * agents to prefix it with the docs' origin). The suite keeps no list of its
 * own, so a page is covered the moment it is written.
 */

// Requests in flight at once over the page list.
const concurrency = 8;

// An operation page is /docs/reference/api/<tag>/<operation>; the tag's own
// page, one level up, is content like any other.
const operationPage = /^\/docs\/reference\/api\/[^/]+\/[^/]+$/;

// The CLI reference is /docs/reference/cli, and a command's page has the
// command's words as the segments after it: /docs/reference/cli/users/list.
// The reference's own pages beside the commands are no command's.
const cliReferencePage = /^\/docs\/reference\/cli(?:\/(.+))?$/;
const cliOwnPages = new Set(["telemetry", "release-notes"]);

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
  for (const section of [
    "Get started",
    "Guides",
    "Concepts",
    "SDKs",
    "CLI reference",
    "API reference",
  ]) {
    expect(index, `section ${section}`).toMatch(new RegExp(`^- ${section}$`, "m"));
  }

  const pages = parseIndex(index);
  // Each entry is the page's Markdown URL, which answers as listed.
  expect(
    pages.filter((page) => page.markdown !== markdownUrl(page.url)).map((page) => page.markdown),
    "index entries that are not a page's Markdown URL",
  ).toEqual([]);
  const urls = pages.map((page) => page.url);
  expect(urls).toEqual(
    expect.arrayContaining(["/docs", "/docs/get-started/quickstart", "/docs/reference/cli"]),
  );
  expect(
    urls.filter((url) => url !== "/docs" && !url.startsWith("/docs/")),
    "index entries outside /docs",
  ).toEqual([]);
  expect(new Set(urls).size).toBe(urls.length);

  // An entry is one line: an API page's OpenAPI description, of several
  // paragraphs, is not its description (lib/description.ts).
  expect(indexStrays(index), "lines of the index where the page tree puts none").toEqual([]);
});

test("every page answers as HTML, titled, described and in its size", async ({ request }) => {
  test.setTimeout(120_000);
  const pages = await indexedPages(request);

  // One request a page, for all the checks a page's HTML answers. A
  // description the index has, the page has, as one line of plain text
  // (lib/description.ts); every operation and webhook has one (redocly.yaml).
  // Fumadocs hands each API page the whole OpenAPI document, which put every
  // operation and schema of the API, about 900 KB of HTML, on every one of
  // them; lib/source.ts passes the page its operations and what they
  // reference, and the largest page is now about 300 KB.
  const budget = 500_000;
  const results = await mapLimit(pages, concurrency, async ({ title, url, description }) => {
    const response = await request.get(url);
    const type = response.headers()["content-type"] ?? "";
    if (response.status() !== 200) return `${url}: ${response.status()}`;
    if (!type.startsWith("text/html")) return `${url}: ${type}`;
    const body = await response.body();
    if (operationPage.test(url) && body.length > budget) return `${url}: ${body.length} bytes`;
    const html = body.toString("utf8");
    const expected = `<title>${escapeHtml(title)}</title>`;
    if (!html.includes(expected)) return `${url}: no ${expected}`;
    const meta = metaContent(html, "description");
    if (meta === undefined) {
      return description || operationPage.test(url) ? `${url}: no description` : null;
    }
    const problem = descriptionProblem(meta);
    if (problem) return `${url}: description "${meta}" has ${problem}`;
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

type Fragment = {
  paths?: Record<string, Record<string, Operation>>;
  components?: { parameters?: Record<string, Parameter> };
};
type Operation = {
  operationId?: string;
  security?: Record<string, unknown>[];
  parameters?: (Parameter | { $ref: string })[];
};
type Parameter = { in?: string };

/** The operation of an operation page, from the OpenAPI its Markdown ends with. */
function operationOf(markdown: string): { operation: Operation; fragment: Fragment } | undefined {
  const json = /as OpenAPI:\n\n```json\n([\s\S]*?)\n```/.exec(markdown)?.[1];
  if (!json) return undefined;
  const fragment = JSON.parse(json) as Fragment;
  const operation = Object.values(Object.values(fragment.paths ?? {})[0] ?? {})[0];
  return operation && { operation, fragment };
}

/**
 * `api <operationId>` for an operation `zitadel api` calls: one a project
 * secret or nothing authenticates, without a cookie parameter.
 */
function apiCommand(found: ReturnType<typeof operationOf>): string | undefined {
  if (!found) return undefined;
  const { operation, fragment } = found;
  const security = operation.security ?? [];
  const session =
    security.length > 0 &&
    !security.some((item) => Object.keys(item).length === 0 || "oauth2" in item);
  const cookie = (operation.parameters ?? []).some((parameter) => {
    const resolved =
      "$ref" in parameter
        ? fragment.components?.parameters?.[parameter.$ref.split("/").pop() ?? ""]
        : parameter;
    return resolved?.in === "cookie";
  });
  return session || cookie ? undefined : `api ${operation.operationId}`;
}

test("every API operation shows its call through @zitadel/api, its CLI command and cURL", async ({
  request,
}) => {
  test.setTimeout(120_000);
  const pages = (await indexedPages(request)).filter((page) => operationPage.test(page.url));

  // The TypeScript sample comes first (components/api-page.tsx), so the page
  // renders it; the Markdown has it in a code block (lib/source.ts). A
  // webhook's page, under the same paths, shows its payload instead: the
  // Markdown says which of the two a page is.
  const call =
    /```ts\nimport \{ [^}]+ \} from "@zitadel\/api\/(?:client|config)";\n[\s\S]*?await client\.\w+\(/;
  let operations = 0;
  const results = await mapLimit(pages, concurrency, async ({ url }) => {
    const markdown = await (await request.get(markdownUrl(url))).text();
    if (!markdown.includes("The operation and every component it references")) return null;
    operations++;
    if (!call.test(markdown)) return `${markdownUrl(url)}: no call through @zitadel/api`;
    // An operation the spec names a CLI command for (`x-zitadel-cli`, which
    // its OpenAPI shows) is also run with that command, and one the CLI can
    // call without one with `zitadel api` (lib/cli-sample.ts).
    const named = /"x-zitadel-cli": "([^"]+)"/.exec(markdown)?.[1];
    const command = named ?? apiCommand(operationOf(markdown));
    if (command && !markdown.includes(`npx @zitadel/cli@alpha ${command}`)) {
      return `${markdownUrl(url)}: no \`${command}\` command`;
    }
    if (named) {
      // The command's page links back to the operation (lib/cli-reference.ts).
      const commandPage = markdownUrl(`/docs/reference/cli/${named.split(" ").join("/")}`);
      const back = await (await request.get(commandPage)).text();
      if (!back.includes(`](${url})`)) return `${commandPage}: no link to ${url}`;
    }
    // And with cURL, as the page's last sample (lib/source.ts).
    if (!/```bash\ncurl -X [A-Z]+ 'http:\/\/localhost:8080\//.test(markdown)) {
      return `${markdownUrl(url)}: no cURL command`;
    }
    const html = await (await request.get(url)).text();
    if (!html.includes("@zitadel/api/")) return `${url}: no @zitadel/api sample`;
    return null;
  });
  expect(operations).toBeGreaterThan(0);
  expect(failures(results), "operations without their @zitadel/api call").toEqual([]);
});

test("every CLI command shows its usage, in tables whose rows keep their cells", async ({
  request,
}) => {
  test.setTimeout(120_000);
  const pages = (await indexedPages(request)).filter((page) => cliReferencePage.test(page.url));

  // A command's usage runs the command its URL names, and a `|` in the help
  // it is generated from, as in a list's `--filter` grammar, stays inside its
  // table cell (lib/cli-reference.ts). A cell splits at every `|` it does not
  // escape, in a code span too.
  const cells = (row: string) => row.slice(1, -1).split(/(?<!\\)\|/).length;
  let commands = 0;
  const results = await mapLimit(pages, concurrency, async ({ url }) => {
    const markdown = await (await request.get(markdownUrl(url))).text();
    const words = cliReferencePage.exec(url)?.[1];
    if (words && !cliOwnPages.has(words)) {
      commands++;
      const usage = `## Usage\n\n\`\`\`sh\nnpx @zitadel/cli@alpha ${words.split("/").join(" ")} `;
      if (!markdown.includes(usage)) return `${markdownUrl(url)}: no usage of its command`;
    }
    // A row has as many cells as its table's header, the row that opens it.
    let header = 0;
    const ragged = markdown.split("\n").find((line) => {
      if (!line.startsWith("| ")) {
        header = 0;
        return false;
      }
      header ||= cells(line);
      return cells(line) !== header;
    });
    return ragged ? `${markdownUrl(url)}: a table row unlike its header: ${ragged}` : null;
  });
  expect(commands).toBeGreaterThan(0);
  expect(failures(results), "CLI reference pages whose Markdown is wrong").toEqual([]);
});

test("a page that does not exist is a 404, as HTML and as Markdown", async ({ request }) => {
  expect((await request.get("/docs/no-such-page")).status()).toBe(404);
  expect((await request.get("/docs/no-such-page.md")).status()).toBe(404);
  const negotiated = await request.get("/docs/no-such-page", {
    headers: { Accept: "text/markdown" },
  });
  expect(negotiated.status()).toBe(404);
});

test("a page that moved redirects to where it is now, as HTML and as Markdown", async ({
  request,
}) => {
  // The pages next.config.mjs redirects, from their old URL to their new one.
  const moved = JSON.parse(
    readFileSync(new URL("../lib/moved.json", import.meta.url), "utf8"),
  ) as Record<string, string>;
  const twins = Object.entries(moved).flatMap(([from, to]) => [
    [from, to],
    [`${from}.md`, `${to}.md`],
  ]);

  const results = await mapLimit(twins, concurrency, async ([from = "", to = ""]) => {
    const response = await request.get(from, { maxRedirects: 0 });
    const location = new URL(response.headers().location ?? "", "http://docs").pathname;
    if (response.status() !== 308 || location !== to) {
      return `${from}: ${response.status()} to ${location}`;
    }
    const target = await request.get(to);
    return target.status() === 200 ? null : `${to}: ${target.status()}`;
  });
  expect(failures(results), "moved pages that do not redirect to a page").toEqual([]);
});

test("llms-full.txt carries every page but the API operations", async ({ request }) => {
  const pages = await indexedPages(request);
  const response = await request.get("/docs/llms-full.txt");
  expect(response.status()).toBe(200);
  const full = await response.text();

  // With the operations and the schemas they reference the file was twenty
  // times this size (#1685).
  const missing = pages
    .filter((page) => !operationPage.test(page.url))
    .filter((page) => !full.includes(`# ${page.title} (${page.url})`))
    .map((page) => page.url);
  expect(missing, "pages missing from llms-full.txt").toEqual([]);
  const operations = pages.filter((page) => operationPage.test(page.url));
  expect(operations.length).toBeGreaterThan(0);
  expect(
    operations.filter((page) => full.includes(`(${page.url})`)).map((page) => page.url),
    "API operations in llms-full.txt",
  ).toEqual([]);
  expect(full.length).toBeLessThan(500_000);
});

test("scripts and styles load from /docs/_next/", async ({ request }) => {
  const html = await (await request.get("/docs/get-started/quickstart")).text();
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
