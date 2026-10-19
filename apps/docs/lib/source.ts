import { llms, loader, update } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { applyMdxPreset } from "fumadocs-mdx/config";
import { defineDocs } from "fumadocs-mdx/macro";
import type { OpenAPIV3_2, OperationItem, WebhookItem } from "fumadocs-openapi";

import { codeThemes } from "./code-theme";
import { defaultRequest, withRefValues } from "./default-request";
import { shortDescription } from "./description";
import { openapi } from "./openapi";
import { sdkSample } from "./sdk-sample";
import { docsRoute } from "./shared";

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
    // Fumadocs' defaults, the code blocks in the console's colours.
    mdxOptions: (environment) =>
      applyMdxPreset({ rehypeCodeOptions: { themes: codeThemes } })(environment),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    // A page per operation of the server's API, beside the reference's own
    // pages in content/docs/reference/api. Fumadocs makes the operation's
    // whole description the page's description; the page keeps its first
    // sentence, as plain text (lib/description.ts), and the body shows the
    // whole of it.
    openapi: update(
      await openapi.staticSource({
        baseDir: "reference/api",
        groupBy: "tag",
      }),
    )
      .page((page) =>
        page.data.description === undefined
          ? page
          : {
              ...page,
              data: { ...page.data, description: shortDescription(page.data.description) },
            },
      )
      .build(),
  },
  {
    baseUrl: docsRoute,
    plugins: [lucideIconsPlugin(), openapi.loaderPlugin()],
  },
);

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${page.type === "openapi" ? operationText(page) : await page.data.getText("processed")}`,
});

type OpenAPIPage = Extract<(typeof source)["$inferPage"], { type: "openapi" }>;

// An operation or webhook page has no Markdown of its own. Its text is its
// endpoints, an operation's call through @zitadel/api the page shows first,
// and the part of the OpenAPI document they need, the operations or webhooks
// and every component they reference, so the page stands on its own.
function operationText(page: OpenAPIPage) {
  const { operations = [], webhooks = [] } = page.data.getOpenAPIPageProps();
  const { bundled } = page.data.getSchema();
  const fragment = openapiFragment(bundled, operations, webhooks);
  // The whole description, from the document: the page's own is a sentence.
  const descriptions = [
    ...operations.map(({ path, method }) => {
      const item = bundled.paths?.[path];
      return item?.[method]?.description ?? item?.description;
    }),
    ...webhooks.map(({ name, method }) => {
      const item = bundled.webhooks?.[name];
      return item && !("$ref" in item)
        ? (item[method]?.description ?? item.description)
        : undefined;
    }),
  ];
  const endpoints = [
    ...operations.map(({ method, path }) => `\`${method.toUpperCase()} ${path}\``),
    ...webhooks.map(({ method, name }) => `\`${method.toUpperCase()}\` webhook \`${name}\``),
  ];
  const samples = operations.flatMap(({ method, path }) => {
    const sample = operationSample(bundled, path, method);
    return sample ? [`\`\`\`ts\n${sample}\n\`\`\``] : [];
  });

  return [
    ...descriptions,
    endpoints.join("\n"),
    samples.length > 0 &&
      "Called through [`@zitadel/api`](/docs/sdks/api-client), with the request the page shows:",
    ...samples,
    `The ${webhooks.length > 0 ? "webhook" : "operation"} and every component it references, as OpenAPI:`,
    `\`\`\`json\n${JSON.stringify(fragment, null, 2)}\n\`\`\``,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const resolvable = new WeakMap<OpenAPIV3_2.Document, OpenAPIV3_2.Document>();

// The page's TypeScript sample (lib/sdk-sample.ts) with the operation's
// default request: the Markdown has no example selector or playground.
function operationSample(
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
  return sdkSample(operation, path, pathItem, defaultRequest(operation, pathItem, method));
}

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
