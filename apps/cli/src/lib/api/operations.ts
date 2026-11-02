import { type ApiOperation, operations } from "@zitadel/api/generated/operations";
import { API_PREFIX } from "@zitadel/api/runtime/base-url";

import { ZitadelError } from "../errors";
import { unscopedCommand } from "../suggestion";

export type { ApiOperation };

/** Every operation of the API the CLI was built with. */
export const OPERATIONS: readonly ApiOperation[] = operations;

/** What `zitadel api` was pointed at, before any value is read. */
export type Target = Readonly<{
  operation: ApiOperation;
  /** Path parameters the path form spelled out (`/users/user_01…`), by name. */
  pathValues: Readonly<Record<string, string>>;
  /** The query string the path form carried (`/users?team_id=…`). */
  query: URLSearchParams;
}>;

const LIST = unscopedCommand("api ls --json");

/**
 * Why the CLI cannot call an operation, or `undefined` when it can. It holds a
 * project secret and nothing else: an operation only an end user's session
 * cookie authenticates is theirs, and a cookie parameter (the login flow's
 * `_zflow`) is state only a browser carries.
 */
export const uncallable = (operation: ApiOperation): string | undefined => {
  if (operation.auth === "session") {
    return `${operation.id} is authenticated by an end user's session cookie, and the CLI holds a project secret`;
  }
  const cookie = operation.parameters.find((parameter) => parameter.in === "cookie");
  return cookie
    ? `${operation.id} reads the ${cookie.name} cookie, which only a browser carries`
    : undefined;
};

/**
 * The operations `zitadel api ls` lists: those of one tag, and those whose id,
 * path, summary or tag contains the filter, both in any case.
 */
export const findOperations = ({
  filter,
  tag,
}: Readonly<{ filter?: string; tag?: string }>): readonly ApiOperation[] =>
  OPERATIONS.filter(
    (operation) =>
      (tag === undefined || operation.tag.toLowerCase() === tag.toLowerCase()) &&
      (filter === undefined ||
        [operation.id, operation.path, operation.summary, operation.tag].some((word) =>
          word.toLowerCase().includes(filter.toLowerCase()),
        )),
  );

/** The names of an operation's path parameters, in the order the path has them. */
export const pathParameterNames = (operation: ApiOperation): readonly string[] =>
  [...operation.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "");

/**
 * The operation an argument names: an `operationId` (in any case, as the docs
 * and `@zitadel/api` spell it), or a path starting with `/`, with or without
 * the API prefix, matched against the spec's templates. `method` is `-X`: with a path it picks among the
 * path's methods; with an id it must be the operation's own.
 */
export const resolveTarget = (ref: string, method?: string): Target => {
  const wanted = method?.toUpperCase();
  // The spec's paths leave out the prefix the server serves them under, so a
  // path copied from a URL, with it, names the same operation.
  if (ref.startsWith(`${API_PREFIX}/`)) {
    return byPath(ref.slice(API_PREFIX.length), wanted);
  }
  if (!ref.startsWith("/")) {
    const operation = byId(ref);
    if (wanted !== undefined && wanted !== operation.method) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${operation.id} is ${operation.method} ${operation.path}, not ${wanted}`,
        { hint: `Leave out -X, or pass -X ${operation.method}.` },
      );
    }
    return { operation, pathValues: {}, query: new URLSearchParams() };
  }
  return byPath(ref, wanted);
};

const byId = (ref: string): ApiOperation => {
  const operation = OPERATIONS.find(
    (candidate) => candidate.id.toLowerCase() === ref.toLowerCase(),
  );
  if (operation) {
    return operation;
  }
  const wanted = ref.toLowerCase();
  const near = OPERATIONS.filter((candidate) => {
    const id = candidate.id.toLowerCase();
    return id.includes(wanted) || distance(id, wanted) <= 2;
  }).map((candidate) => candidate.id);
  throw new ZitadelError("E_VALIDATION", `No operation is called ${ref}`, {
    hint:
      near.length > 0
        ? `Did you mean ${near.slice(0, 5).join(", ")}? List them all with \`zitadel api ls\`.`
        : "List them with `zitadel api ls`, or give a path such as /users/query.",
    nextCommands: [LIST],
  });
};

/** How many single-letter edits turn `a` into `b` (Levenshtein), for a typo's suggestion. */
const distance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (const [i, left] of [...a].entries()) {
    const current = [i + 1];
    for (const [j, right] of [...b].entries()) {
      current.push(
        Math.min(
          (previous[j + 1] ?? 0) + 1,
          (current[j] ?? 0) + 1,
          (previous[j] ?? 0) + (left === right ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
};

/** A path's segments, each percent-decoded; `undefined` for a malformed escape. */
const segmentsOf = (path: string): readonly string[] | undefined => {
  try {
    return path.split("/").slice(1).map(decodeURIComponent);
  } catch {
    return undefined;
  }
};

/**
 * How well a template matches a path: `undefined` when it does not, else the
 * positions of its literal segments, so `/users/me` is chosen over
 * `/users/{user_id}` for `/users/me`.
 */
const matchOf = (
  template: string,
  segments: readonly string[],
): { literals: number; values: Record<string, string> } | undefined => {
  const parts = template.split("/").slice(1);
  if (parts.length !== segments.length) {
    return undefined;
  }
  const values: Record<string, string> = {};
  let literals = 0;
  for (const [index, part] of parts.entries()) {
    const segment = segments[index] ?? "";
    const parameter = /^\{([^}]+)\}$/.exec(part)?.[1];
    if (parameter !== undefined) {
      if (segment === "") {
        return undefined;
      }
      values[parameter] = segment;
    } else if (part === segment) {
      literals++;
    } else {
      return undefined;
    }
  }
  return { literals, values };
};

const byPath = (ref: string, method: string | undefined): Target => {
  const at = ref.indexOf("?");
  const path = at === -1 ? ref : ref.slice(0, at);
  const query = new URLSearchParams(at === -1 ? "" : ref.slice(at + 1));
  const segments = segmentsOf(path.length > 1 ? path.replace(/\/$/, "") : path);
  const matches = (segments ? OPERATIONS : [])
    .map((operation) => ({ operation, match: matchOf(operation.path, segments ?? []) }))
    .filter((candidate) => candidate.match !== undefined);
  const best = Math.max(-1, ...matches.map((candidate) => candidate.match?.literals ?? -1));
  const template = matches.find((candidate) => candidate.match?.literals === best);
  if (!template?.match) {
    throw new ZitadelError("E_VALIDATION", `No operation has the path ${path}`, {
      hint: "List the paths with `zitadel api ls`.",
      nextCommands: [LIST],
    });
  }
  const methods = OPERATIONS.filter((operation) => operation.path === template.operation.path);
  const operation =
    method === undefined
      ? methods.length === 1
        ? methods[0]
        : methods.find((candidate) => candidate.method === "GET")
      : methods.find((candidate) => candidate.method === method);
  if (!operation) {
    const offered = methods.map((candidate) => candidate.method).join(", ");
    throw new ZitadelError(
      "E_VALIDATION",
      method === undefined
        ? `${template.operation.path} takes ${offered}; say which with -X`
        : `${template.operation.path} takes ${offered}, not ${method}`,
      { hint: `Pass -X with one of ${offered}.` },
    );
  }
  return { operation, pathValues: template.match.values, query };
};
