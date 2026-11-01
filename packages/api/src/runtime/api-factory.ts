/**
 * Factory for the typed Zitadel client every consumer reaches for.
 *
 * Wraps the orval-generated endpoints in a {@link Proxy} so each
 * generated function sees the right base URL and (optionally) the
 * right bearer token at call time — without the caller having to
 * thread either through every operation, and without exposing the
 * module-globals (`setProxyPath` / `setApiAuthToken`) as part of the
 * public API.
 *
 * Per-instance isolation: multiple clients can coexist in one process
 * (different servers, different tokens). Every call through a client,
 * each page of a paged one included, sets that client's globals
 * synchronously before invoking the underlying generated function,
 * which reads them at the top of `customFetch` before any `await`. So
 * clients can run in parallel across awaits without clobbering each
 * other.
 */
import * as endpoints from "../generated/endpoints/zitadelNextGen";
import { paging } from "../generated/paging";

import { setApiAuthToken } from "./auth";
import { setProxyPath } from "./base-url";
import { setRequestPolicy } from "./fetch";
import { paged } from "./paged";

/**
 * How each paged function pages, by name: typed readers of a page's items and
 * of its cursor, for a caller that walks the pages itself.
 */
export { paging };

type Endpoints = typeof endpoints;
type Paging = typeof paging;

/** The name of a client function that pages. */
export type PagedOperation = keyof Paging;

/** One page of a paged function's response. */
export type PageOf<K extends PagedOperation> = Awaited<ReturnType<Endpoints[K]>>;

/** One item of a paged function's response. */
export type ItemOf<K extends PagedOperation> =
  ReturnType<Paging[K]["items"]> extends readonly (infer T)[] ? T : never;

/**
 * What a paged function carries besides fetching one page. Each takes the
 * function's own arguments; a `page_token` among them is where it starts, and
 * `limit` is the page size.
 */
export type Paged<K extends PagedOperation> = {
  /** Every page, fetched as the loop reaches it. */
  pages(...args: Parameters<Endpoints[K]>): AsyncGenerator<PageOf<K>, void, undefined>;
  /** Every item of every page, fetched a page at a time as the loop reaches it. */
  items(...args: Parameters<Endpoints[K]>): AsyncGenerator<ItemOf<K>, void, undefined>;
  /** Every item of every page, in one array. */
  all(...args: Parameters<Endpoints[K]>): Promise<ItemOf<K>[]>;
};

/**
 * Typed Zitadel client returned by {@link createZitadelClient}: the
 * orval-generated endpoints, with {@link Paged} on every function that pages.
 */
export type ZitadelClient = {
  [K in keyof Endpoints]: K extends PagedOperation ? Endpoints[K] & Paged<K> : Endpoints[K];
};

/** Re-exported under the legacy name some consumers (`runtime/config.ts`) still import. */
export type ZitadelApi = ZitadelClient;

/** Options for {@link createZitadelClient}. */
export type ZitadelClientOptions = {
  /** Base URL of the Zitadel server. Trailing slashes are stripped. */
  baseUrl: string;
  /**
   * Bearer token sent on every request. Optional — omit for the
   * unauthenticated `POST /projects` call; set it (typically to the
   * project secret returned by that call) before any subsequent
   * mutation.
   */
  token?: string;
  /**
   * Aborts every request this client makes. A request it cuts off rejects
   * with the signal's reason rather than a {@link NetworkError}.
   */
  signal?: AbortSignal;
  /**
   * Deadline for each request, response body included. A request that runs
   * past it rejects with a {@link NetworkError} whose reason is `timeout`.
   * Unset by default: no deadline beyond the runtime's own.
   */
  timeoutMs?: number;
  /**
   * Applied to every response this client resolves with, each page of a
   * paged function's included, before the caller sees it. A paged function
   * reads its cursor from the page as the server sent it, and its items from
   * what this returns under the same field.
   */
  onResponse?: (body: unknown) => unknown;
  /**
   * Applied to every failure of a call: the request's, `onResponse`'s, and a
   * paged function's own. It throws what the caller sees.
   */
  onError?: (error: unknown) => never;
};

/**
 * Build a typed Zitadel client pre-bound to a base URL and (optionally)
 * a bearer token. Every method on the returned object mirrors a
 * generated orval function, and one that pages also walks its pages:
 *
 *     const client = createZitadelClient({ baseUrl, token });
 *     await client.createProject({ origins: [] });
 *     await client.createSchema(body, { project_id });
 *     for await (const deployment of client.listDeployments.items({ project_id })) { … }
 */
export function createZitadelClient(opts: ZitadelClientOptions): ZitadelClient {
  let baseUrl = opts.baseUrl;
  while (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }
  const hooks = {
    respond: (body: unknown) => (opts.onResponse ? opts.onResponse(body) : body),
    fail: (error: unknown): never => {
      opts.onError?.(error);
      throw error;
    },
  };
  const hooked = opts.onResponse !== undefined || opts.onError !== undefined;
  // Built once per function, not on every property read.
  const bound = new Map<PropertyKey, unknown>();
  return new Proxy(endpoints as unknown as ZitadelClient, {
    get(target, prop, receiver) {
      const known = bound.get(prop);
      if (known !== undefined) {
        return known;
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      // Every request, each page included, sets this client's base URL and
      // token again: another client may have run in between.
      const send = (...args: unknown[]) => {
        setProxyPath(baseUrl);
        setApiAuthToken(opts.token);
        setRequestPolicy({ signal: opts.signal, timeoutMs: opts.timeoutMs });
        return (value as (...a: unknown[]) => unknown)(...args);
      };
      // The URL builders orval exports beside the requests return strings, so
      // only a pending result is hooked. A then-check rather than `instanceof`,
      // which a replaced global `Promise` (zone.js) would fail.
      const call = (...args: unknown[]) => {
        const result = send(...args);
        return hooked && typeof (result as { then?: unknown } | null)?.then === "function"
          ? Promise.resolve(result).then(hooks.respond).catch(hooks.fail)
          : result;
      };
      const fn = Object.hasOwn(paging, prop)
        ? Object.assign(call, paged(send, paging[prop as PagedOperation], hooks))
        : call;
      bound.set(prop, fn);
      return fn;
    },
  });
}

/**
 * Legacy entry point: builds a client with only the base URL set, no
 * token. Components and SDKs that don't carry an auth token (browser
 * flows authenticated by platform cookies) still consume this name.
 * Equivalent to `createZitadelClient({ baseUrl: apiBase })`.
 */
export function createApi(apiBase: string): ZitadelClient {
  return createZitadelClient({ baseUrl: apiBase });
}
