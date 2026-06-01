/**
 * Factory that creates a typed API client with the base URL pre-bound.
 *
 * Uses a {@link Proxy} so that every function from the orval-generated
 * endpoints module is automatically wrapped — no manual mapping needed.
 * When the OpenAPI spec grows, new endpoints are available immediately.
 */
import * as endpoints from "../generated/endpoints/zitadelNextGen";

import { setProxyPath } from "./base-url";

/**
 * Typed API client returned by {@link createApi}. Every property mirrors
 * the orval-generated module with the same name and signature.
 */
export type ZitadelApi = typeof endpoints;

/**
 * Creates a typed API client with the base URL pre-bound.
 *
 * Each method sets the module-level `apiBaseUrl` before delegating to
 * the orval-generated function. This is safe because fetch calls are
 * not concurrent within a single JS turn — the URL is set synchronously
 * before the async fetch begins.
 *
 * Uses a {@link Proxy} so new generated endpoints are available
 * automatically without manual wiring.
 */
export function createApi(proxyPath: string): ZitadelApi {
  return new Proxy(endpoints as ZitadelApi, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        setProxyPath(proxyPath);
        return (value as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
}
