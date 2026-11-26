/**
 * One call of a generated operation as a given client: the tree-shakeable
 * counterpart of `createZitadelClient`.
 *
 * `createZitadelClient` wraps the whole generated module in a `Proxy`, which
 * no bundler can tree-shake, so a browser bundle that calls a handful of
 * operations ships all of them. {@link callWith} takes the operation as a
 * value instead: import the few you call by name and the rest drop out.
 *
 * This is the one place that writes the per-call slots (base URL, bearer and
 * request policy). They are written synchronously, immediately before the
 * operation runs, and `customFetch` reads them before its first `await`, so
 * callers with different options can run in parallel without clobbering each
 * other. Every slot is written on every call, unset options included:
 * otherwise a call would run under whatever another caller left behind.
 */
import { setApiAuthToken } from "./auth";
import { setProxyPath } from "./base-url";
import { setRequestPolicy } from "./fetch";

/** What a call runs under: where it goes, as whom, and what bounds it. */
export type CallOptions = {
  /** Base URL of the Zitadel server, or a same-origin proxy path. */
  baseUrl: string;
  /** Bearer token the request carries. Unset: none. */
  token?: string;
  /**
   * Aborts the request. A request it cuts off rejects with the signal's
   * reason rather than a `NetworkError`.
   */
  signal?: AbortSignal;
  /**
   * Deadline for the request, response body included. A request that runs
   * past it rejects with a `NetworkError` whose reason is `timeout`.
   * Unset by default: no deadline beyond the runtime's own.
   */
  timeoutMs?: number;
  /** The `User-Agent` the request carries. Unset: the runtime's own. */
  userAgent?: string;
};

/**
 * Calls a generated operation under the given options.
 *
 *     import { createFlow } from "@zitadel/api/generated/endpoints/zitadelNextGen";
 *
 *     await callWith({ baseUrl, token }, createFlow, body);
 *
 * @param options - Where the call goes, as whom, and what bounds it.
 * @param operation - The generated function, or anything else that reads the slots synchronously.
 * @param args - The operation's own arguments.
 * @returns What the operation returns.
 */
export function callWith<Args extends unknown[], Result>(
  options: CallOptions,
  operation: (...args: Args) => Result,
  ...args: Args
): Result {
  setProxyPath(options.baseUrl);
  setApiAuthToken(options.token);
  setRequestPolicy({
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    userAgent: options.userAgent,
  });
  return operation(...args);
}
