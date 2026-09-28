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
 * (different servers, different tokens). Their Proxy `get` traps set
 * the globals synchronously before invoking the underlying generated
 * function, which reads them at the top of `customFetch` before any
 * `await`. Two clients running interleaved within a single JS turn
 * are safe; two clients running in parallel across awaits could
 * clobber each other — not a pattern any current consumer uses.
 */
import * as endpoints from "../generated/endpoints/zitadelNextGen";

import { setApiAuthToken } from "./auth";
import { setProxyPath } from "./base-url";

/**
 * Typed Zitadel client returned by {@link createZitadelClient}.
 * Mirrors the orval-generated endpoints module 1:1.
 */
export type ZitadelClient = typeof endpoints;

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
};

/**
 * Build a typed Zitadel client pre-bound to a base URL and (optionally)
 * a bearer token. Every method on the returned object mirrors a
 * generated orval function:
 *
 *     const client = createZitadelClient({ baseUrl, token });
 *     await client.createProject({ preview_origins: [] });
 *     await client.createSchema(body, { project_id });
 */
export function createZitadelClient(opts: ZitadelClientOptions): ZitadelClient {
  let baseUrl = opts.baseUrl;
  while (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }
  return new Proxy(endpoints as ZitadelClient, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) => {
        setProxyPath(baseUrl);
        setApiAuthToken(opts.token);
        return (value as (...a: unknown[]) => unknown)(...args);
      };
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
