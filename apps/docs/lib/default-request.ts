import { sample } from "@fumadocs/json-schema";
import type {
  HttpMethods,
  OperationObject,
  ParameterObject,
  PathItemObject,
} from "fumadocs-openapi";
import {
  encodeRequestData,
  type RawRequestData,
  type RequestData,
} from "fumadocs-openapi/requests";

import { operationParameters, resolve } from "./sdk-sample.ts";

// The request an operation's page shows before the reader picks an example or
// edits the playground, built as fumadocs-openapi builds it
// (getExampleRequests() in 12.5): the first example of the body, else a body
// sampled from its schema with Fumadocs' own sampler; the parameters' examples,
// else sampled values for the required ones. An operation's Markdown and the
// check of the TypeScript samples use it where no page is rendered.

/**
 * The document as Fumadocs reads it: every Reference Object resolves through
 * `$ref-value`, as behind the magic proxy the page wraps the document in.
 * Fumadocs' sampler and lib/sdk-sample.ts resolve references that way.
 */
export function withRefValues<T extends object>(document: T): T {
  const root = structuredClone(document);
  const seen = new WeakSet<object>();
  const visit = (node: unknown) => {
    if (typeof node !== "object" || node === null || seen.has(node)) return;
    seen.add(node);
    const ref = (node as { $ref?: unknown }).$ref;
    if (typeof ref === "string" && ref.startsWith("#/")) {
      // Enumerable, as the proxy reports it: the sampler copies schemas with
      // spreads, and a copy keeps resolving.
      Object.defineProperty(node, "$ref-value", {
        get: () => pointer(root, ref),
        enumerable: true,
      });
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(root);
  return root;
}

function pointer(root: unknown, ref: string): unknown {
  return ref
    .slice(2)
    .split("/")
    .map((segment) => decodeURIComponent(segment).replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], root);
}

/** The default request of an operation of a document from {@link withRefValues}. */
export function defaultRequest(
  operation: OperationObject,
  pathItem: PathItemObject,
  method: HttpMethods,
): RequestData {
  const parameters = operationParameters(operation, pathItem);
  const raw: RawRequestData = { method, path: {}, query: {}, header: {}, cookie: {} };

  for (const parameter of parameters) {
    if (parameter.name === undefined) continue;
    let value = parameterExample(parameter);
    if (value === undefined && parameter.required && parameter.schema) {
      value = sample(parameter.schema as Schema);
    }
    raw[location(parameter)][parameter.name] = value;
  }

  const body = resolve<{ content?: Record<string, unknown> }>(operation.requestBody);
  if (body?.content) {
    const type =
      "application/json" in body.content ? "application/json" : Object.keys(body.content)[0];
    const media = type ? resolve<MediaType>(body.content[type]) : undefined;
    if (type && media) {
      raw.bodyMediaType = type;
      const [first] = Object.values(media.examples ?? {});
      if (first !== undefined) {
        raw.body = exampleValue(first);
      } else if (media.example !== undefined) {
        raw.body = media.example;
      } else {
        raw.body = sample(media.schema ?? {}, {
          skipReadOnly: method !== "get",
          skipWriteOnly: method === "get",
          skipNonRequired: true,
        });
      }
    }
  }

  return encodeRequestData(raw, {}, parameters);
}

interface MediaType {
  example?: unknown;
  examples?: Record<string, unknown>;
  schema?: Schema;
}

type Schema = Parameters<typeof sample>[0];

function location(parameter: ParameterObject): "path" | "query" | "header" | "cookie" {
  return parameter.in === "query" || parameter.in === "header" || parameter.in === "cookie"
    ? parameter.in
    : "path";
}

function parameterExample(parameter: ParameterObject): unknown {
  if (parameter.example !== undefined) return parameter.example;
  const [first] = Object.values(parameter.examples ?? {});
  return first === undefined ? undefined : exampleValue(first);
}

function exampleValue(example: unknown): unknown {
  const resolved = resolve<{ value?: unknown; dataValue?: unknown }>(example);
  return resolved?.dataValue ?? resolved?.value;
}
