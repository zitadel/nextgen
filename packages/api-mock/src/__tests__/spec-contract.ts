/**
 * The OpenAPI contract as the conformance spec checks the mock against it.
 *
 * Every operation, status and response schema comes from the bundled spec the
 * server's `generate` writes (`apps/api/api/openapi/bundled/openapi.json`);
 * success bodies are parsed with the zod schemas orval generates from the same
 * source. Nothing here restates a schema.
 *
 * - A success status must be one the operation declares; an error status may
 *   also fall to the operation's `4XX`/`5XX` or `default` response.
 * - A success body that orval has a zod schema for is parsed with it; any
 *   other body is validated against the spec's JSON Schema.
 * - An error body's `code` must be one the operation declares: its `default`
 *   response's error set, which `gen_openapi_errors` derives from what the
 *   implementation returns, or a code the matched status's schema fixes.
 */
import { readFileSync } from "node:fs";

import * as generated from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { API_PREFIX } from "@zitadel/api/runtime/base-url";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { ZodType } from "zod";

import { SPEC_GAPS } from "./spec-exceptions.js";

type Schema = Record<string, unknown>;
type ResponseObject = { $ref?: string; content?: Record<string, { schema?: Schema }> };
type OperationObject = { operationId: string; responses: Record<string, ResponseObject> };
type OpenApiDocument = {
  paths: Record<string, Record<string, OperationObject>>;
  components: { responses: Record<string, ResponseObject>; schemas: Record<string, Schema> };
};

const SPEC_URL = new URL("../../../../apps/api/api/openapi/bundled/openapi.json", import.meta.url);
const doc = JSON.parse(readFileSync(SPEC_URL, "utf8")) as OpenApiDocument;

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
ajv.addSchema(doc as unknown as Schema, "openapi");

const METHODS = ["get", "put", "post", "patch", "delete"] as const;

/** A path template with its parameter names dropped: `/projects/{}/origins`. */
export function templateKey(path: string): string {
  return path.replace(/\{[^}]+\}|:[^/]+/g, "{}");
}

export type SpecOperation = {
  id: string;
  method: string;
  path: string;
  /** Matches a concrete path (without the API prefix). */
  pattern: RegExp;
  /** Literal segments, so `/sessions/me` wins over `/sessions/{session_id}`. */
  literals: number;
  responses: Record<string, ResponseObject>;
};

function patternOf(path: string): RegExp {
  const source = templateKey(path)
    .split("{}")
    .map((part) => part.replace(/[.*+?^$()|[\]\\]/g, "\\$&"))
    .join("[^/]+");
  return new RegExp(`^${source}$`);
}

function literalsOf(path: string): number {
  return path.split("/").filter((segment) => segment && !/^(\{.*\}|:.*)$/.test(segment)).length;
}

export const specOperations: readonly SpecOperation[] = Object.entries(doc.paths).flatMap(
  ([path, item]) =>
    METHODS.flatMap((method) => {
      const op = item[method];
      return op
        ? [
            {
              id: op.operationId,
              method: method.toUpperCase(),
              path,
              pattern: patternOf(path),
              literals: literalsOf(path),
              responses: op.responses,
            },
          ]
        : [];
    }),
);

/** A concrete request path as the spec writes it: the API prefix stripped. */
export function specPath(pathname: string): string {
  return pathname.startsWith(`${API_PREFIX}/`) ? pathname.slice(API_PREFIX.length) : pathname;
}

/** The operation a request reaches, preferring the template with more literal segments. */
export function findOperation(method: string, pathname: string): SpecOperation | undefined {
  const path = specPath(pathname);
  return specOperations
    .filter((op) => op.method === method.toUpperCase() && op.pattern.test(path))
    .sort((a, b) => b.literals - a.literals)[0];
}

function resolve(response: ResponseObject): ResponseObject {
  const ref = response.$ref;
  if (!ref) return response;
  const name = ref.replace("#/components/responses/", "");
  const target = doc.components.responses[name];
  if (!target) throw new Error(`unresolved response ${ref}`);
  return resolve(target);
}

function deref(schema: Schema | undefined): Schema | undefined {
  const ref = schema?.$ref;
  if (typeof ref !== "string") return schema;
  return deref(doc.components.schemas[ref.replace("#/components/schemas/", "")]);
}

/** Every `code` const a schema pins, through `$ref`, `allOf`, `oneOf` and `anyOf`. */
function pinnedCodes(schema: Schema | undefined, into = new Set<string>()): Set<string> {
  const resolved = deref(schema);
  if (!resolved) return into;
  const code = (resolved.properties as Record<string, Schema> | undefined)?.code;
  if (code && typeof code.const === "string") into.add(code.const);
  for (const key of ["allOf", "oneOf", "anyOf"]) {
    for (const branch of (resolved[key] as Schema[] | undefined) ?? []) pinnedCodes(branch, into);
  }
  return into;
}

function jsonSchema(response: ResponseObject): Schema | undefined {
  return response.content?.["application/json"]?.schema;
}

const inlineValidators = new Map<Schema, ValidateFunction>();

/**
 * A validator for a response schema. A `$ref` is looked up in the registered
 * document; an inline schema (a `oneOf` error set) is compiled once, with its
 * `#/components` refs pointed at the document.
 */
function validatorFor(schema: Schema): ValidateFunction | undefined {
  const ref = schema.$ref;
  if (typeof ref === "string" && ref.startsWith("#/")) return ajv.getSchema(`openapi${ref}`);
  let validate = inlineValidators.get(schema);
  if (!validate) {
    const rebased = JSON.parse(
      JSON.stringify(schema).replaceAll('"$ref":"#/', '"$ref":"openapi#/'),
    ) as Schema;
    validate = ajv.compile(rebased);
    inlineValidators.set(schema, validate);
  }
  return validate;
}

function schemaErrors(schema: Schema, body: unknown): string[] {
  const validate = validatorFor(schema);
  if (!validate) return [`no validator for ${JSON.stringify(schema).slice(0, 80)}`];
  if (validate(body)) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
}

function pascal(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** orval's zod schema for an operation's (first) success body. */
export function zodResponse(op: SpecOperation): ZodType | undefined {
  return (generated as unknown as Record<string, ZodType | undefined>)[`${pascal(op.id)}Response`];
}

function firstSuccess(op: SpecOperation): string | undefined {
  return Object.keys(op.responses).find((status) => status.startsWith("2"));
}

/** The declared response a status answers under, or `undefined` if none covers it. */
function declaredResponse(op: SpecOperation, status: number): ResponseObject | undefined {
  const exact = op.responses[String(status)];
  if (exact) return resolve(exact);
  if (status < 400) return undefined;
  const range = op.responses[`${String(status).charAt(0)}XX`];
  if (range) return resolve(range);
  const fallback = op.responses.default;
  return fallback ? resolve(fallback) : undefined;
}

/** The error codes an operation declares, across its `default` and explicit error statuses. */
export function declaredCodes(op: SpecOperation, status: number): Set<string> {
  const codes = new Set<string>();
  const fallback = op.responses.default;
  if (fallback) pinnedCodes(jsonSchema(resolve(fallback)), codes);
  const matched = declaredResponse(op, status);
  if (matched) pinnedCodes(jsonSchema(matched), codes);
  return codes;
}

/** The `SPEC_GAPS` entries an answer needed, so a gap the spec has closed shows as unused. */
export const usedGaps = new Set<string>();

export type Exchange = { status: number; contentType: string | null; text: string };

/**
 * What is wrong with one response to an operation, as a list of sentences.
 * Empty when it conforms.
 */
export function violations(op: SpecOperation, exchange: Exchange): string[] {
  const { status, contentType, text } = exchange;
  const where = `${op.method} ${op.path} (${op.id}) → ${status}`;
  const declared = declaredResponse(op, status);
  if (!declared) {
    return [`${where}: status not declared (declares ${Object.keys(op.responses).join(", ")})`];
  }
  const schema = jsonSchema(declared);
  if (!declared.content) {
    return text === "" ? [] : [`${where}: declares no body, got ${text.slice(0, 120)}`];
  }
  if (!schema) return [];
  if (!contentType?.includes("application/json")) {
    return [`${where}: declares application/json, got ${contentType ?? "no content type"}`];
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return [`${where}: body is not JSON: ${text.slice(0, 120)}`];
  }

  if (status < 400) {
    const first = firstSuccess(op);
    const zod = zodResponse(op);
    const sameSchema =
      first !== undefined &&
      JSON.stringify(jsonSchema(resolve(op.responses[first] as ResponseObject))) ===
        JSON.stringify(schema);
    if (zod && sameSchema) {
      const parsed = zod.safeParse(body);
      return parsed.success
        ? []
        : parsed.error.issues.map(
            (issue) => `${where}: ${issue.path.join(".") || "/"} ${issue.message}`,
          );
    }
    return schemaErrors(schema, body).map((e) => `${where}: ${e}`);
  }

  let problems = schemaErrors(schema, body).map((e) => `${where}: ${e}`);
  const fallback = op.responses.default;
  const fallbackSchema = fallback ? jsonSchema(resolve(fallback)) : undefined;
  const gap = `${op.id} ${status}`;
  if (problems.length > 0 && gap in SPEC_GAPS && fallbackSchema) {
    problems = schemaErrors(fallbackSchema, body).map((e) => `${where}: ${e}`);
    if (problems.length === 0) usedGaps.add(gap);
  }
  const code = (body as { code?: unknown }).code;
  const codes = declaredCodes(op, status);
  if (typeof code === "string" && codes.size > 0 && !codes.has(code)) {
    // The schema's own errors would only list every branch the code missed.
    return [`${where}: code ${code} is not one ${op.id} declares (${[...codes].join(", ")})`];
  }
  return problems;
}
