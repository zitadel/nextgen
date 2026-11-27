/**
 * The convenience client: every generated operation bound to one
 * {@link ZitadelClient}, plus paging on the operations that page.
 *
 * It imports every operation, so only code that wants all of them should use
 * it; code that calls a handful (the sign-in widget) imports those functions
 * from `@zitadel/api/generated/endpoints/zitadelNextGen` and passes its client
 * to each, and a bundler leaves the rest out.
 *
 * Nothing here holds state: each bound function calls the generated one with
 * the same client, and the client carries everything a request needs.
 */
import * as endpoints from "../generated/endpoints/zitadelNextGen";
import { operations } from "../generated/operations";
import { paging } from "../generated/paging";

import { ZitadelClient } from "./client";
import { paged } from "./paged";

export { ZitadelClient };
export type { CsrfProvider, ZitadelClientSettings } from "./client";

/**
 * How each paged function pages, by name: typed readers of a page's items and
 * of its cursor, and the arguments that fetch the page a cursor names. Named
 * apart from `@zitadel/api/runtime/paging`, the `Paging` class that walks a list.
 */
export { paging as pagedFunctions };

type Endpoints = typeof endpoints;
type Paging = typeof paging;

/** The name of a generated function that runs an operation (not a URL builder). */
export type OperationName = {
  [K in keyof Endpoints]: Endpoints[K] extends (client: ZitadelClient, ...rest: never[]) => unknown
    ? K
    : never;
}[keyof Endpoints];

/** A generated operation with its client already given. */
type Bound<F> = F extends (client: ZitadelClient, ...rest: infer A) => infer R
  ? (...rest: A) => R
  : never;

/** The arguments of a generated operation after its client. */
type ArgsOf<K extends OperationName> = Parameters<Bound<Endpoints[K]>>;

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
  pages(...args: ArgsOf<K>): AsyncGenerator<PageOf<K>, void, undefined>;
  /** Every item of every page, fetched a page at a time as the loop reaches it. */
  items(...args: ArgsOf<K>): AsyncGenerator<ItemOf<K>, void, undefined>;
  /** Every item of every page, in one array. */
  all(...args: ArgsOf<K>): Promise<ItemOf<K>[]>;
};

/**
 * The convenience client {@link createZitadelApi} returns: every generated
 * operation bound to {@link ZitadelApi.client}, with {@link Paged} on every
 * function that pages.
 */
export type ZitadelApi = {
  readonly [K in OperationName]: K extends PagedOperation
    ? Bound<Endpoints[K]> & Paged<K>
    : Bound<Endpoints[K]>;
} & {
  /** The client every operation runs against. */
  readonly client: ZitadelClient;
};

/** What a convenience client does to every result and every failure. */
export type ZitadelApiHooks = Readonly<{
  /**
   * Applied to every response, each page of a paged function's included,
   * before the caller sees it. A paged function reads its cursor from the
   * page as the server sent it, and its items from what this returns under
   * the same field. Left out, responses are returned as they came.
   */
  onResponse?: (body: unknown) => unknown;
  /**
   * Applied to every failure of a call: the request's, `onResponse`'s, and a
   * paged function's own. It throws what the caller sees. Left out, failures
   * are thrown as they came.
   */
  onError?: (error: unknown) => never;
}>;

/**
 * Every generated operation bound to `client`, and the operations that page
 * with `pages`, `items` and `all`:
 *
 * @param client - The client every operation runs against.
 * @param hooks - What to do to every result and every failure.
 * @returns The frozen convenience client.
 * @example
 * const api = createZitadelApi(new ZitadelClient({ baseUrl, token, allowDestructive: false }));
 * await api.publishSchema(body, { project_id });
 * for await (const deployment of api.listDeployments.items({ project_id })) { … }
 */
export function createZitadelApi(client: ZitadelClient, hooks: ZitadelApiHooks = {}): ZitadelApi {
  const respond = (body: unknown) => (hooks.onResponse ? hooks.onResponse(body) : body);
  const fail = (error: unknown): never => {
    hooks.onError?.(error);
    throw error;
  };
  const hooked = hooks.onResponse !== undefined || hooks.onError !== undefined;
  const api: Record<string, unknown> = { client };
  // Each operation's generated function is named by its id, first letter
  // lowercased; the module's other exports are URL builders. Read here rather
  // than at load, so a bundle that imports this module for something else does
  // not keep every operation.
  const names = new Set(operations.map(({ id }) => id.charAt(0).toLowerCase() + id.slice(1)));
  for (const [name, value] of Object.entries(endpoints)) {
    if (!names.has(name)) {
      continue;
    }
    const operation = value as (...args: unknown[]) => Promise<unknown>;
    // The page a paged function fetches, as the server answered it, from the
    // generated function's full arguments, its client first.
    const send = (...args: unknown[]) => operation(...args);
    const call = (...args: unknown[]) => {
      const result = operation(client, ...args);
      return hooked ? result.then(respond).catch(fail) : result;
    };
    api[name] = Object.hasOwn(paging, name)
      ? Object.freeze(
          Object.assign(
            call,
            paged(client, send, paging[name as PagedOperation], { respond, fail }),
          ),
        )
      : Object.freeze(call);
  }
  return Object.freeze(api) as ZitadelApi;
}
