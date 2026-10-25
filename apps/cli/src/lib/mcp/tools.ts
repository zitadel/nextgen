import type { StandardSchemaWithJSON, ToolAnnotations } from "@modelcontextprotocol/server";
import * as zod from "zod";

import { type ApiOperation, OPERATIONS, uncallable } from "../api/operations";
import { type ApiRequest, schemaOf } from "../api/request";

/**
 * The operations `zitadel mcp` offers an agent as tools: one tool per
 * operation the CLI can call (`uncallable`), named by its `operationId` and
 * typed by the operation's generated Zod schemas, the ones `zitadel api`
 * types its fields with.
 */

/** One tool, before it is registered. */
export type ToolDefinition = Readonly<{
  operation: ApiOperation;
  /** The `operationId`, as the API reference and `zitadel api` name it. */
  name: string;
  title: string;
  description: string;
  inputSchema: StandardSchemaWithJSON;
  annotations: ToolAnnotations;
}>;

/** Which operations become tools. */
export type ToolSelection = Readonly<{
  /** Offer the operations that create, change or delete, beside the reads. */
  writes: boolean;
  /** Only the operations of these tags (`Users`, `Teams`), in any case; every tag when empty. */
  tags?: readonly string[];
}>;

/** Whether an operation only reads: a GET, or a POST to a `/query` path, which searches. */
export const readsOnly = (operation: ApiOperation): boolean =>
  operation.method === "GET" || (operation.method === "POST" && operation.path.endsWith("/query"));

/** The tags of the operations the CLI can call, in the spec's order. */
export const toolTags = (): readonly string[] => [
  ...new Set(OPERATIONS.filter((operation) => !uncallable(operation)).map(({ tag }) => tag)),
];

/** The tools for `selection`, in the spec's order. */
export const toolsFor = ({ writes, tags = [] }: ToolSelection): readonly ToolDefinition[] => {
  const wanted = new Set(tags.map((tag) => tag.toLowerCase()));
  return OPERATIONS.filter(
    (operation) =>
      uncallable(operation) === undefined &&
      (writes || readsOnly(operation)) &&
      (wanted.size === 0 || wanted.has(operation.tag.toLowerCase())),
  ).map(toolOf);
};

const toolOf = (operation: ApiOperation): ToolDefinition => ({
  operation,
  name: operation.id,
  title: operation.summary,
  description: [
    `${operation.summary}: ${operation.method} ${operation.path}.`,
    operation.paging
      ? "A page ends with next_page_token when there are more; pass it back as page_token."
      : "",
  ]
    .filter(Boolean)
    .join(" "),
  inputSchema: withShortDescriptions(inputOf(operation)),
  annotations: annotationsOf(operation),
});

/** The project `.zitadel/secret` names stands in for a `project_id` left out. */
const PROJECT_DEFAULT = "Defaults to the project of the directory `zitadel mcp` serves.";

/**
 * A tool's arguments: the path parameters and query parameters by name, and
 * the JSON body as `body`. A header parameter is left out, as `zitadel api`
 * leaves it.
 */
const inputOf = (operation: ApiOperation): zod.ZodObject => {
  const shape: Record<string, zod.ZodType> = {};
  for (const part of ["Params", "QueryParams"] as const) {
    const schema = schemaOf(operation, part) as zod.ZodObject | undefined;
    for (const [name, field] of Object.entries(schema?.shape ?? {})) {
      shape[name] =
        name === "project_id" ? (field as zod.ZodType).optional().describe(PROJECT_DEFAULT) : field;
    }
  }
  const body = schemaOf(operation, "Body") as zod.ZodType | undefined;
  if (operation.body !== null) {
    if ("body" in shape) {
      throw new Error(
        `${operation.id} has a parameter called body, which its tool keeps for the body`,
      );
    }
    const schema = body ?? zod.record(zod.string(), zod.unknown());
    // As on `zitadel api`, a required body left out is `{}` (`requestOf`), so
    // a body the empty document satisfies, such as a query's, may be left out.
    shape.body =
      operation.body === "required" && !schema.safeParse({}).success ? schema : schema.optional();
  }
  return zod.object(shape);
};

/**
 * MCP's hints for a client deciding whether to ask before a call: a read
 * changes nothing; a DELETE, a PUT or PATCH that overwrites, and a POST that
 * removes, revokes or rolls back may destroy; nothing here reaches beyond the
 * one server.
 */
const annotationsOf = (operation: ApiOperation): ToolAnnotations => {
  if (readsOnly(operation)) {
    return { title: operation.summary, readOnlyHint: true, openWorldHint: false };
  }
  const removes = /^(remove|revoke|rollback|delete)/i.test(operation.id);
  return {
    title: operation.summary,
    readOnlyHint: false,
    destructiveHint: operation.method !== "POST" || removes,
    idempotentHint: operation.method === "PUT" || operation.method === "DELETE",
    openWorldHint: false,
  };
};

/**
 * The schema with every description cut to its first sentence in the JSON
 * Schema a client lists: the spec's descriptions run to paragraphs, every tool
 * carries its own, and the first sentence says on its own what a field is
 * (`api/openapi/AGENTS.md`). Arguments are still checked by the whole schema.
 */
const withShortDescriptions = (schema: zod.ZodType): StandardSchemaWithJSON => {
  const standard = schema["~standard"];
  return {
    "~standard": {
      version: 1,
      vendor: standard.vendor,
      validate: (value) => standard.validate(value),
      jsonSchema: {
        input: (options) => shorten(standard.jsonSchema.input(options)) as Record<string, unknown>,
        output: (options) =>
          shorten(standard.jsonSchema.output(options)) as Record<string, unknown>,
      },
    },
  } as StandardSchemaWithJSON;
};

const shorten = (node: unknown): unknown => {
  if (Array.isArray(node)) {
    return node.map(shorten);
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      key === "description" && typeof value === "string" ? firstSentence(value) : shorten(value),
    ]),
  );
};

// As the docs read it (apps/docs/lib/description.ts): a sentence ends at a
// full stop, question or exclamation mark, and any closing quote or bracket,
// followed by a space and something other than a lower-case letter. A code
// span's or a link's full stops end nothing, so they are masked first.
const sentenceEnd =
  /(?<!\b(?:[Ee]\.g|[Ii]\.e|[Cc]f|[Vv]s|[Aa]pprox|[Ii]ncl))[.!?]["'’”)\]]*(?= +[^a-z ])/;

/** The first sentence of a Markdown description's first paragraph. */
export const firstSentence = (markdown: string): string => {
  const paragraph = (markdown.trim().split(/\n\s*\n/)[0] ?? "").replace(/\s+/g, " ").trim();
  const masked = paragraph.replace(/`[^`]*`|\[[^\]]*\]\([^)]*\)/g, (span) =>
    span.replace(/[.!?]/g, "X"),
  );
  const end = sentenceEnd.exec(masked);
  return end ? paragraph.slice(0, end.index + end[0].length) : paragraph;
};

/**
 * The request a tool call makes: the path filled in, the query parameters it
 * was given (a list repeats its name), and the body. A `project_id` the
 * operation needs and the call leaves out is `projectId`, as on `zitadel api`.
 */
export const requestOf = (
  operation: ApiOperation,
  args: Readonly<Record<string, unknown>>,
  projectId: string,
): ApiRequest => {
  const pathValue = (name: string): string =>
    String(args[name] ?? (name === "project_id" ? projectId : ""));
  const path = operation.path.replace(/\{([^}]+)\}/g, (_, name: string) =>
    encodeURIComponent(pathValue(name)),
  );
  const query = operation.parameters
    .filter((parameter) => parameter.in === "query")
    .flatMap((parameter) => {
      const value =
        args[parameter.name] ??
        (parameter.name === "project_id" && parameter.required ? projectId : undefined);
      if (value === undefined || value === null) {
        return [];
      }
      return (Array.isArray(value) ? value : [value]).map(
        (item) => [parameter.name, String(item)] as const,
      );
    });
  const body = args.body ?? (operation.body === "required" ? {} : undefined);
  return { operation, path, query, ...(body === undefined ? {} : { body }) };
};
