import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle, loadConfig } from "@redocly/openapi-core";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const input = resolve(repoRoot, "api/openapi/openapi-spec.yaml");
const output = resolve(packageRoot, "src/generated/operations.ts");
const pagingOutput = resolve(packageRoot, "src/generated/paging.ts");
const endpointsOutput = resolve(packageRoot, "src/generated/endpoints/zitadelNextGen.ts");

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
  "x-zitadel-destructive"?: unknown;
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
  await writeFile(pagingOutput, pagingSource(operations, await readFile(endpointsOutput, "utf8")));
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
    paging: paging(
      parameters,
      body?.content?.["application/json"]?.schema,
      successSchema(operation),
    ),
    cli: typeof operation["x-zitadel-cli"] === "string" ? operation["x-zitadel-cli"] : null,
    // Every DELETE removes something; any other method says so itself.
    destructive: method === "delete" || operation["x-zitadel-destructive"] === true,
    // A merge-patch null removes the name it sits under (RFC 7386), so such a
    // request is destructive only when its body holds one.
    removesWithNull: operation["x-zitadel-destructive"] === "null-removes",
  };
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
  const [items, ...others] = lists;
  return items !== undefined && others.length === 0 ? { token, items } : null;
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

/** The name orval gives an operation's function: its id, first letter lowercased. */
const functionName = (id: string): string => id.charAt(0).toLowerCase() + id.slice(1);

/**
 * The parameters of the generated function that pages, by name, read from the
 * signature orval wrote for it in `endpoints`, and which of them carries
 * `page_token`: the body for a token the body carries, the query parameters
 * otherwise.
 */
export function pagingParameters(
  endpoints: string,
  operation: Pick<ReturnType<typeof operationOf>, "id" | "paging">,
): { names: string[]; carrier: string } {
  const head = `export const ${functionName(operation.id)} = async (`;
  const start = endpoints.indexOf(head);
  if (start === -1) {
    throw new Error(`${operation.id} has no generated function`);
  }
  // The parameter names, read to the bracket that closes the list. A comma
  // inside a bracket a type opens (a function, tuple, object or generic type)
  // separates no parameter; the `>` of an arrow `=>` closes nothing.
  const names: string[] = [];
  let depth = 0;
  let from = start + head.length;
  for (let at = from; ; at += 1) {
    const char = endpoints[at];
    if (char === undefined) {
      throw new Error(`${operation.id} has an unterminated parameter list`);
    }
    if (depth === 0 && (char === "," || char === ")")) {
      names.push(endpoints.slice(from, at).trim().split(/\??:/)[0] ?? "");
      from = at + 1;
      if (char === ")") {
        break;
      }
      continue;
    }
    const arrow = char === ">" && endpoints[at - 1] === "=";
    depth += "([{<".includes(char) ? 1 : ")]}>".includes(char) && !arrow ? -1 : 0;
  }
  const carrier = names.find((parameter) =>
    operation.paging?.token === "body" ? parameter.endsWith("Body") : parameter === "params",
  );
  if (carrier === undefined) {
    throw new Error(`${operation.id} has no argument to carry its page_token`);
  }
  return { names, carrier };
}

/**
 * The source of `src/generated/paging.ts`: for each operation that pages, typed
 * readers of a page's items and cursor, and the arguments of its next page.
 */
export function pagingSource(
  operations: readonly Pick<ReturnType<typeof operationOf>, "id" | "paging">[],
  endpoints: string,
): string {
  const field = (name: string) =>
    /^[A-Za-z_$][\w$]*$/.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
  // Keyed by the function's name, which is what the client is called by.
  const entries = operations.flatMap((operation) => {
    if (!operation.paging) {
      return [];
    }
    const name = functionName(operation.id);
    // The next page's arguments are the caller's with `page_token` set on the
    // one that carries it, typed by the function's own parameters, so a token
    // put anywhere the function does not take one fails to compile.
    const { names, carrier } = pagingParameters(endpoints, operation);
    const next = names.map((parameter) =>
      parameter === carrier ? `{ ...${parameter}, page_token }` : parameter,
    );
    return [
      `  ${name}: {
    items: (page: Page<"${name}">) => page${field(operation.paging.items)},
    next: (page: Page<"${name}">) => page.next_page_token,
    withToken: ([${names.join(", ")}]: Parameters<(typeof endpoints)["${name}"]>, page_token: string): Parameters<(typeof endpoints)["${name}"]> => [${next.join(", ")}],
  },`,
    ];
  });
  return `// Code generated by packages/api/scripts/operations.ts from api/openapi. DO NOT EDIT: regenerate with moon run api:generate.

import type * as endpoints from "./endpoints/zitadelNextGen";

type Page<K extends keyof typeof endpoints> = Awaited<ReturnType<(typeof endpoints)[K]>>;

/**
 * The client functions that page (ADR 027), by name: a page's items and its
 * cursor to the next one, each read off the page as the function's response
 * type declares them, and the arguments that fetch the page a cursor names.
 */
export const paging = {
${entries.join("\n")}
} as const;
`;
}

function source(
  operations: readonly { id: string; destructive: boolean; removesWithNull: boolean }[],
): string {
  // The client's function names, which the typecheck holds to the generated
  // endpoints, so a name the client lacks fails the build.
  const destructive = operations
    .filter((operation) => operation.destructive)
    .map(({ id }) => functionName(id));
  const removingWithNull = operations
    .filter((operation) => operation.removesWithNull)
    .map(({ id }) => functionName(id));
  return `// Code generated by packages/api/scripts/operations.ts from api/openapi. DO NOT EDIT: regenerate with moon run api:generate.

import type * as endpoints from "./endpoints/zitadelNextGen";

/** Where a parameter travels. */
export type ApiParameterLocation = "path" | "query" | "header" | "cookie";

/** One parameter an operation declares. */
export type ApiParameter = Readonly<{
  name: string;
  in: ApiParameterLocation;
  required: boolean;
}>;

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
   * How it pages (ADR 027): whether its \`page_token\` goes in the query or the
   * body, and the response field that holds the page. \`null\` when it does not.
   */
  paging: Readonly<{ token: "query" | "body"; items: string }> | null;
  /** The \`zitadel\` command that runs it (\`x-zitadel-cli\`), if one does. */
  cli: string | null;
  /**
   * Whether it removes, revokes or rolls back something: every \`DELETE\`, and
   * any other operation that sets \`x-zitadel-destructive\`.
   */
  destructive: boolean;
  /**
   * Whether a \`null\` in its body removes what it names (RFC 7386), which
   * makes that one request destructive: \`x-zitadel-destructive: null-removes\`.
   */
  removesWithNull: boolean;
}>;

/** Every operation of the API, in the order the spec declares them. */
export const operations: readonly ApiOperation[] = ${JSON.stringify(operations, null, 2)};

/** The client functions that run a destructive operation, to narrow the client by. */
export const destructiveOperations = ${JSON.stringify(destructive, null, 2)} as const satisfies readonly (keyof typeof endpoints)[];

/** The name of a client function that runs a destructive operation. */
export type DestructiveOperation = (typeof destructiveOperations)[number];

/** The client functions whose request is destructive when its body holds a \`null\`. */
export const nullRemovingOperations = ${JSON.stringify(removingWithNull, null, 2)} as const satisfies readonly (keyof typeof endpoints)[];
`;
}
