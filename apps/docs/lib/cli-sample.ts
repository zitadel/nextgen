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
// body goes in `--data`, and a list's query becomes its flags.

export const cli = "npx @zitadel/cli@alpha";

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

  if (topic === "variables") return variables(verb, positionals, request);

  const flags: string[] = [];
  if (verb === "list") {
    flags.push(...listFlags(request));
  } else if (operation.requestBody) {
    flags.push(`--data ${quote(JSON.stringify(request.body ?? {}, null, 2))}`);
  }
  return `${context}\n${line([`${cli} ${command}`, ...positionals], flags)}`;
}

// `zitadel api <operationId>`: the path parameters are its arguments, but a
// trailing `project_id`, which the CLI fills in itself; each query parameter
// and top-level body field is a `--field`, typed by the operation's schema, and
// an object, a list or `null` is JSON after `:=`.
function apiSample(operation: OperationObject, path: string, request: RequestData): string {
  const names = pathParameterNames(path);
  const positionals = names
    .filter((name, index) => name !== "project_id" || index < names.length - 1)
    .map((name) => word(request.path[name]?.value ?? ""));
  const fields = [
    ...Object.entries(request.query)
      .filter(([name]) => name !== "project_id")
      .flatMap(([name, { values }]) => values.map((value) => field(name, value))),
    ...Object.entries(record(request.body)).map(([name, value]) => field(name, value)),
  ];
  // An operation that needs no credential runs anywhere, unless the CLI is
  // to fill in its project.
  const project =
    authentication(operation) === "secret" ||
    names.includes("project_id") ||
    "project_id" in request.query;
  const call = line([`${cli} api ${operation.operationId ?? ""}`, ...positionals], fields);
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

// The variables commands name their owner, and the project is the one they
// take (apps/cli/src/lib/oclif/owner-command.ts). `set` takes no value on the
// command line: it prompts for it, or reads it from stdin, so a credential
// stays out of the shell's history. A body sets many variables at once, so
// it is a command for each, and the `null` that removes one is a delete.
function variables(verb: string | undefined, positionals: string[], request: RequestData): string {
  const owner = "--project-level";
  if (verb !== "set") {
    return `${context}\n${line([`${cli} variables ${verb}`, ...positionals], [owner])}`;
  }

  const entries: [string, unknown][] = Object.entries(record(request.body));
  const commands = (entries.length > 0 ? entries : [["NAME", ""]]).map(([name, value]) => {
    if (value === null) return line([`${cli} variables delete`, word(name)], [owner]);
    const { secret, value: scalar } = record(value);
    const type = typeof (scalar ?? value);
    return line(
      [`${cli} variables set`, word(name)],
      [
        owner,
        ...(secret === true ? ["--secret"] : []),
        ...(type === "number" || type === "boolean" ? [`--as ${type}`] : []),
      ],
    );
  });
  const prompts = entries.length === 0 || entries.some(([, value]) => value !== null);
  return [
    context,
    ...(prompts ? ["# Each set prompts for the value, or reads it from stdin."] : []),
    ...commands,
  ].join("\n");
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
