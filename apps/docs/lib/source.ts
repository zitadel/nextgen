import { renderPlaceholder } from "fumadocs-core/mdx-plugins/remark-llms.runtime";
import type * as PageTree from "fumadocs-core/page-tree";
import type { AdvancedIndex } from "fumadocs-core/search/server";
import { getSlugs, llms, loader, update } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { applyMdxPreset } from "fumadocs-mdx/config";
import { defineDocs } from "fumadocs-mdx/macro";
import type { OpenAPIV3_2, OperationItem, OperationObject, WebhookItem } from "fumadocs-openapi";
import type { RequestData } from "fumadocs-openapi/requests";
import { pathnameFromRequest } from "fumadocs-openapi/requests/generators";
import { curl } from "fumadocs-openapi/requests/generators/curl";

import { cliCommandUrl, cliSidebarNames, cliSource, commandOperations } from "./cli-reference";
import { codeOptions } from "./code-theme";
import { cliCommand, cliSample } from "./cli-sample";
import { defaultRequest, withRefValues } from "./default-request";
import { firstSentence, shortDescription } from "./description";
import { type ApiOperation, errorSource } from "./error-reference";
import { openapi } from "./openapi";
import { authentication, sdkSample } from "./sdk-sample";
import { docsRoute, getPageMarkdownUrl } from "./shared";

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
    // Fumadocs' defaults, the code blocks in the console's colours.
    mdxOptions: (environment) => applyMdxPreset({ rehypeCodeOptions: codeOptions })(environment),
    postprocess: {
      // An API tag's page lists the tag's operations with <Operations />,
      // which its Markdown renders as the page does (pageText).
      includeProcessedMarkdown: { mdxAsPlaceholder: ["Operations"] },
    },
  },
  meta: {
    schema: metaSchema,
  },
});

const content = docs.toFumadocsSource();

const apiBaseDir = "reference/api";

// A page per operation of the server's API, beside the reference's own pages
// in content/docs/reference/api. Fumadocs makes the operation's whole
// description the page's description; the page's own is a line of plain text,
// and `markdownDescription` keeps the whole (lib/description.ts).
// The sidebar lists a tag's operations in the document's order. A tag's folder
// takes its name from the tag's page, and the reference's own meta.json orders
// the tags.
const operationPages = update(
  await openapi.staticSource({
    baseDir: apiBaseDir,
    groupBy: "tag",
    meta: true,
  }),
)
  .files((files) =>
    files.filter((file) => file.type !== "meta" || file.path !== `${apiBaseDir}/meta.json`),
  )
  .meta((meta): typeof meta => ({ ...meta, data: { pages: meta.data.pages } }))
  .page((page) => {
    // The document is data: a description that is not a string is none.
    const description: unknown = page.data.description;
    const markdown = typeof description === "string" ? description : undefined;
    return {
      ...page,
      data: {
        ...page.data,
        description: markdown === undefined ? undefined : shortDescription(markdown),
        markdownDescription: markdown,
      },
    };
  })
  .build();

// The API's operations for its Errors page, in the order the sidebar lists
// them, each with its page and its section: the folder its page is in, titled
// by the folder's own page.
function apiOperations(): ApiOperation[] {
  const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
  const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.mdx?$/, "");
  const sectionTitles = new Map<string, string | undefined>();
  const listed = new Map<string, string[]>();
  for (const file of content.files) {
    if (file.type === "page" && nameOf(file.path) === "index") {
      sectionTitles.set(folderOf(file.path), file.data.title);
    }
  }
  // The reference's meta.json orders the sections, each section's own the
  // operations in it.
  for (const file of [...content.files, ...operationPages.files]) {
    if (file.type === "meta") listed.set(folderOf(file.path), file.data.pages ?? []);
  }
  // Where a folder's meta.json lists a page; one it does not list comes last.
  const rank = (path: string) => {
    const pages = listed.get(folderOf(path)) ?? [];
    const index = pages.indexOf(nameOf(path));
    return index === -1 ? pages.length : index;
  };

  const pages = operationPages.files.flatMap((file) => (file.type === "page" ? [file] : []));
  pages.sort(
    (a, b) => rank(folderOf(a.path)) - rank(folderOf(b.path)) || rank(a.path) - rank(b.path),
  );

  return pages.flatMap((file) => {
    const folder = folderOf(file.path);
    const { bundled } = file.data.getSchema();
    const { operations = [] } = file.data.getOpenAPIPageProps();
    return operations.flatMap(({ path, method }) => {
      const operation = bundled.paths?.[path]?.[method];
      if (!operation?.operationId) return [];
      return [
        {
          operationId: operation.operationId,
          summary: file.data.title ?? operation.operationId,
          method,
          path,
          url: `${docsRoute}/${getSlugs(file.path).join("/")}`,
          section: {
            title: sectionTitles.get(folder) ?? folder,
            url: `${docsRoute}/${folder}`,
          },
          rateLimited: operation.responses?.["429"] !== undefined,
        },
      ];
    });
  });
}

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader(
  {
    docs: content,
    openapi: operationPages,
    // The reference's Errors page, generated from the API's error codes
    // (lib/error-reference.ts).
    errors: errorSource(apiBaseDir, `${docsRoute}/${apiBaseDir}`, apiOperations()),
    // A page per command of the CLI, under reference/cli, which links the
    // operation the command calls (lib/cli-reference.ts).
    cli: cliSource(commandOperations(operationPages)),
  },
  {
    baseUrl: docsRoute,
    plugins: [lucideIconsPlugin(), openapi.loaderPlugin(), cliSidebarNames()],
  },
);

type Page = (typeof source)["$inferPage"];
type OpenAPIPage = Extract<Page, { type: "openapi" }>;

// llms.txt and MCP's list_pages have room for an operation's whole first
// sentence (lib/description.ts); otherwise Fumadocs' own description.
function sourceLlms(input: typeof source, { full = false } = {}) {
  return llms(input, {
    renderDescription: (node) => {
      const data =
        node.type === "page" ? source.getNodePage(node)?.data : source.getNodeMeta(node)?.data;
      if (data && "markdownDescription" in data)
        return firstSentence(data.markdownDescription ?? "");
      return data?.description || (typeof node.description === "string" ? node.description : "");
    },
    renderPage: async (page) => `# ${page.data.title} (${page.url})

${await pageText(page, full)}`,
  });
}

// A CLI reference page and the Errors page are Markdown already, with a
// version for llms-full.txt; a content page's is its processed MDX, with an
// API tag's operations in place of <Operations />.
async function pageText(page: Page, full: boolean) {
  switch (page.type) {
    case "openapi":
      return operationText(page);
    case "cli":
    case "errors":
      return full ? page.data.llmsFullMarkdown : page.data.markdown;
    default:
      return renderPlaceholder(await page.data.getText("processed"), {
        Operations: () => operationTable(page, !full),
      });
  }
}

// The pages and MCP, whose get_page takes the page URL its list_pages lists.
export const docsLlms = sourceLlms(source);

// llms-full.txt, which leaves the operations out, so its pages link none.
export const docsLlmsFull = sourceLlms(source, { full: true });

// /docs/llms.txt, which lists each page by its Markdown URL (lib/shared.ts),
// so an agent fetches the Markdown without asking for it through `Accept`.
// The OpenAPI document is not a page, so its link is the summary above the
// list rather than an entry in it.
export const docsLlmsIndex = sourceLlms({
  ...source,
  getPageTree: (locale) => ({
    ...withMarkdownUrls(source.getPageTree(locale)),
    description: "The server's API as one OpenAPI document: [openapi.json](/docs/openapi.json).",
  }),
});

function withMarkdownUrls<T extends PageTree.Root | PageTree.Node>(node: T): T {
  switch (node.type) {
    case "page": {
      const page = source.getNodePage(node);
      return page ? { ...node, url: getPageMarkdownUrl(page).url } : node;
    }
    case "separator":
      return node;
    default:
      return {
        ...node,
        ...("index" in node && node.index && { index: withMarkdownUrls(node.index) }),
        children: node.children.map((child) => withMarkdownUrls(child)),
      };
  }
}

// The props of an operation's or a webhook's page, a client component.
// Fumadocs hands each page the whole document, so every page carried every
// operation and schema of the API, about 720 KB. The page gets the part it
// renders: its operations or webhooks, every component they reference, and the
// security schemes, which an operation names rather than references.
export function openapiPageProps(page: OpenAPIPage) {
  const props = page.data.getOpenAPIPageProps();
  const { operations = [], webhooks = [], payload } = props;
  const {
    paths,
    webhooks: hooks,
    components,
  } = openapiFragment(payload.bundled, operations, webhooks);
  const { paths: _paths, webhooks: _webhooks, components: all, ...document } = payload.bundled;

  return {
    ...props,
    payload: {
      ...payload,
      bundled: {
        ...document,
        ...(paths && { paths }),
        ...(hooks && { webhooks: hooks }),
        components: {
          ...components,
          ...(all?.securitySchemes && { securitySchemes: all.securitySchemes }),
        },
      } as OpenAPIV3_2.Document,
    },
  };
}

// An API tag's page lists the operation and webhook pages beside it, in the
// sidebar's order, as Markdown tables: the page renders them in place of
// <Operations /> (components/operations.tsx), and so does its Markdown
// (pageText). A row links its page unless `links` is false.
export function operationTable(page: Page, links = true) {
  const operations: string[] = [];
  const webhooks: string[] = [];
  for (const child of source.getPages()) {
    if (child.type !== "openapi" || child.slugs.length !== page.slugs.length + 1) continue;
    if (page.slugs.some((slug, i) => child.slugs[i] !== slug)) continue;

    const { operations: items = [], webhooks: hooks = [] } = child.data.getOpenAPIPageProps();
    const link = (text: string) => (links ? `[${text}](${child.url})` : text);
    // The sidebar strikes a deprecated one through.
    const deprecated = child.data._openapi.deprecated ? " Deprecated." : "";
    for (const { method, path } of items) {
      operations.push(
        `| \`${method.toUpperCase()}\` | \`${path}\` | ${link(cell(child.data.title ?? ""))}${deprecated} |`,
      );
    }
    for (const { name } of hooks) {
      const description = firstSentence(child.data.markdownDescription ?? "");
      webhooks.push(`| ${link(`\`${name}\``)} | ${cell(description)}${deprecated} |`);
    }
  }

  return [
    operations.length > 0 && ["| Method | Path | Summary |", "| --- | --- | --- |", ...operations],
    webhooks.length > 0 && ["| Event type | Description |", "| --- | --- |", ...webhooks],
  ]
    .filter((table) => table !== false)
    .map((table) => table.join("\n"))
    .join("\n\n");
}

// A cell of plain text is one line, in which a `|` would end the cell and a
// `*`, `[` or `<` start Markdown.
function cell(text: string) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*[\]<|]/g, "\\$&");
}

// An operation or webhook page has no Markdown of its own. Its text is its
// endpoints, an operation's call through @zitadel/api, its CLI command and
// cURL, which the page shows too, and the part of the OpenAPI document they need,
// the operations or webhooks and every component they reference, so the page
// stands on its own.
function operationText(page: OpenAPIPage) {
  const { operations = [], webhooks = [] } = page.data.getOpenAPIPageProps();
  const { bundled } = page.data.getSchema();
  const fragment = openapiFragment(bundled, operations, webhooks);
  const endpoints = [
    ...operations.map(({ method, path }) => `\`${method.toUpperCase()} ${path}\``),
    ...webhooks.map(({ method, name }) => `\`${method.toUpperCase()}\` webhook \`${name}\``),
  ];
  const samples = operations.flatMap(({ method, path }) => {
    const sample = operationSamples(bundled, path, method);
    if (!sample) return [];
    return [
      "Called through [`@zitadel/api`](/docs/sdks/api-client), with the request the page shows:",
      `\`\`\`ts\n${sample.typescript}\n\`\`\``,
      ...(sample.cli && sample.command
        ? [
            `Run with [\`zitadel ${sample.command}\`](${cliCommandUrl(sample.command)}):`,
            `\`\`\`bash\n${sample.cli}\n\`\`\``,
          ]
        : []),
      "With cURL, against a local server:",
      `\`\`\`bash\n${sample.curl}\n\`\`\``,
    ];
  });

  return [
    page.data.markdownDescription,
    endpoints.join("\n"),
    ...samples,
    `The ${webhooks.length > 0 ? "webhook" : "operation"} and every component it references, as OpenAPI:`,
    `\`\`\`json\n${JSON.stringify(fragment, null, 2)}\n\`\`\``,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const resolvable = new WeakMap<OpenAPIV3_2.Document, OpenAPIV3_2.Document>();

// The page's TypeScript, CLI and cURL samples (lib/sdk-sample.ts,
// lib/cli-sample.ts, components/api-page.tsx) with the operation's default
// request: the Markdown has no example selector or playground.
function operationSamples(
  document: OpenAPIV3_2.Document,
  path: string,
  method: OperationItem["method"],
) {
  let withRefs = resolvable.get(document);
  if (!withRefs) {
    withRefs = withRefValues(document);
    resolvable.set(document, withRefs);
  }
  const pathItem = withRefs.paths?.[path];
  const operation = pathItem?.[method];
  if (!pathItem || !operation) return undefined;
  const request = defaultRequest(operation, pathItem, method);
  return {
    typescript: sdkSample(operation, path, pathItem, request),
    command: cliCommand(operation, pathItem),
    cli: cliSample(operation, path, pathItem, request),
    curl: curlSample(operation, path, request),
  };
}

// The page's cURL calls the page's own origin, the spec's server; the
// Markdown's the local server the spec names, as lib/sdk-sample.ts does.
const curlServer = "http://localhost:8080";

// cURL as the page generates it. An operation a project secret authenticates
// sends it as the bearer, from the variable the TypeScript sample reads; one
// only the session cookie authenticates runs in the browser, through the SDK
// proxy, so its cURL has no credential to send (lib/sdk-sample.ts).
function curlSample(operation: OperationObject, path: string, request: RequestData) {
  const [call = "", ...rest] = curl
    .generate(
      { ...request, url: `${curlServer}${pathnameFromRequest(path, request)}` },
      { mediaAdapters: curlMediaAdapters, custom: null },
    )
    .split(" \\\n  ");
  const bearer =
    authentication(operation) === "secret"
      ? ['-H "Authorization: Bearer $ZITADEL_PROJECT_SECRET"']
      : [];
  return [call, ...bearer, ...rest].join(" \\\n  ");
}

// Every request body of the API is JSON. cURL only asks whether its type has
// an adapter, and writes the body itself.
const curlMediaAdapters = {
  "application/json": {
    encode: ({ body }: { body: unknown }) => JSON.stringify(body),
    generateExample: () => undefined,
  },
};

function openapiFragment(
  document: OpenAPIV3_2.Document,
  operations: OperationItem[],
  webhooks: WebhookItem[],
) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const { path, method } of operations) {
    const item = document.paths?.[path];
    if (!item) continue;
    paths[path] = {
      ...(item.parameters && { parameters: item.parameters }),
      ...paths[path],
      [method]: item[method],
    };
  }

  // The bundle inlines a webhook's path item, as it does a path's.
  const hooks: Record<string, Record<string, unknown>> = {};
  for (const { name, method } of webhooks) {
    const item = document.webhooks?.[name];
    if (!item || "$ref" in item) continue;
    hooks[name] = {
      ...(item.parameters && { parameters: item.parameters }),
      ...hooks[name],
      [method]: item[method],
    };
  }

  const available = (document.components ?? {}) as Record<string, Record<string, unknown>>;
  const components: Record<string, Record<string, unknown>> = {};
  const pending = refsIn([paths, hooks]);
  for (let ref = pending.pop(); ref !== undefined; ref = pending.pop()) {
    const [, group, escaped] = /^#\/components\/([^/]+)\/([^/]+)$/.exec(ref) ?? [];
    if (!group || !escaped) continue;
    const name = escaped.replaceAll("~1", "/").replaceAll("~0", "~");
    const component = available[group]?.[name];
    if (component === undefined || components[group]?.[name] !== undefined) continue;
    components[group] = { ...components[group], [name]: component };
    pending.push(...refsIn(component));
  }

  return {
    ...(operations.length > 0 && { paths }),
    ...(webhooks.length > 0 && { webhooks: hooks }),
    components,
  };
}

function refsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : refsIn(child),
  );
}

// Fumadocs' default search index, with an API page's whole description:
// fumadocs-openapi indexes an operation's own as the page's text, so the short
// one would be a second hit, and one inherited from the path item is only
// here (lib/description.ts).
export function searchIndex(page: Page): AdvancedIndex {
  return {
    title: page.data.title ?? page.slugs.at(-1) ?? "",
    description:
      "markdownDescription" in page.data ? page.data.markdownDescription : page.data.description,
    url: page.url,
    id: page.url,
    structuredData: page.data.structuredData,
  };
}
