/**
 * SDK configuration for the Angular wrapper.
 *
 * `@zitadel/api` is published with subpath-only `exports` and no main entry,
 * which ng-packagr's module resolution cannot follow. For the client-side SPA
 * (prop-based) flow the widget only needs a plain handle — `{ projectId,
 * proxyPath }` — which it reads directly. So this package builds that handle
 * locally rather than importing `configureZitadel` from `@zitadel/api`, keeping
 * the Angular library self-contained.
 */

/**
 * Frozen project handle passed to the widgets via their `project` input.
 *
 * Build it with {@link configureZitadel}. It is a plain object so the widgets
 * can read it as a DOM property without this package importing `@zitadel/api`.
 */
export interface ZitadelProject {
  /**
   * Same-origin path the widgets call, `"/__nextgen"` unless overridden. In
   * local development it may also be a backend origin, which makes the calls
   * cross-origin.
   */
  readonly proxyPath: string;
  /** Id of the Zitadel project the widgets start flows for. */
  readonly projectId: string;
  /**
   * Full backend URL, written to the `url` attribute. Only the server side
   * needs it; a client-side SPA leaves it unset.
   */
  readonly url?: string;
}

/** Input options for {@link configureZitadel}. */
export interface ZitadelConfig {
  /**
   * Same-origin path the widgets call. Defaults to `"/__nextgen"`, the
   * proxy that fronts the API on the app's own origin.
   */
  proxyPath?: string;
  /** Id of the Zitadel project; sent when a flow is created. */
  projectId: string;
  /**
   * Full backend URL. Only server-side code needs it, so a client-side SPA
   * leaves it unset.
   */
  url?: string;
}

/**
 * Builds the project handle to pass to `<zitadel-auth-login [project]>`.
 *
 * Call it once per app and share the result. The handle is frozen, and
 * `proxyPath` falls back to `"/__nextgen"` when omitted.
 *
 * @param config - The project id and optional proxy path and backend URL.
 * @returns The frozen {@link ZitadelProject} handle.
 *
 * @example
 * ```ts
 * const project = configureZitadel({ projectId: "…", proxyPath: "/__nextgen" });
 * ```
 */
export function configureZitadel(config: ZitadelConfig): ZitadelProject {
  return Object.freeze({
    proxyPath: config.proxyPath ?? "/__nextgen",
    projectId: config.projectId,
    url: config.url,
  });
}
