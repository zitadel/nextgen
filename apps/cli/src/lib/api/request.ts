import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";

import * as schemas from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { apiBaseUrl } from "@zitadel/api/runtime/base-url";

import { ZitadelError } from "../errors";
import { holdsNull, parseJsonObject } from "../json";
import { fragmentOf, readAssignment } from "../oclif/crud/assign";
import { mergeDocuments, typedValue } from "../oclif/crud/document";
import { describeBody } from "../oclif/crud/fields";
import type { Schema } from "../oclif/crud/types";
import { nodeAt, unwrap, type ZodLike } from "../oclif/crud/zod";
import { type ApiOperation, pathParameterNames, type Target } from "./operations";

/** The flag a field is given with, which errors name. */
const FIELD = "--field";

/** One request to the API, before the server and the credential are added. */
export type ApiRequest = Readonly<{
  operation: ApiOperation;
  /** The path with its parameters filled in, without the query string. */
  path: string;
  /** The query string's entries, in order; a list parameter repeats its name. */
  query: readonly (readonly [string, string])[];
  /** The JSON body, when the request has one. */
  body?: unknown;
}>;

/**
 * Whether sending `request` deletes, revokes or rolls back something: an
 * operation the spec marks destructive, or a merge patch whose body holds a
 * `null`, which removes what it names.
 */
export const isDestructive = (request: ApiRequest): boolean =>
  request.operation.destructive || (request.operation.removesWithNull && holdsNull(request.body));

/** The URL a request goes to on `server`: the API under `/api/v1` there, then the spec's path. */
export const urlOf = (server: string, request: ApiRequest): string => {
  const query = new URLSearchParams(
    request.query.map(([name, value]) => [name, value] as [string, string]),
  );
  const search = query.size > 0 ? `?${query}` : "";
  return `${apiBaseUrl(server)}${request.path}${search}`;
};

/**
 * The generated Zod schema for one part of an operation's request:
 * `QueryUsersBody`, `ListEventsQueryParams`. orval names them after the
 * `operationId` with its first letter raised.
 */
export const schemaOf = (
  operation: ApiOperation,
  part: "Body" | "QueryParams",
): ZodLike | undefined => {
  const name = `${operation.id.charAt(0).toUpperCase()}${operation.id.slice(1)}${part}`;
  return Object.hasOwn(schemas, name)
    ? ((schemas as Record<string, unknown>)[name] as ZodLike)
    : undefined;
};

/** Path parameter values read so far, and the names still without one. */
export type PathValues = Readonly<{
  values: Readonly<Record<string, string>>;
  missing: readonly string[];
}>;

/**
 * Fill an operation's path parameters: from the path itself when the target
 * was a path, else from the positionals in path order. A `project_id` still
 * missing is the CLI's own project, as the resource commands take it.
 */
export const pathValuesOf = (
  target: Target,
  positionals: readonly string[],
  projectId: string | undefined,
): PathValues => {
  const names = pathParameterNames(target.operation);
  const fromPath = Object.keys(target.pathValues).length > 0;
  if (positionals.length > 0 && (fromPath || names.length === 0)) {
    throw new ZitadelError(
      "E_VALIDATION",
      names.length === 0
        ? `${target.operation.id} takes no path parameters, but got ${positionals.join(" ")}`
        : `The path already names ${names.join(", ")}, so ${positionals.join(" ")} is one argument too many`,
      { hint: "Give a path parameter either in the path or as an argument after an operation id." },
    );
  }
  if (positionals.length > names.length) {
    throw new ZitadelError(
      "E_VALIDATION",
      `${target.operation.id} takes ${names.length} path parameter${names.length === 1 ? "" : "s"} (${names.join(", ")}), but got ${positionals.length}`,
      { hint: `Give them in the path's order: ${target.operation.path}.` },
    );
  }
  const values: Record<string, string> = { ...target.pathValues };
  for (const [index, value] of positionals.entries()) {
    const name = names[index];
    if (name !== undefined) {
      values[name] = value;
    }
  }
  if (values.project_id === undefined && names.includes("project_id") && projectId) {
    values.project_id = projectId;
  }
  return { values, missing: names.filter((name) => values[name] === undefined) };
};

/** What a request is built from, once every path parameter has a value. */
export type RequestInput = Readonly<{
  target: Target;
  pathValues: Readonly<Record<string, string>>;
  /** `--field` entries, in the order given. */
  fields: readonly string[];
  /** The `--input` document, when one was given. */
  input?: Readonly<Record<string, unknown>>;
  /** The CLI's project, for a required `project_id` the caller leaves out. */
  projectId?: string;
}>;

/** The first segment of a field's name: `idp` for `idp.oidc.issuer=…`. */
const headOf = (raw: string): string => {
  const at = raw.indexOf("=");
  const name = at === -1 ? raw : raw.slice(0, raw[at - 1] === ":" ? at - 1 : at);
  return name.split(".")[0] ?? "";
};

/** A query parameter's value as the URL carries it: a list repeats the name. */
const queryValues = (name: string, value: unknown): readonly string[] => {
  const values = Array.isArray(value) ? value : [value];
  if (values.some((item) => item === null || typeof item === "object")) {
    throw new ZitadelError(
      "E_VALIDATION",
      `${FIELD} ${name} is a query parameter, which takes a value or a list of values`,
      {
        hint: `Give it as ${FIELD} ${name}=value, or a list as ${FIELD} '${name}:=["a","b"]'.`,
      },
    );
  }
  return values.map(String);
};

/**
 * One query field's values. A list parameter takes one value per field, as a
 * query string repeats its name (`-F category=auth -F category=session`), or
 * the whole list as JSON; any other takes its one value.
 */
const queryField = (raw: string, name: string, schema: ZodLike | undefined) => {
  const node = nodeAt(schema, [name])?.node;
  const type = unwrap(node);
  if (type?.def?.type !== "array" || raw.startsWith(`${name}:=`)) {
    return { list: false, values: queryValues(name, readAssignment(raw, schema, [], FIELD).value) };
  }
  const text = raw.slice(name.length + 1);
  return {
    list: true,
    values: queryValues(name, typedValue(type.def.element, text, `${FIELD} ${name}`)),
  };
};

/**
 * Build the request: the path filled in, the query, and the body.
 *
 * A field whose name the operation declares as a query parameter sets that
 * parameter; every other field is a dot path into the body, laid over
 * `--input`. Each is typed by the operation's generated schema, as `--set` is
 * on the resource commands. A body the operation requires but nothing gave is
 * `{}`, the empty document.
 */
export const buildRequest = ({
  target,
  pathValues,
  fields,
  input,
  projectId,
}: RequestInput): ApiRequest => {
  const { operation } = target;
  const query = new Map<string, readonly string[]>();
  for (const [name, value] of target.query) {
    query.set(name, [...(query.get(name) ?? []), value]);
  }
  if (input !== undefined && operation.body === null) {
    throw new ZitadelError("E_VALIDATION", `${operation.id} takes no body, but --input gave one`, {
      hint: "Leave out --input.",
    });
  }

  let body: unknown = input ?? (operation.body === "required" ? {} : undefined);
  const given = new Set<string>();
  const bodySchema = schemaOf(operation, "Body");
  for (const raw of fields) {
    const head = headOf(raw);
    const parameter = operation.parameters.find((candidate) => candidate.name === head);
    if (parameter?.in === "query") {
      if (!/^[^.]+:?=/.test(raw)) {
        throw new ZitadelError(
          "E_VALIDATION",
          `${FIELD} ${head} is a query parameter, which has no fields`,
          {
            hint: `Give it as ${FIELD} ${head}=value.`,
          },
        );
      }
      const { list, values } = queryField(raw, head, schemaOf(operation, "QueryParams"));
      // The first field for a name replaces what the path's query string
      // said; a list's further fields add to it.
      query.set(head, list && given.has(head) ? [...(query.get(head) ?? []), ...values] : values);
      given.add(head);
      continue;
    }
    if (parameter) {
      throw new ZitadelError(
        "E_VALIDATION",
        parameter.in === "path"
          ? `${head} is a path parameter of ${operation.id}; give it as an argument`
          : `${head} is a ${parameter.in} parameter, which the CLI does not send`,
        parameter.in === "path"
          ? { hint: `For example: zitadel api ${operation.id} <${head}>` }
          : {},
      );
    }
    if (operation.body === null) {
      const names = operation.parameters
        .filter((candidate) => candidate.in === "query")
        .map((candidate) => candidate.name);
      throw new ZitadelError(
        "E_VALIDATION",
        `${operation.id} takes no body, and ${head} is none of its query parameters`,
        {
          hint:
            names.length > 0
              ? `Its query parameters: ${names.join(", ")}.`
              : `${operation.id} takes no fields.`,
          details: { field: head, query_parameters: names },
        },
      );
    }
    const assignment = readAssignment(raw, bodySchema, bodyFields(bodySchema), FIELD);
    body = mergeDocuments(body ?? {}, fragmentOf(assignment));
  }

  const projectParameter = operation.parameters.find(
    (candidate) => candidate.in === "query" && candidate.name === "project_id",
  );
  if (projectParameter?.required && !query.has("project_id") && projectId) {
    query.set("project_id", [projectId]);
  }

  return {
    operation,
    path: operation.path.replace(/\{([^}]+)\}/g, (_, name: string) =>
      encodeURIComponent(pathValues[name] ?? ""),
    ),
    query: [...query].flatMap(([name, values]) => values.map((value) => [name, value] as const)),
    ...(body === undefined ? {} : { body }),
  };
};

/**
 * The body's fields, for an error that names the ones a path could have
 * meant. Without their flags: those belong to the resource commands.
 */
const bodyFields = (schema: ZodLike | undefined) =>
  schema === undefined
    ? []
    : describeBody(schema as Schema).map(({ flag: _flag, ...field }) => field);

/**
 * The `--input` document: a file, or stdin with `-`. Reading a terminal to its
 * end would look like a hang, so `-` with nothing piped in is refused.
 */
export const readInput = async (
  source: string | undefined,
): Promise<Readonly<Record<string, unknown>> | undefined> => {
  if (source === undefined) {
    return undefined;
  }
  if (source === "-") {
    if (process.stdin.isTTY) {
      throw new ZitadelError(
        "E_VALIDATION",
        "--input - reads the body from a pipe, but nothing is piped in",
        {
          hint: "Pipe a body in (`cat body.json | zitadel api … --input -`), or pass --input <path>.",
        },
      );
    }
    return parseJsonObject(await text(process.stdin), "stdin");
  }
  return parseJsonObject(await readFile(source, "utf8"), source);
};
