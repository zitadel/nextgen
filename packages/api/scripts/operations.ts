import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle, loadConfig } from "@redocly/openapi-core";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const input = resolve(repoRoot, "api/openapi/openapi-spec.yaml");
const output = resolve(packageRoot, "src/generated/operations.ts");
const pagingOutput = resolve(packageRoot, "src/generated/paging.ts");

const METHODS = ["get", "put", "post", "delete", "patch"] as const;

// The slice of a dereferenced OpenAPI document this reads. What it writes is
// typed by the generated file itself, whose `operations` the typecheck holds
// to `ApiOperation`.
type Schema = { type?: string; properties?: Record<string, Schema>; allOf?: Schema[] };
type Media = { content?: Record<string, { schema?: Schema }> };
type Parameter = { name: string; in: string; required?: boolean };
type Operation = {
  operationId: string;
  summary?: string;
  tags?: string[];
  security?: Record<string, unknown>[];
  parameters?: Parameter[];
  requestBody?: Media & { required?: boolean };
  responses?: Record<string, Media>;
  "x-zitadel-cli"?: unknown;
};
type PathItem = { parameters?: Parameter[] } & Partial<Record<(typeof METHODS)[number], Operation>>;

/**
 * Writes `src/generated/operations.ts`: every operation of the spec as data,
 * which the generated endpoints carry only as code, and `src/generated/paging.ts`,
 * the slice of it the client needs to page. orval runs it after it has written
 * the client (`hooks.afterAllFilesWrite` in `orval.config.ts`), so it reads the
 * spec under the same lock and in the same task.
 */
export async function writeOperations(): Promise<void> {
  // Bundled with the repo's redocly.yaml, as the docs bundle it
  // (apps/docs/scripts/bundle-openapi.mjs), and dereferenced, so a parameter
  // or a schema is read where it is used.
  const config = await loadConfig({ configPath: resolve(repoRoot, "redocly.yaml") });
  const { bundle: result } = await bundle({ ref: input, config, dereference: true });
  const paths = (result.parsed as { paths?: Record<string, PathItem> }).paths ?? {};

  const operations = Object.entries(paths).flatMap(([path, item]) =>
    METHODS.flatMap((method) => {
      const operation = item[method];
      return operation ? [operationOf(path, method, item, operation)] : [];
    }),
  );
  await writeFile(output, source(operations));
  await writeFile(pagingOutput, pagingSource(operations));
}

function operationOf(path: string, method: string, item: PathItem, operation: Operation) {
  const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])].map(
    (parameter) => ({
      name: parameter.name,
      in: parameter.in,
      required: parameter.required === true,
    }),
  );
  const body = operation.requestBody;
  return {
    id: operation.operationId,
    method: method.toUpperCase(),
    path,
    summary: operation.summary ?? "",
    tag: operation.tags?.[0] ?? "",
    // The spec declares no document-wide requirement: every operation says how
    // it is authenticated, and one that says nothing needs nothing.
    auth: authentication(operation.security ?? []),
    parameters,
    body: body ? (body.required === true ? "required" : "optional") : null,
    arguments: argumentsOf(path, parameters, body),
    paging: paging(
      parameters,
      body?.content?.["application/json"]?.schema,
      successSchema(operation),
    ),
    cli: typeof operation["x-zitadel-cli"] === "string" ? operation["x-zitadel-cli"] : null,
  };
}

/**
 * The client function's arguments, in the order orval writes them: path
 * parameters in the path's order, the body, then the query parameters as one
 * object, with every optional argument moved after the required ones, as
 * TypeScript wants them. The request options orval adds last are left out.
 */
function argumentsOf(
  path: string,
  parameters: readonly { name: string; in: string; required: boolean }[],
  body: { required?: boolean } | undefined,
) {
  const query = parameters.filter((parameter) => parameter.in === "query");
  const slots = [
    ...[...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
      in: "path",
      name,
      required: true,
    })),
    ...(body ? [{ in: "body", required: body.required === true }] : []),
    ...(query.length > 0
      ? [{ in: "query", required: query.some((parameter) => parameter.required) }]
      : []),
  ];
  return [...slots.filter((slot) => slot.required), ...slots.filter((slot) => !slot.required)];
}

/** How an operation is authenticated, in the docs' vocabulary (apps/docs/lib/sdk-sample.ts). */
function authentication(requirements: Record<string, unknown>[]) {
  if (requirements.length === 0 || requirements.some((item) => Object.keys(item).length === 0)) {
    return "none";
  }
  return requirements.some((item) => "oauth2" in item) ? "secret" : "session";
}

/** The JSON schema of the first 2xx response, if it has one. */
function successSchema(operation: Operation): Schema | undefined {
  const [, response] =
    Object.entries(operation.responses ?? {}).find(([status]) => status.startsWith("2")) ?? [];
  return response?.content?.["application/json"]?.schema;
}

/**
 * Where a cursor-paginated operation takes its `page_token`, and the response
 * field that holds the page (ADR 027). An operation pages when it takes a
 * `page_token` and answers a `next_page_token` beside one list.
 */
function paging(
  parameters: readonly { name: string; in: string }[],
  body: Schema | undefined,
  response: Schema | undefined,
) {
  const token = parameters.some(
    (parameter) => parameter.in === "query" && parameter.name === "page_token",
  )
    ? "query"
    : properties(body).has("page_token")
      ? "body"
      : undefined;
  const fields = properties(response);
  if (!token || !fields.has("next_page_token")) return null;
  const lists = [...fields].filter(([, schema]) => schema.type === "array").map(([name]) => name);
  return lists.length === 1 ? { token, items: lists[0] } : null;
}

/** An object schema's properties, its `allOf` parts' included. */
function properties(schema: Schema | undefined): Map<string, Schema> {
  const found = new Map<string, Schema>();
  for (const part of [schema, ...(schema?.allOf ?? [])]) {
    for (const [name, property] of Object.entries(part?.properties ?? {})) {
      found.set(name, property);
    }
  }
  return found;
}

/** The argument of the generated function that carries `page_token`. */
function pagingArgument(operation: ReturnType<typeof operationOf>): number {
  return operation.arguments.findIndex((argument) => argument.in === operation.paging?.token);
}

function pagingSource(operations: readonly ReturnType<typeof operationOf>[]): string {
  const table = Object.fromEntries(
    operations.flatMap((operation) =>
      operation.paging
        ? [[operation.id, { items: operation.paging.items, arg: pagingArgument(operation) }]]
        : [],
    ),
  );
  return `// Code generated by packages/api/scripts/operations.ts from api/openapi. DO NOT EDIT: regenerate with moon run api:generate.

/**
 * The client functions that page (ADR 027), by name: the response field that
 * holds a page's items, and the argument that carries \`page_token\`.
 */
export const paging = ${JSON.stringify(table, null, 2)} as const;
`;
}

function source(operations: readonly unknown[]): string {
  return `// Code generated by packages/api/scripts/operations.ts from api/openapi. DO NOT EDIT: regenerate with moon run api:generate.

/** Where a parameter travels. */
export type ApiParameterLocation = "path" | "query" | "header" | "cookie";

/** One parameter an operation declares. */
export type ApiParameter = Readonly<{
  name: string;
  in: ApiParameterLocation;
  required: boolean;
}>;

/** One argument of a client function: a path parameter, the body, or the query parameters. */
export type ApiArgument = Readonly<
  | { in: "path"; name: string; required: true }
  | { in: "body" | "query"; required: boolean }
>;

/** One operation of the Zitadel API, as the OpenAPI document declares it. */
export type ApiOperation = Readonly<{
  /** The \`operationId\`, which names the client's function. */
  id: string;
  method: "GET" | "PUT" | "POST" | "DELETE" | "PATCH";
  /** The path template, as the spec writes it: \`/users/{user_id}\`. */
  path: string;
  summary: string;
  /** The first tag, which the API reference groups the operation under. */
  tag: string;
  /**
   * What authenticates it: a project secret as the bearer (\`secret\`), only an
   * end user's session cookie (\`session\`), or nothing (\`none\`).
   */
  auth: "secret" | "session" | "none";
  parameters: readonly ApiParameter[];
  /** Whether it takes a JSON body, and whether the body is required. */
  body: "required" | "optional" | null;
  /**
   * The client function's arguments, in orval's order: path parameters, the
   * body and the query parameters as one object, optional ones last. The
   * request options orval adds after them are not listed.
   */
  arguments: readonly ApiArgument[];
  /**
   * How it pages (ADR 027): whether its \`page_token\` goes in the query or the
   * body, and the response field that holds the page. \`null\` when it does not.
   */
  paging: Readonly<{ token: "query" | "body"; items: string }> | null;
  /** The \`zitadel\` command that runs it (\`x-zitadel-cli\`), if one does. */
  cli: string | null;
}>;

/** Every operation of the API, in the order the spec declares them. */
export const operations: readonly ApiOperation[] = ${JSON.stringify(operations, null, 2)};
`;
}
