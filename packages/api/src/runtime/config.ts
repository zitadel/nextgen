import { setProxyPath } from "./base-url";
import { createApi, type ZitadelApi } from "./api-factory";

/**
 * Input options for {@link configureZitadel}.
 */
export interface ZitadelConfig {
  /** Proxy path for API requests (e.g. `"/__nextgen"`). Optional — defaults to `"/__nextgen"`. */
  proxyPath?: string;

  /** Project ID passed to flow creation. */
  projectId: string;

  /**
   * Full URL of the Zitadel auth backend (e.g. `"http://localhost:8080"`).
   * Used by server-side middleware for proxying and JWT verification.
   * Optional — not needed in client-only setups.
   */
  url?: string;
}

/**
 * The initialized project handle returned by {@link configureZitadel}.
 * Pure data — use factory functions like {@link getApi} to derive services.
 */
export interface ZitadelProject {
  /** Proxy path for API requests. */
  readonly proxyPath: string;

  /** Project ID passed to flow creation. */
  readonly projectId: string;

  /** Full URL of the Zitadel auth backend. */
  readonly url?: string;
}

export type { ZitadelApi };

let currentProject: ZitadelProject | null = null;

/**
 * Per-project API client cache. Ensures `getApi(project)` returns the
 * same instance for the same project handle — no re-wrapping on every call.
 */
const apiCache = new WeakMap<ZitadelProject, ZitadelApi>();

/**
 * Initializes app-wide SDK configuration and returns the frozen
 * {@link ZitadelProject} handle.
 *
 * Write-once — subsequent calls with the same values return the original
 * handle; calls with different values log a warning and return the
 * original. This prevents accidental overwrites while remaining safe
 * for HMR and framework double-mounts.
 */
export function configureZitadel(config: ZitadelConfig): ZitadelProject {
  const resolvedProxyPath = config.proxyPath ?? "/__nextgen";

  if (currentProject !== null) {
    // Same values → no-op (safe for HMR / React strict mode double-mount)
    if (
      currentProject.proxyPath === resolvedProxyPath &&
      currentProject.projectId === config.projectId &&
      currentProject.url === config.url
    ) {
      return currentProject;
    }
    console.warn(
      `[zitadel] configureZitadel() already called with different values. ` +
        `Ignoring: ${JSON.stringify(config)}`,
    );
    return currentProject;
  }

  currentProject = Object.freeze({
    proxyPath: resolvedProxyPath,
    projectId: config.projectId,
    url: config.url,
  });

  // Keep the global in sync for the generated code's internal use
  setProxyPath(resolvedProxyPath);

  return currentProject;
}

/**
 * Returns a typed API client for the given project, with the base URL
 * pre-bound. Cached per project handle — safe to call multiple times.
 *
 * ```ts
 * const project = configureZitadel({ ... });
 * export const api = getApi(project);
 * ```
 */
export function getApi(project: ZitadelProject): ZitadelApi {
  let api = apiCache.get(project);
  if (!api) {
    api = createApi(project.proxyPath);
    apiCache.set(project, api);
  }
  return api;
}

/**
 * Returns the current project handle, or `null` if {@link configureZitadel}
 * has not been called yet.
 */
export function getZitadelConfig(): ZitadelProject | null {
  return currentProject;
}

/**
 * Reset internal state. **Test-only** — not exported from the package's
 * public API. Allows tests to call `configureZitadel()` multiple times
 * across isolated test cases without the write-once guard rejecting them.
 */
export function _resetConfigForTesting(): void {
  currentProject = null;
  setProxyPath("");
}
