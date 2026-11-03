import { createHash } from "node:crypto";

import type { APIResponse, Page } from "@playwright/test";

/**
 * A page as /docs/llms.txt lists it, `- [title](/docs/....md): description`:
 * the Markdown URL it lists and the page's own URL, the one without `.md`.
 */
export interface IndexedPage {
  title: string;
  url: string;
  markdown: string;
  description?: string;
}

/** The pages the index lists, in its order. */
export function parseIndex(index: string): IndexedPage[] {
  return [...index.matchAll(/^\s*- \[([^\]]+)\]\(([^)\s]+)\)(?:: (.*))?$/gm)].map(
    ([, title = "", markdown = "", description]) => ({
      title,
      url: pageUrl(markdown),
      markdown,
      ...(description !== undefined && { description }),
    }),
  );
}

/** The page a Markdown URL is the twin of; a URL without `.md` stays as it is. */
function pageUrl(markdown: string): string {
  return markdown === "/docs/index.md" ? "/docs" : markdown.replace(/\.md$/, "");
}

/**
 * The lines of /docs/llms.txt that are not where the page tree puts a line:
 * its `# ` heading, a `> ` summary, then one `- ` line per page, folder or
 * separator, each folder followed by its children one level deeper. A
 * description that runs over several lines breaks out of its entry.
 */
export function indexStrays(index: string): string[] {
  const lines = index.split("\n").filter((line) => line.trim() !== "");
  const strays: string[] = [];
  let level = -1;
  let folder = false;
  lines.forEach((line, i) => {
    if (i === 0 && line.startsWith("# ")) return;
    if (level === -1 && line.startsWith("> ")) return;
    const entry = /^((?: {2})*)- (\S.*)$/.exec(line);
    const depth = entry ? (entry[1] ?? "").length / 2 : Number.NaN;
    if (!entry || depth > level + 1 || (folder && depth !== level + 1)) {
      strays.push(line);
      return;
    }
    const text = entry[2] ?? "";
    folder = !text.startsWith("[") && !/^\*\*.+\*\*$/.test(text);
    level = depth;
  });
  if (folder) strays.push("(a folder without pages at the end)");
  return strays;
}

/**
 * What keeps a page's description from being one line of plain text, if
 * anything; for an API page, Markdown left over from its OpenAPI description
 * (lib/description.ts).
 */
export function descriptionProblem(description: string): string | undefined {
  if (/[`\n]/.test(description)) return "a backtick or a line break";
  if (description.length > 160) return `${description.length} characters`;
  if (/^(?:#|>|-|\||\d+\.)(?:\s|$)/.test(description)) return "Markdown block syntax";
  const remnant = [
    ["[", /\[/],
    ["**", /\*\*/],
    ["emphasis", /(?:^|[\s(])([*_])[^\s*_][^*_]*?(?<=[^\s*_])\1(?=$|[\s.,;:!?)])/],
    ["\\", /\\/],
    ["&amp;", /&amp;/],
  ] as const;
  return remnant.find(([, pattern]) => pattern.test(description))?.[0];
}

/** A page's Markdown URL: the page's URL plus `.md`; the overview's is `/docs/index.md`. */
export function markdownUrl(url: string): string {
  return url === "/docs" ? "/docs/index.md" : `${url}.md`;
}

/** The site's pages a Markdown text links to, without anchors and queries, each once. */
export function siteLinks(markdown: string): string[] {
  const links = new Set<string>();
  for (const [, link = ""] of markdown.matchAll(/\]\((\/docs(?:\/[^)\s#?]*)?)/g)) {
    links.add(link.replace(/\/$/, "") || "/docs");
  }
  return [...links];
}

/** A title as React renders it into `<title>`. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** The text React escaped into an attribute, unescaped. */
function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The content of a page's `<meta>` tag, by its `name` or `property`, if it has one. */
export function metaContent(html: string, key: string): string | undefined {
  const tag = html.match(new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`));
  return tag ? unescapeHtml(tag[1] ?? "") : undefined;
}

/**
 * What is wrong with a page's policies, if anything: the enforced one
 * (csp-adapter.mjs) lets nothing frame it, keeps its requests on the docs'
 * own origin and allows each inline script by hash.
 */
export function policyProblem(headers: Record<string, string>, html: string): string | undefined {
  const enforced = headers["content-security-policy"] ?? "(none)";
  if (!enforced.includes("frame-ancestors 'none'")) {
    return `its policy ${enforced} lets another site frame it`;
  }
  if (!/(^|; )connect-src 'self'(;|$)/.test(enforced)) {
    return `its enforced policy ${enforced} lets it connect elsewhere`;
  }
  const scripts = enforced.match(/(?:^|; )script-src ([^;]*)/)?.[1] ?? "";
  if (scripts.includes("'unsafe-inline'")) return "its enforced policy allows any inline script";
  const unlisted = inlineScripts(html).filter(
    (script) =>
      !scripts.includes(`'sha256-${createHash("sha256").update(script).digest("base64")}'`),
  );
  return unlisted.length
    ? `its enforced policy lists no hash for ${unlisted.length} of its inline scripts, the first starting ${JSON.stringify(unlisted[0]?.slice(0, 60))}`
    : undefined;
}

/** The bodies of a page's inline scripts. */
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)]
    .filter(([, attributes, body]) => body && !/\bsrc\s*=/i.test(attributes ?? ""))
    .map(([, , body]) => body ?? "");
}

/**
 * Records each violation of the page's policies, enforced or report-only,
 * from before its first script and across navigations: first-party code
 * breaks neither, so a spec expects the list to stay empty.
 */
export async function recordPolicyViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeFunction("recordPolicyViolation", (violation: string) => {
    violations.push(violation);
  });
  await page.addInitScript(() => {
    const record = (window as unknown as { recordPolicyViolation(violation: string): void })
      .recordPolicyViolation;
    window.addEventListener("securitypolicyviolation", (event) => {
      record(
        `${event.disposition} ${event.effectiveDirective} ${event.blockedURI || "(none)"}` +
          ` at ${event.sourceFile}:${event.lineNumber}`,
      );
    });
  });
  return violations;
}

/** Runs `fn` over `items`, at most `limit` at a time, keeping the order of the results. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const queue = items.map((item, index) => ({ item, index }));
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      results[job.index] = await fn(job.item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** The failures of a per-page check, so one assertion names every one of them. */
export function failures(results: (string | null)[]): string[] {
  return results.filter((result): result is string => result !== null);
}

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * The one JSON-RPC message of a Streamable HTTP response: a JSON body, or an
 * SSE body whose first event carries it in `data:` lines.
 */
export async function jsonRpcMessage(response: APIResponse): Promise<JsonRpcMessage> {
  const body = await response.text();
  if (!(response.headers()["content-type"] ?? "").includes("text/event-stream")) {
    return JSON.parse(body) as JsonRpcMessage;
  }
  const event = body.split(/\n\n+/).find((chunk) => chunk.includes("data:")) ?? "";
  const data = event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n");
  return JSON.parse(data) as JsonRpcMessage;
}
