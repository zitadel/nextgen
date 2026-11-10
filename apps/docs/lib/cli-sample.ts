import type { OperationObject, PathItemObject } from "fumadocs-openapi";
import type { RequestData } from "fumadocs-openapi/requests";

import { authentication, operationParameters, pathParameterNames } from "./sdk-sample.ts";

// The API reference's CLI sample: the `zitadel` command that runs the
// operation, which the spec names in the operation's `x-zitadel-cli`. The CLI's
// api-coverage test keeps every name pointed at a command that calls the
// operation. An operation no command covers runs through `zitadel api`, by its
// operationId. Like the TypeScript sample, the page builds it from the request
// the reader is looking at, an operation's Markdown from its default request.
//
// The CLI acts on the project its directory was set up for, so `project_id`
// never appears. The path parameter is the command's positional, a write's
// body goes in `--data`, and a list's query becomes its flags. The variable
// commands are shown only for a request they do exactly (`variableCommand`);
// any other variable request is the `zitadel api` call.

export const cli = "npx @zitadel/cli@latest";

/** What the CLI needs before it runs a resource command. */
const context = "# Run where `zitadel setup` wrote .zitadel/secret.";

/** The command the spec names for an operation, without the binary: `users create`. */
export function namedCliCommand(operation: OperationObject): string | undefined {
  const command: unknown = (operation as Record<string, unknown>)["x-zitadel-cli"];
  return typeof command === "string" ? command : undefined;
}

/**
 * The command that runs an operation, without the binary: the one the spec
 * names (`users create`), else `api` for one `zitadel api` can call.
 */
export function cliCommand(
  operation: OperationObject,
  pathItem: PathItemObject,
): string | undefined {
  return namedCliCommand(operation) ?? (callable(operation, pathItem) ? "api" : undefined);
}

// What `zitadel api` calls: an operation a project secret or nothing
// authenticates (lib/sdk-sample.ts), and no cookie only a browser carries,
// as the CLI decides it (apps/cli/src/lib/api/operations.ts).
function callable(operation: OperationObject, pathItem: PathItemObject): boolean {
  return (
    authentication(operation) !== "session" &&
    !operationParameters(operation, pathItem).some((parameter) => parameter.in === "cookie")
  );
}

/** The sample's code, for an operation the CLI runs. */
export function cliSample(
  operation: OperationObject,
  path: string,
  pathItem: PathItemObject,
  request: RequestData,
): string | undefined {
  const command = cliCommand(operation, pathItem);
  if (!command) return undefined;
  if (command === "api") return apiSample(operation, path, request);
  const [topic, verb] = command.split(" ");
  const positionals = pathParameterNames(path).map((name) => word(request.path[name]?.value ?? ""));

  if (topic === "variable") {
    return (
      variableCommand(verb, positionals, request) ?? apiSample(operation, path, request, "input")
    );
  }

  const flags: string[] = [];
  if (verb === "list") {
    flags.push(...listFlags(request));
  } else if (operation.requestBody) {
    flags.push(`--data ${quote(JSON.stringify(request.body ?? {}, null, 2))}`);
  }
  return `${context}\n${line([`${cli} ${command}`, ...positionals], flags)}`;
}

/**
 * `zitadel api <operationId>`: the path parameters are its arguments, except a
 * trailing `project_id`, which the CLI fills in; each query parameter and, for
 * `bodyAs: "fields"`, each top-level body field is a `--field`, typed by the
 * operation's schema. A body with keys of its own, such as a variables map,
 * goes in as `bodyAs: "input"`: JSON on stdin, because a key named `kind` as a
 * `--field` is a query parameter and a bare number reaches the API as a string.
 * `printf` writes it, as `echo` reads a backslash in the JSON as an escape.
 */
function apiSample(
  operation: OperationObject,
  path: string,
  request: RequestData,
  bodyAs: "fields" | "input" = "fields",
): string {
  const names = pathParameterNames(path);
  const positionals = names
    .filter((name, index) => name !== "project_id" || index < names.length - 1)
    .map((name) => word(request.path[name]?.value ?? ""));
  const body = record(request.body);
  const piped = bodyAs === "input" && Object.keys(body).length > 0;
  const fields = [
    ...(piped ? ["--input -"] : []),
    ...Object.entries(request.query)
      .filter(([name]) => name !== "project_id")
      .flatMap(([name, { values }]) => values.map((value) => field(name, value))),
    ...(bodyAs === "fields" ? Object.entries(body).map(([name, value]) => field(name, value)) : []),
  ];
  const project =
    authentication(operation) === "secret" ||
    names.includes("project_id") ||
    "project_id" in request.query;
  const run = line([`${cli} api ${operation.operationId ?? ""}`, ...positionals], fields);
  const call = piped ? `printf '%s' ${quote(JSON.stringify(body))} | ${run}` : run;
  return project ? `${context}\n${call}` : call;
}

function field(name: string, value: unknown): string {
  const scalar = ["string", "number", "boolean"].includes(typeof value);
  return `-F ${word(scalar ? `${name}=${String(value)}` : `${name}:=${JSON.stringify(value)}`)}`;
}

// A list's query as the CLI spells it: each filter `field=operation:value`,
// the sort `field:direction`, and the page.
function listFlags(request: RequestData): string[] {
  const body = record(request.body);
  const flags: string[] = [];
  for (const item of Array.isArray(body.filter) ? body.filter : []) {
    const { field, operation, value } = record(item);
    if (typeof field === "string") {
      flags.push(`--filter ${word(`${field}=${String(operation ?? "equals")}:${String(value)}`)}`);
    }
  }
  const sorting = record(body.sorting);
  if (typeof sorting.field === "string") {
    flags.push(`--sort ${word(`${sorting.field}:${String(sorting.direction ?? "asc")}`)}`);
  }
  const limit = body.limit ?? request.query.limit?.values[0];
  if (limit !== undefined) flags.push(`--limit ${word(String(limit))}`);
  const page = body.page_token ?? request.query.page_token?.values[0];
  if (typeof page === "string" && page !== "") flags.push(`--page-token ${word(page)}`);
  return flags;
}

/**
 * Whether `variable <verb>` does what the request does for its `kind`. The
 * commands act on both kinds, or on the preview value with `--preview`, so a
 * `get` must name a kind and the rest must not ask for `primary` alone.
 * `resolve` takes an origin, not the deployment id the path names.
 */
function variableRunsAs(verb: string | undefined, kind: string | undefined): boolean {
  switch (verb) {
    case "get":
      return kind === "primary" || kind === "preview";
    case "list":
    case "set":
    case "rm":
      return kind === undefined || kind === "preview";
    default:
      return false;
  }
}

/**
 * The `variable` command for a request it does exactly; `undefined` for any
 * other, which the caller shows as the `zitadel api` call. A `set` prompts for
 * the value, or reads it from stdin, so a credential stays out of the shell's
 * history.
 */
function variableCommand(
  verb: string | undefined,
  positionals: string[],
  request: RequestData,
): string | undefined {
  const kind = request.query.kind?.values[0];
  if (!variableRunsAs(verb, kind)) {
    return undefined;
  }
  if (verb === "set") {
    return variableSet(request.body, kind === "preview");
  }
  const flags = kind === "preview" ? ["--preview"] : [];
  return `${context}\n${line([`${cli} variable ${verb}`, ...positionals], flags)}`;
}

/**
 * `variable set` for a body of one variable it can store. Several variables
 * are one atomic request, a `null` removes a name that may not exist, and
 * `--secret` refuses `--as number` and `--as boolean`. A plain `--preview`
 * value is refused for a name whose primary value is a secret, which the
 * generator cannot know, so only a secret is shown with it.
 */
function variableSet(body: unknown, preview: boolean): string | undefined {
  const entries = Object.entries(record(body));
  const [name, value] = entries[0] ?? ["NAME", ""];
  const { secret, value: scalar } = record(value);
  const refused =
    entries.length > 1 ||
    value === null ||
    (secret === true && typeof scalar !== "string") ||
    (preview && secret !== true);
  if (refused) {
    return undefined;
  }
  const type = typeof (scalar ?? value);
  const flags = [
    ...(secret === true ? ["--secret"] : []),
    ...(type === "number" || type === "boolean" ? [`--as ${type}`] : []),
    ...(preview ? ["--preview"] : []),
  ];
  const command = line([`${cli} variable set`, word(name)], flags);
  return [context, "# The set prompts for the value, or reads it from stdin.", command].join("\n");
}

/** One command: on a line while it fits the repo's 100 columns, else a flag a line, as cURL is. */
function line(head: string[], flags: string[]): string {
  const flat = [...head, ...flags].join(" ");
  if (flags.length === 0 || (!flat.includes("\n") && flat.length <= 100)) return flat;
  return [head.join(" "), ...flags].join(" \\\n  ");
}

/** A shell word: as it is when the shell keeps it whole, else single-quoted. */
function word(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : quote(value);
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
