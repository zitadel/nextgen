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

/** Frozen project handle passed to the widgets via the `project` input. */
export interface ZitadelProject {
  readonly proxyPath: string;
  readonly projectId: string;
  readonly url?: string;
  /** The release a flow start pins, sent as `X-Zitadel-Release` when set. */
  readonly release?: string;
}

/** Input options for {@link configureZitadel}. */
export interface ZitadelConfig {
  /** Proxy path for API requests. Defaults to `"/__nextgen"`. */
  proxyPath?: string;
  /** Project id passed to flow creation. */
  projectId: string;
  /** Full backend URL (server-side only; optional for client SPAs). */
  url?: string;
  /**
   * The release this build was made against, as `zitadel deploy` or
   * `zitadel preview` printed it. The widget sends it as `X-Zitadel-Release`
   * when a flow starts; empty pins nothing.
   */
  release?: string;
}

/**
 * Builds the project handle to pass to `<zitadel-auth-login [project]>`.
 *
 * ```ts
 * const project = configureZitadel({ projectId: "…", proxyPath: "/__nextgen" });
 * ```
 */
export function configureZitadel(config: ZitadelConfig): ZitadelProject {
  return Object.freeze({
    proxyPath: config.proxyPath ?? "/__nextgen",
    projectId: config.projectId,
    url: config.url,
    release: config.release || undefined,
  });
}
