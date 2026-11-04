import { type ApiOperation, operations } from "@zitadel/api/generated/operations";
import { API_PREFIX, apiBaseUrl } from "@zitadel/api/runtime/base-url";
import { request as fetchWithPolicy } from "@zitadel/api/runtime/fetch";
import { Paging } from "@zitadel/api/runtime/paging";
import { distance } from "fastest-levenshtein";

import { ApiService } from "./api-service";
import { connectionOf, responseFailure, translateFailure } from "./client";
import { InvalidError } from "./errors";

export type { ApiOperation };

/** What an operation is called with, before the server and the credential are added. */
export type ApiRequest = Readonly<{
  operation: ApiOperation;
  /** The path with its parameters filled in, without the query string. */
  path: string;
  /** The query string's entries, in order; a list parameter repeats its name. */
  query: readonly (readonly [string, string])[];
  /** The JSON body, when the request has one. */
  body?: unknown;
}>;

/** What the server answered. `body` is `undefined` for a response without one. */
export type ApiResponse = Readonly<{
  status: number;
  body: unknown;
}>;

/** What a reference to an operation resolved to, before any value is read. */
export type Target = Readonly<{
  operation: ApiOperation;
  /** Path parameters the path form spelled out (`/users/user_01…`), by name. */
  pathValues: Readonly<Record<string, string>>;
  /** The query string the path form carried (`/users?team_id=…`). */
  query: URLSearchParams;
}>;

/** A response as it came off the wire: its status, and its body not yet escaped. */
type RawResponse = Readonly<{
  status: number;
  raw: unknown;
}>;

/** A shell word, single-quoted. */
const quote = (value: string): string => {
  return `'${value.replaceAll("'", `'\\''`)}'`;
};

/** Whether a value is a non-null object. */
const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

/** The response body: JSON where the server says so, text otherwise. */
const readBody = async (res: Response): Promise<unknown> => {
  if ([204, 205, 304].includes(res.status)) {
    return undefined;
  }
  const raw = await res.text();
  if (raw === "") {
    return undefined;
  }
  if (!(res.headers.get("content-type") ?? "").includes("json")) {
    return raw;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};

/** The request for the page `token` names; `undefined` leaves the request as it is. */
const pageOf = (request: ApiRequest, token: string | undefined): ApiRequest => {
  const shape = request.operation.paging;
  if (token === undefined || shape === null) {
    return request;
  }
  if (shape.token === "query") {
    return {
      ...request,
      query: [
        ...request.query.filter(([name]) => {
          return name !== "page_token";
        }),
        ["page_token", token],
      ],
    };
  }
  return {
    ...request,
    body: {
      ...(request.body as Record<string, unknown>),
      page_token: token,
    },
  };
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
  for (const [index, part] of parts.entries()) {
    const segment = segments[index] ?? "";
    const parameter = /^\{([^}]+)\}$/.exec(part)?.[1];
    if (parameter !== undefined) {
      if (segment === "") {
        return undefined;
      }
      values[parameter] = segment;
    } else if (part !== segment) {
      return undefined;
    }
  }
  // Every part that is not a parameter matched its segment, or the loop would
  // have returned.
  const literals = parts.filter((part) => {
    return !/^\{[^}]+\}$/.test(part);
  }).length;
  return { literals, values };
};

/**
 * Every operation of the API, called with a request built from the spec rather
 * than with a typed function.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: it finds an operation by id or path, sends a request for it the
 * way the client sends its own (the same server, credential, signal, timeout
 * and escaping), and shows the cURL that would. A destructive operation is
 * sent only through a client that may reach them.
 */
export class OperationService extends ApiService {
  /**
   * Why the CLI cannot call an operation, or `undefined` when it can. It holds a
   * project secret and nothing else: an operation only an end user's session
   * cookie authenticates is theirs, and a cookie parameter (the login flow's
   * `_zflow`) is state only a browser carries.
   *
   * @param operation - The operation to check.
   * @returns The reason, or undefined when it can be called.
   */
  static uncallable(operation: ApiOperation): string | undefined {
    if (operation.auth === "session") {
      return `${operation.id} is authenticated by an end user's session cookie, and the CLI holds a project secret`;
    }
    const cookie = operation.parameters.find((parameter) => {
      return parameter.in === "cookie";
    });
    return cookie
      ? `${operation.id} reads the ${cookie.name} cookie, which only a browser carries`
      : undefined;
  }

  /**
   * The names of an operation's path parameters.
   *
   * @param operation - The operation.
   * @returns The names, in the order the path has them.
   */
  static pathParameterNames(operation: ApiOperation): readonly string[] {
    return [...operation.path.matchAll(/\{([^}]+)\}/g)].map((match) => {
      return match[1] ?? "";
    });
  }

  /**
   * The URL a request goes to on `server`: the API under its prefix there, then
   * the spec's path.
   *
   * @param server - The server's URL.
   * @param request - The request.
   * @returns The URL.
   */
  static urlOf(server: string, request: ApiRequest): string {
    const query = new URLSearchParams(
      request.query.map(([name, value]) => {
        return [name, value] as [string, string];
      }),
    );
    const search = query.size > 0 ? `?${query}` : "";
    return `${apiBaseUrl(server)}${request.path}${search}`;
  }

  /**
   * The cURL command that sends a request. The project secret is never written
   * out: an operation that needs it reads it from `$ZITADEL_PROJECT_SECRET`, as
   * the API reference's cURL samples do, in double quotes so the shell expands it.
   *
   * @param server - The server's URL.
   * @param request - The request.
   * @returns The command.
   */
  static curl(server: string, request: ApiRequest): string {
    return [
      `curl -X ${request.operation.method} ${quote(OperationService.urlOf(server, request))}`,
      ...(request.operation.auth === "secret"
        ? ['-H "Authorization: Bearer $ZITADEL_PROJECT_SECRET"']
        : []),
      ...(request.body === undefined
        ? []
        : ["-H 'Content-Type: application/json'", `-d ${quote(JSON.stringify(request.body))}`]),
    ].join(" \\\n  ");
  }

  /**
   * List the operations of one tag, and those whose id, path, summary or tag
   * contains a filter, both in any case.
   *
   * @param query - The filter and the tag to narrow to.
   * @returns The operations of the API the CLI was built with.
   */
  static list(query: Readonly<{ filter?: string; tag?: string }> = {}): readonly ApiOperation[] {
    const { filter, tag } = query;
    return operations.filter((operation) => {
      return (
        (tag === undefined || operation.tag.toLowerCase() === tag.toLowerCase()) &&
        (filter === undefined ||
          [operation.id, operation.path, operation.summary, operation.tag].some((word) => {
            return word.toLowerCase().includes(filter.toLowerCase());
          }))
      );
    });
  }

  /**
   * Find the operation an argument names: an `operationId` (in any case, as the
   * docs and `@zitadel/api` spell it), or a path starting with `/`, with or
   * without the API prefix, matched against the spec's templates.
   *
   * @param ref - An operation id, or a path.
   * @param method - With a path it picks among the path's methods; with an id it must be the operation's own.
   * @returns The operation, and what the path form carried.
   * @throws InvalidError when nothing matches, or the method does not.
   */
  static resolve(ref: string, method?: string): Target {
    const wanted = method?.toUpperCase();
    // The spec's paths leave out the prefix the server serves them under, so a
    // path copied from a URL, with it, names the same operation.
    if (ref.startsWith(`${API_PREFIX}/`)) {
      return OperationService.byPath(ref.slice(API_PREFIX.length), wanted);
    }
    if (!ref.startsWith("/")) {
      const operation = OperationService.byId(ref);
      if (wanted !== undefined && wanted !== operation.method) {
        throw new InvalidError(
          `${operation.id} is ${operation.method} ${operation.path}, not ${wanted}`,
          { hint: `Leave out -X, or pass -X ${operation.method}.` },
        );
      }
      return {
        operation,
        pathValues: {},
        query: new URLSearchParams(),
      };
    }
    return OperationService.byPath(ref, wanted);
  }

  /**
   * Find the operation an `operationId` names, in any case.
   *
   * @param ref - The operation id.
   * @returns The operation.
   * @throws InvalidError naming the nearest ids when none matches.
   */
  private static byId(ref: string): ApiOperation {
    const operation = operations.find((candidate) => {
      return candidate.id.toLowerCase() === ref.toLowerCase();
    });
    if (operation) {
      return operation;
    }
    const wanted = ref.toLowerCase();
    const near = operations
      .filter((candidate) => {
        const id = candidate.id.toLowerCase();
        return id.includes(wanted) || distance(id, wanted) <= 2;
      })
      .map((candidate) => {
        return candidate.id;
      });
    throw new InvalidError(`No operation is called ${ref}`, {
      hint:
        near.length > 0
          ? `Did you mean ${near.slice(0, 5).join(", ")}? List them all with \`zitadel api ls\`.`
          : "List them with `zitadel api ls`, or give a path such as /users/query.",
    });
  }

  /**
   * Find the operation a path names, preferring the template with the most literal segments.
   *
   * @param ref - The path, with an optional query string.
   * @param method - The method to pick among the path's operations, when given.
   * @returns The operation, and what the path carried.
   * @throws InvalidError when no template matches or the method does not.
   */
  private static byPath(ref: string, method: string | undefined): Target {
    const at = ref.indexOf("?");
    const path = at === -1 ? ref : ref.slice(0, at);
    const query = new URLSearchParams(at === -1 ? "" : ref.slice(at + 1));
    const segments = segmentsOf(path.length > 1 ? path.replace(/\/$/, "") : path);
    const matches = (segments ? operations : [])
      .map((operation) => {
        return {
          operation,
          match: matchOf(operation.path, segments ?? []),
        };
      })
      .filter((candidate) => {
        return candidate.match !== undefined;
      });
    const best = Math.max(
      -1,
      ...matches.map((candidate) => {
        return candidate.match?.literals ?? -1;
      }),
    );
    const template = matches.find((candidate) => {
      return candidate.match?.literals === best;
    });
    if (!template?.match) {
      throw new InvalidError(`No operation has the path ${path}`, {
        hint: "List the paths with `zitadel api ls`.",
      });
    }
    const methods = operations.filter((operation) => {
      return operation.path === template.operation.path;
    });
    const operation =
      method === undefined
        ? methods.length === 1
          ? methods[0]
          : methods.find((candidate) => {
              return candidate.method === "GET";
            })
        : methods.find((candidate) => {
            return candidate.method === method;
          });
    if (!operation) {
      const offered = methods
        .map((candidate) => {
          return candidate.method;
        })
        .join(", ");
      throw new InvalidError(
        method === undefined
          ? `${template.operation.path} takes ${offered}; say which with -X`
          : `${template.operation.path} takes ${offered}, not ${method}`,
        { hint: `Pass -X with one of ${offered}.` },
      );
    }
    return {
      operation,
      pathValues: template.match.values,
      query,
    };
  }

  /**
   * Send one request, with the credential the client holds as the bearer. It is
   * bounded and cancelled as every call of the client is. A non-2xx is raised
   * as a backend error.
   *
   * @param request - The request.
   * @returns The status and the body, as the server sent it.
   * @throws BackendError for any failure, and for a destructive request through a client that may not reach them.
   */
  async call(request: ApiRequest): Promise<ApiResponse> {
    const { status, raw } = await this.send(request);
    return {
      status,
      body: raw,
    };
  }

  /**
   * Send a paged request until the server's `next_page_token` runs out.
   *
   * @param request - The request.
   * @returns The last page's status and body, with the page field holding every page's items.
   * @throws InvalidError when a page lacks its list.
   */
  async callAll(request: ApiRequest): Promise<ApiResponse> {
    const shape = request.operation.paging;
    if (shape === null) {
      return this.call(request);
    }
    const fields = Paging.byField(shape.items);
    const paging = new Paging<RawResponse, unknown>({
      items: (response) => {
        try {
          return fields.items(response.raw);
        } catch (problem) {
          throw new InvalidError(problem instanceof Error ? problem.message : String(problem), {
            details: {
              response: response.raw,
            },
          });
        }
      },
      next: (response) => {
        return fields.next(response.raw);
      },
    });
    const walk = paging.walk(async (cursor) => {
      return this.send(pageOf(request, cursor));
    });
    const { items, last } = await paging.collect(walk, {
      all: true,
    });
    const page = isObject(last?.raw) ? last.raw : {};
    const body = {
      ...page,
      [shape.items]: [],
    };
    return {
      status: last?.status ?? 200,
      body: {
        ...body,
        [shape.items]: items,
      },
    };
  }

  /**
   * Send one request and answer it as it came off the wire. Every request goes
   * out here, so a destructive one through a client that may not reach them is
   * refused here, whichever call sent it.
   *
   * @param request - The request.
   * @returns The status and the body, not yet escaped.
   * @throws BackendError for any failure.
   */
  private async send(request: ApiRequest): Promise<RawResponse> {
    const connection = connectionOf(this.client);
    if (request.operation.destructive && !connection.destructive) {
      throw new Error(`${request.operation.id} is destructive: reach it through allowDestructive`);
    }
    const url = OperationService.urlOf(connection.baseUrl, request);
    const { method } = request.operation;
    const headers = new Headers({
      accept: "application/json",
    });
    if (connection.token !== undefined) {
      headers.set("authorization", `Bearer ${connection.token}`);
    }
    if (connection.userAgent !== undefined) {
      headers.set("user-agent", connection.userAgent);
    }
    if (request.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    try {
      const { res, rawBody } = await fetchWithPolicy(
        url,
        {
          method,
          headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        },
        {
          signal: connection.signal,
          timeoutMs: connection.timeoutMs,
        },
        readBody,
      );
      if (!res.ok) {
        throw responseFailure(res.status, url, rawBody, `${method} ${url} returned ${res.status}`);
      }
      return {
        status: res.status,
        raw: rawBody,
      };
    } catch (error) {
      throw translateFailure(error);
    }
  }
}
