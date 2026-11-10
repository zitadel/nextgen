import { type ApiOperation, operations } from "@zitadel/api/generated/operations";
import { API_PREFIX, apiBaseUrl } from "@zitadel/api/runtime/base-url";
import { Paging } from "@zitadel/api/runtime/paging";
import { distance } from "fastest-levenshtein";

import { ApiService } from "@/lib/backend/api-service";
import { connectionOf, responseFailure } from "@/lib/backend/client";
import { InvalidError } from "@/lib/backend/errors";
import { request as fetchWithPolicy } from "@/lib/backend/transport";

export type { ApiOperation };

/** What narrows a listing of the API's operations. */
export type OperationQuery = Readonly<{
  /** Only operations whose id, path, summary or tag contains this text. */
  filter?: string;
  /** Only the operations of this part of the API. */
  tag?: string;
}>;

/** What an operation is called with, before the server and the credential are added. */
export type ApiRequest = Readonly<{
  operation: Operation;
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
  operation: Operation;
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

/** How well a path template matches a path: its literal segments, and what its parameters hold. */
type PathMatch = Readonly<{
  literals: number;
  values: Record<string, string>;
}>;

/** Whether a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The response body: JSON where the server says so, text otherwise. */
async function readBody(res: Response): Promise<unknown> {
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
}

/** The request for the page `token` names; `undefined` leaves the request as it is. */
function pageOf(request: ApiRequest, token: string | undefined): ApiRequest {
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
      ...(isObject(request.body) ? request.body : {}),
      page_token: token,
    },
  };
}

/** A path's segments, each percent-decoded; `undefined` for a malformed escape. */
function segmentsOf(path: string): readonly string[] | undefined {
  try {
    return path.split("/").slice(1).map(decodeURIComponent);
  } catch {
    return undefined;
  }
}

/**
 * How well a template matches a path: `undefined` when it does not, else the
 * positions of its literal segments, so `/users/me` is chosen over
 * `/users/{user_id}` for `/users/me`.
 */
function matchOf(template: string, segments: readonly string[]): PathMatch | undefined {
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
  return {
    literals,
    values,
  };
}

/**
 * One operation of the API: what the spec says about it, and what follows from
 * that.
 *
 * @remarks
 * A rich Value Object (Fowler, PoEAA): immutable, and it carries the questions
 * a caller asks of it, so a command writes `operation.uncallable` and never
 * reads the spec's parameters itself. It serialises to the record the spec
 * holds.
 */
export class Operation {
  readonly id: string;
  readonly method: ApiOperation["method"];
  readonly path: string;
  readonly summary: string;
  readonly tag: string;
  readonly auth: ApiOperation["auth"];
  readonly parameters: ApiOperation["parameters"];
  readonly body: ApiOperation["body"];
  readonly paging: ApiOperation["paging"];
  readonly cli: string | null;
  readonly destructive: boolean;
  private readonly record: ApiOperation;

  /**
   * Build an operation from the record the spec holds.
   *
   * @param record - The record as the spec declares it.
   */
  private constructor(record: ApiOperation) {
    this.id = record.id;
    this.method = record.method;
    this.path = record.path;
    this.summary = record.summary;
    this.tag = record.tag;
    this.auth = record.auth;
    this.parameters = record.parameters;
    this.body = record.body;
    this.paging = record.paging;
    this.cli = record.cli;
    this.destructive = record.destructive;
    this.record = record;
  }

  /**
   * Wrap an operation the spec declares.
   *
   * @param record - The record as the spec declares it.
   * @returns The operation.
   */
  static of(record: ApiOperation): Operation {
    return new Operation(record);
  }

  /**
   * Every operation of one tag, and those whose id, path, summary or tag
   * contains a filter, both in any case.
   *
   * @param query - The filter and the tag to narrow to.
   * @returns The operations of the API the CLI was built with.
   */
  static all(query: OperationQuery = {}): readonly Operation[] {
    return operations
      .filter((record) => {
        return (
          (query.tag === undefined || record.tag.toLowerCase() === query.tag.toLowerCase()) &&
          (query.filter === undefined ||
            [record.id, record.path, record.summary, record.tag].some((word) => {
              return word.toLowerCase().includes(query.filter?.toLowerCase() ?? "");
            }))
        );
      })
      .map((record) => {
        return Operation.of(record);
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
  static named(ref: string, method?: string): Target {
    const wanted = method?.toUpperCase();
    // The spec's paths leave out the prefix the server serves them under, so a
    // path copied from a URL, with it, names the same operation.
    if (ref.startsWith(`${API_PREFIX}/`)) {
      return Operation.byPath(ref.slice(API_PREFIX.length), wanted);
    }
    if (!ref.startsWith("/")) {
      const operation = Operation.byId(ref);
      if (wanted !== undefined && wanted !== operation.method) {
        throw new InvalidError(
          `${operation.id} is ${operation.method} ${operation.path}, not ${wanted}`,
          {
            hint: `Leave out -X, or pass -X ${operation.method}.`,
          },
        );
      }
      return {
        operation,
        pathValues: {},
        query: new URLSearchParams(),
      };
    }
    return Operation.byPath(ref, wanted);
  }

  /**
   * The names of this operation's path parameters.
   *
   * @returns The names, in the order the path has them.
   */
  get pathParameters(): readonly string[] {
    return [...this.path.matchAll(/\{([^}]+)\}/g)].map((match) => {
      return match[1] ?? "";
    });
  }

  /**
   * Why the CLI cannot call this operation, or `undefined` when it can. It holds
   * a project secret and nothing else: an operation only an end user's session
   * cookie authenticates is theirs, and a cookie parameter (the login flow's
   * `_zflow`) is state only a browser carries.
   *
   * @returns The reason, or undefined when it can be called.
   */
  get uncallable(): string | undefined {
    if (this.auth === "session") {
      return `${this.id} is authenticated by an end user's session cookie, and the CLI holds a project secret`;
    }
    const cookie = this.parameters.find((parameter) => {
      return parameter.in === "cookie";
    });
    if (cookie === undefined) {
      return undefined;
    }
    return `${this.id} reads the ${cookie.name} cookie, which only a browser carries`;
  }

  /**
   * The URL a request for this operation goes to on `server`: the API under its
   * prefix there, then the path the request filled in.
   *
   * @param server - The server's URL.
   * @param request - The request.
   * @returns The URL.
   */
  urlOn(server: string, request: ApiRequest): string {
    const query = new URLSearchParams(
      request.query.map(([name, value]): [string, string] => {
        return [name, value];
      }),
    );
    const search = query.size > 0 ? `?${query}` : "";
    return `${apiBaseUrl(server)}${request.path}${search}`;
  }

  /**
   * The record the spec holds, which is what the JSON output carries.
   *
   * @returns The record.
   */
  toJSON(): ApiOperation {
    return this.record;
  }

  /**
   * Find the operation an `operationId` names, in any case.
   *
   * @param ref - The operation id.
   * @returns The operation.
   * @throws InvalidError naming the nearest ids when none matches.
   */
  private static byId(ref: string): Operation {
    const wanted = ref.toLowerCase();
    const record = operations.find((candidate) => {
      return candidate.id.toLowerCase() === wanted;
    });
    if (record !== undefined) {
      return Operation.of(record);
    }
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
    const matches = (segments === undefined ? [] : operations)
      .map((record) => {
        return {
          record,
          match: matchOf(record.path, segments ?? []),
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
    if (template?.match === undefined) {
      throw new InvalidError(`No operation has the path ${path}`, {
        hint: "List the paths with `zitadel api ls`.",
      });
    }
    const methods = operations.filter((record) => {
      return record.path === template.record.path;
    });
    const record = Operation.pick(methods, method);
    if (record === undefined) {
      const offered = methods
        .map((candidate) => {
          return candidate.method;
        })
        .join(", ");
      throw new InvalidError(
        method === undefined
          ? `${template.record.path} takes ${offered}; say which with -X`
          : `${template.record.path} takes ${offered}, not ${method}`,
        {
          hint: `Pass -X with one of ${offered}.`,
        },
      );
    }
    return {
      operation: Operation.of(record),
      pathValues: template.match.values,
      query,
    };
  }

  /**
   * The operation a method names among a path's own: the only one when a path
   * has one, else `GET` when no method was given.
   *
   * @param methods - The operations one path declares.
   * @param method - The method the caller gave, when it gave one.
   * @returns The operation, or undefined when the method picks none.
   */
  private static pick(
    methods: readonly ApiOperation[],
    method: string | undefined,
  ): ApiOperation | undefined {
    if (method !== undefined) {
      return methods.find((candidate) => {
        return candidate.method === method;
      });
    }
    if (methods.length === 1) {
      return methods[0];
    }
    return methods.find((candidate) => {
      return candidate.method === "GET";
    });
  }
}

/**
 * Every operation of the API, called with a request built from the spec rather
 * than with a typed function.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: it sends a request for an operation the way the client sends its
 * own, with the same server, credential, signal and timeout. A destructive
 * operation is sent only through a client that may reach them. Which operation
 * to send is {@link Operation}'s to answer, and needs no client.
 */
export class OperationService extends ApiService {
  /**
   * Send one request, with the credential the client holds as the bearer. It is
   * bounded and cancelled as every call of the client is. A non-2xx is raised
   * as a backend error.
   *
   * @param request - The request.
   * @returns The status and the body, as the server sent it.
   * @throws BackendError for any failure the server or the transport answered.
   * @throws Error for a destructive request through a client that may not reach them.
   */
  async call(request: ApiRequest): Promise<ApiResponse> {
    const response = await this.send(request);
    return {
      status: response.status,
      body: response.raw,
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
    const collected = await paging.collect(walk, {
      all: true,
    });
    // The walk fetches its first page before it yields, so there is always a
    // last one. Answering a status of its own if there were not would report a
    // call that never happened as one that succeeded.
    const last = collected.last;
    if (last === undefined) {
      throw new InvalidError(`${request.operation.id} answered no page`);
    }
    return {
      status: last.status,
      body: {
        ...(isObject(last.raw) ? last.raw : {}),
        [shape.items]: collected.items,
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
   * @throws BackendError for any failure the server or the transport answered.
   * @throws Error for a destructive request on a client that may not reach
   * them, which is a caller that did not ask for consent rather than anything
   * that went wrong at run time — as reaching one on the client itself is.
   */
  private async send(request: ApiRequest): Promise<RawResponse> {
    const connection = connectionOf(this.client);
    if (request.operation.destructive && !connection.destructive) {
      throw new Error(`${request.operation.id} is destructive: reach it through allowDestructive`);
    }
    const url = request.operation.urlOn(connection.baseUrl, request);
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
    // Through the backend's own sender, which fails the way the client fails,
    // so the one rule for what a transport failure becomes lives there and not
    // here as well.
    const { res, rawBody } = await fetchWithPolicy(
      url,
      {
        method: request.operation.method,
        headers,
        ...(request.body === undefined
          ? {}
          : {
              body: JSON.stringify(request.body),
            }),
      },
      {
        signal: connection.signal,
        timeoutMs: connection.timeoutMs,
      },
      readBody,
    );
    if (!res.ok) {
      throw responseFailure(
        res.status,
        url,
        rawBody,
        `${request.operation.method} ${url} returned ${res.status}`,
      );
    }
    return {
      status: res.status,
      raw: rawBody,
    };
  }
}
