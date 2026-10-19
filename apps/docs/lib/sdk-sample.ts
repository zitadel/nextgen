import type { OperationObject, ParameterObject, PathItemObject } from "fumadocs-openapi";
import type { RequestData } from "fumadocs-openapi/requests";

// The API reference's TypeScript sample: the operation called through
// `@zitadel/api`, the client /docs/sdks/api-client documents. The page calls
// it with the request the reader is looking at, the selected example or the
// playground's inputs, as it calls the cURL sample; an operation's Markdown
// and `scripts/sdk-samples.ts`, whose samples `typecheck` compiles against the
// client, call it with the operation's default request (lib/default-request.ts).
//
// The call mirrors what orval generates (packages/api/orval.config.ts): one
// client method per operation, named after its operationId, taking the path
// parameters in the order the path names them, then the body, then an object
// of the query parameters, then fetch options. Header and cookie parameters are
// not arguments; the fetch options carry the headers.

/** The security schemes the spec declares, which pick how the sample authenticates. */
export const securitySchemes = ["oauth2", "nextgenSession"] as const;

/** The server: the spec's is the current origin, its local one localhost:8080. */
const baseUrl = 'process.env.ZITADEL_URL ?? "http://localhost:8080"';

/** The project in the spec's examples. */
const exampleProjectId = "proj_01KWH1P4MYS7F0N9WD3P2E4YM5";

// The browser sets Origin itself and refuses a script that tries to.
const browserHeaders = new Set(["origin"]);

const safeMethods = new Set(["get", "head", "options"]);

// The writes the session cookie authenticates without a CSRF token, as the
// session scheme's description names them: sign-out. (The query reads it
// names accept a project secret, which the sample uses instead.)
const csrfExempt = new Set(["revokeMySession"]);

/** The sample's code. */
export function sdkSample(
  operation: OperationObject,
  path: string,
  pathItem: PathItemObject,
  request: RequestData,
): string {
  const method = clientMethod(operation.operationId ?? "");
  const parameters = operationParameters(operation, pathItem);
  const auth = authentication(operation);
  const csrf = !safeMethods.has(request.method.toLowerCase()) && !csrfExempt.has(method);

  const query = parameters.filter((parameter) => parameter.in === "query");
  const params = queryArguments(query, request);
  const headers = headerArguments(parameters, request);
  const body = resolve<{ required?: boolean }>(operation.requestBody);

  const slots: Slot[] = pathParameterNames(path).map((name) => ({
    value: request.path[name]?.value ?? "",
    required: true,
  }));
  if (body) slots.push({ value: request.body ?? {}, required: body.required === true });
  if (query.length > 0) {
    const required = query.some((parameter) => parameter.required);
    slots.push({
      value: required || Object.keys(params).length > 0 ? params : undefined,
      required,
    });
  }
  slots.push({ value: headers && { headers }, required: false });

  const result = returnsContent(operation) ? `const ${resultName(method)} = ` : "";
  const args = callArguments(slots);
  const lines = [
    ...setup(auth, csrf),
    "",
    `${callExpression(`${result}await client.${method}`, args)};`,
  ];
  return lines.join("\n");
}

interface Slot {
  value: unknown;
  required: boolean;
}

// orval moves the optional arguments after the required ones, as TypeScript
// wants them, so an optional body follows required query parameters. An
// optional argument the call leaves out stays `undefined` while a later one is
// set.
function callArguments(slots: Slot[]): unknown[] {
  const ordered = [
    ...slots.filter((slot) => slot.required),
    ...slots.filter((slot) => !slot.required),
  ];
  let end = ordered.length;
  while (end > 0 && ordered[end - 1]?.required === false && ordered[end - 1]?.value === undefined) {
    end--;
  }
  return ordered.slice(0, end).map((slot) => slot.value);
}

/** The client method of an operation: orval camel-cases the operationId. */
export function clientMethod(operationId: string): string {
  const camel = operationId.replace(
    /[-_\s]+(.)?/g,
    (_, next?: string) => next?.toUpperCase() ?? "",
  );
  return camel.charAt(0).toLowerCase() + camel.slice(1);
}

type Authentication = "none" | "secret" | "session";

// A project secret is the server-side credential: the bearer the oauth2 scheme
// accepts. An operation that accepts only the session cookie is called from
// the browser, through the framework SDK's proxy, which carries the cookie.
function authentication(operation: OperationObject): Authentication {
  const requirements = operation.security ?? [];
  if (requirements.length === 0 || requirements.some((item) => Object.keys(item).length === 0)) {
    return "none";
  }
  return requirements.some((item) => "oauth2" in item) ? "secret" : "session";
}

function setup(auth: Authentication, csrf: boolean): string[] {
  if (auth === "session") {
    return [
      'import { configureZitadel, getApi } from "@zitadel/api/config";',
      ...(csrf ? ['import { setApiCsrfToken } from "@zitadel/api/runtime/auth";'] : []),
      "",
      "// In the browser, through the SDK proxy: the session cookie authenticates the call.",
      `const client = getApi(configureZitadel({ projectId: ${JSON.stringify(exampleProjectId)} }));`,
      ...(csrf
        ? [
            "",
            "// A write the session cookie authenticates carries the session's CSRF token.",
            `setApiCsrfToken((await client.getMySessionCsrfToken({ project_id: ${JSON.stringify(exampleProjectId)} })).csrf_token);`,
          ]
        : []),
    ];
  }

  return [
    'import { createZitadelClient } from "@zitadel/api/client";',
    "",
    "const client = createZitadelClient({",
    `  baseUrl: ${baseUrl},`,
    ...(auth === "secret"
      ? ["  token: process.env.ZITADEL_PROJECT_SECRET!, // server-side only"]
      : []),
    "});",
  ];
}

/**
 * Fumadocs hands out the document behind a magic proxy: a Reference Object
 * stays in place, and its `$ref-value` is the object it points to.
 * `withRefValues()` (lib/default-request.ts) gives a plain document the same.
 */
export function resolve<T>(node: unknown): T | undefined {
  let current = node;
  for (let depth = 0; isReference(current) && depth < 32; depth++) {
    current = current["$ref-value"];
  }
  return current as T | undefined;
}

function isReference(node: unknown): node is { $ref: string; "$ref-value"?: unknown } {
  return (
    typeof node === "object" &&
    node !== null &&
    typeof (node as { $ref?: unknown }).$ref === "string"
  );
}

/** The parameters of an operation; an operation's own replaces the path's of the same name. */
export function operationParameters(
  operation: OperationObject,
  pathItem: PathItemObject,
): ParameterObject[] {
  const parameters: ParameterObject[] = [];
  const seen = new Set<string>();
  for (const item of [...(operation.parameters ?? []), ...(pathItem.parameters ?? [])]) {
    const parameter = resolve<ParameterObject>(item);
    if (!parameter || seen.has(`${parameter.in}:${parameter.name}`)) continue;
    seen.add(`${parameter.in}:${parameter.name}`);
    parameters.push(parameter);
  }
  return parameters;
}

/** The path parameters, in the order the path names them. */
export function pathParameterNames(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "");
}

interface Schema {
  type?: string | string[];
  items?: unknown;
}

// The request carries query values encoded as strings; the client takes them
// typed, as the parameters' schemas give them.
function queryArguments(query: ParameterObject[], request: RequestData): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const { name, schema: raw, explode } of query) {
    const values = name === undefined ? undefined : request.query[name]?.values;
    if (name === undefined || !values || values.length === 0) continue;
    const schema = resolve<Schema>(raw);
    if (schemaType(schema) === "array") {
      const items = resolve<Schema>(schema?.items);
      const all: unknown[] =
        explode === false ? values.flatMap((value) => String(value).split(",")) : values;
      params[name] = all.map((value) => typed(items, value));
    } else {
      params[name] = typed(schema, values[0]);
    }
  }
  return params;
}

function typed(schema: Schema | undefined, value: unknown): unknown {
  switch (schemaType(schema)) {
    case "integer":
    case "number": {
      const number = Number(value);
      return Number.isNaN(number) ? value : number;
    }
    case "boolean":
      return value === true || value === "true";
    default:
      return typeof value === "string" ? value : String(value);
  }
}

function schemaType(schema: Schema | undefined): string | undefined {
  const type = schema?.type;
  return Array.isArray(type) ? type.find((item) => item !== "null") : type;
}

function headerArguments(
  parameters: ParameterObject[],
  request: RequestData,
): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const { in: location, name } of parameters) {
    if (location !== "header" || name === undefined || browserHeaders.has(name.toLowerCase())) {
      continue;
    }
    const value = request.header[name]?.value;
    if (value !== undefined) headers[name] = value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function returnsContent(operation: OperationObject): boolean {
  return Object.entries(operation.responses ?? {}).some(([status, item]) => {
    if (!status.startsWith("2")) return false;
    const response = resolve<{ content?: Record<string, unknown> }>(item);
    return Object.keys(response?.content ?? {}).length > 0;
  });
}

const verbs =
  /^(?:add|begin|build|complete|create|delete|exchange|finish|get|init|issue|list|patch|query|remove|revoke|rollback|set|submit|update|verify)(?=[A-Z])/;

// What the call returns, named after the operation: getUserByID's is `user`.
function resultName(method: string): string {
  const noun = method.replace(verbs, "").replace(/By[A-Z][A-Za-z]*$/, "");
  if (noun === method || noun === "") return "result";
  const name = noun.charAt(0).toLowerCase() + noun.slice(1);
  return name === "client" ? "result" : name;
}

/** The call, laid out as a formatter lays it out in 80 columns. */
function callExpression(callee: string, args: unknown[]): string {
  const flat = args.map((arg) => literal(arg, ""));
  const call = `${callee}(${flat.join(", ")})`;
  if (!call.includes("\n") && call.length <= 80) return call;

  // Only the last argument breaks: it hugs the call.
  const head = flat.slice(0, -1);
  if (head.every((arg) => !arg.includes("\n")) && `${callee}(${head.join(", ")}`.length <= 72) {
    return call;
  }

  return `${callee}(\n${args.map((arg) => `  ${literal(arg, "  ")},`).join("\n")}\n)`;
}

/** A value as TypeScript source: objects and arrays inline while short, else one entry a line. */
function literal(value: unknown, indent: string): string {
  if (value === undefined) return "undefined";
  if (typeof value !== "object" || value === null) return JSON.stringify(value);

  const array = Array.isArray(value);
  const entries: [string | undefined, unknown][] = array
    ? value.map((item): [undefined, unknown] => [undefined, item])
    : Object.entries(value);
  if (entries.length === 0) return array ? "[]" : "{}";

  const entry = ([key, item]: [string | undefined, unknown], at: string) =>
    `${key === undefined ? "" : `${propertyName(key)}: `}${literal(item, at)}`;
  const inline = entries.map((item) => entry(item, indent)).join(", ");
  const flat = array ? `[${inline}]` : `{ ${inline} }`;
  if (!flat.includes("\n") && indent.length + flat.length <= 60) return flat;

  const inner = `${indent}  `;
  const lines = entries.map((item) => `${inner}${entry(item, inner)},`);
  return `${array ? "[" : "{"}\n${lines.join("\n")}\n${indent}${array ? "]" : "}"}`;
}

function propertyName(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}
