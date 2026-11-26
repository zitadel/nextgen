/**
 * The project configuration every SDK shares: the handle that says which project an app signs
 * users in to, and the typed API client for it.
 *
 * This module is the one place where the SDKs touch the configuration of the API package. An SDK
 * imports from here and never from the API package itself, so the names, the types and the
 * behavior an app sees are declared in this package. When the API package changes, the change is
 * absorbed here, and the checks in `config.spec.ts` fail first if an SDK-visible shape would move.
 *
 * @module
 */
import {
  configureZitadel as configureApi,
  getApi as getApiClient,
  getZitadelConfig as getApiConfig,
  type ZitadelApi,
} from "@zitadel/api/config";

/**
 * The input of `configureZitadel`: which project the app signs users in to and how the
 * widgets reach the server.
 *
 * @example
 * ```ts
 * const config: ZitadelConfig = {
 *   projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
 *   proxyPath: "/__nextgen",
 * };
 * ```
 */
export interface ZitadelConfig {
  /**
   * The same-origin path that the widgets call, which the app forwards to the Zitadel server.
   *
   * The browser only ever talks to its own origin, so no cross-origin setup is needed and the
   * project secret never reaches the page. In local development the value may also be the origin
   * of a backend, which makes the calls cross-origin.
   *
   * @defaultValue "/__nextgen"
   */
  readonly proxyPath?: string;
  /**
   * The id of the Zitadel project that the app signs users in to.
   *
   * It is sent when a flow starts, and a session counts only inside this project. Without it the
   * widgets show a configuration error instead of starting a flow.
   */
  readonly projectId: string;
  /**
   * The full URL of the Zitadel server, for example `"http://localhost:8080"`.
   *
   * Only server-side code needs it, to proxy requests and to verify tokens, so a client-side app
   * leaves it unset.
   *
   * @defaultValue unset
   */
  readonly url?: string;
  /**
   * The publishable key of the project: an origin-scoped bearer that is safe to ship in a browser
   * bundle and to commit.
   *
   * It is sent on the public calls that the widgets make. Never put a project secret here, since
   * the secret must stay on the server. Without a key the calls carry no bearer, and an operation
   * that needs one has to be authenticated by a server-side proxy instead.
   *
   * @defaultValue unset
   */
  readonly publishableKey?: string;
}

/**
 * The frozen handle that `configureZitadel` returns, which every widget and helper reads the
 * project from.
 *
 * Pass it to a widget as `project`. When a widget gets both the handle and separate `projectId`
 * and `proxyPath` values, the handle wins. The handle is frozen, so it is safe to share between
 * components and to keep in module scope.
 *
 * @example
 * ```ts
 * const project: ZitadelProject = configureZitadel({ projectId: "…" });
 * ```
 */
export interface ZitadelProject {
  /**
   * The same-origin path that the widgets call.
   */
  readonly proxyPath: string;
  /**
   * The id of the project the app signs users in to.
   */
  readonly projectId: string;
  /**
   * The full URL of the Zitadel server, set only where server-side code configured it.
   */
  readonly url?: string;
  /**
   * The publishable key of the project, sent as the bearer on the public calls when it is set.
   */
  readonly publishableKey?: string;
}

/**
 * The typed API client for one project, with its base URL already bound.
 *
 * The client is generated from the API description and changes with it. It is for apps that call
 * the API themselves. The widgets and the middleware do not need it.
 */
export type { ZitadelApi };

/**
 * Registers the project that the app signs users in to and returns the frozen
 * {@link ZitadelProject} handle.
 *
 * Call it once, as early as the app starts. The registration is write-once on purpose: a second
 * call with the same values returns the original handle, and a second call with different values
 * logs a warning and still returns the original. That keeps a hot reload or a framework that
 * mounts twice from silently changing the project in the middle of a session.
 *
 * The handle is also kept on the global object, so copies of an SDK that end up twice in a bundle
 * still agree on one project.
 *
 * @param config - The project id and, optionally, the proxy path, server URL and publishable key.
 * @returns The frozen handle to pass to the widgets as `project`.
 *
 * @example
 * ```ts
 * import { configureZitadel } from "@zitadel/sdk-react";
 *
 * export const project = configureZitadel({
 *   projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
 *   proxyPath: "/__nextgen",
 * });
 * ```
 */
export function configureZitadel(config: ZitadelConfig): ZitadelProject {
  return configureApi(config);
}

/**
 * Returns the project handle that {@link configureZitadel} registered, or `null` when it has not
 * been called yet.
 *
 * Use it in code that cannot receive the handle as an argument, for example a helper that runs
 * outside the component tree. A widget that finds no handle shows a configuration error, so check
 * for `null` before relying on the result.
 *
 * @returns The registered handle, or `null`.
 *
 * @example
 * ```ts
 * const project = getZitadelConfig();
 * if (project === null) {
 *   throw new Error("Call configureZitadel() before this code runs.");
 * }
 * ```
 */
export function getZitadelConfig(): ZitadelProject | null {
  return getApiConfig();
}

/**
 * Returns the typed API client for a project, with the proxy path already bound as its base URL.
 *
 * The result is cached per handle, so calling it again with the same handle returns the same
 * client. When the handle carries a publishable key, the client sends it as the bearer on every
 * call.
 *
 * @param project - The handle that {@link configureZitadel} returned.
 * @returns The API client for that project.
 *
 * @example
 * ```ts
 * const api = getApi(project);
 * ```
 */
export function getApi(project: ZitadelProject): ZitadelApi {
  return getApiClient(project);
}
