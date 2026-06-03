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

/**
 * The app-wide project handle lives on `globalThis` under a registered symbol,
 * not in a module-local variable. Bundlers can emit more than one copy of this
 * module — `@zitadel-nextgen/components`, for instance, bundles its own copy —
 * and a module-local `let` gives each copy its own slot, so `configureZitadel()`
 * in the app and `getZitadelConfig()` inside the web component would read
 * different values. A `Symbol.for(...)` key on `globalThis` is shared across
 * every copy in the realm, so all of them observe the one handle.
 */
const PROJECT_KEY = Symbol.for("@zitadel-nextgen/api#currentProject");

type ProjectStore = Record<symbol, ZitadelProject | null | undefined>;

function getCurrentProject(): ZitadelProject | null {
  return (globalThis as ProjectStore)[PROJECT_KEY] ?? null;
}

function setCurrentProject(project: ZitadelProject | null): void {
  (globalThis as ProjectStore)[PROJECT_KEY] = project;
}

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

  const existing = getCurrentProject();
  if (existing !== null) {
    // Same values → no-op (safe for HMR / React strict mode double-mount)
    if (
      existing.proxyPath === resolvedProxyPath &&
      existing.projectId === config.projectId &&
      existing.url === config.url
    ) {
      return existing;
    }
    console.warn(
      `[zitadel] configureZitadel() already called with different values. ` +
        `Ignoring: ${JSON.stringify(config)}`,
    );
    return existing;
  }

  const project = Object.freeze({
    proxyPath: resolvedProxyPath,
    projectId: config.projectId,
    url: config.url,
  });
  setCurrentProject(project);

  // Keep the global in sync for the generated code's internal use
  setProxyPath(resolvedProxyPath);

  return project;
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
  return getCurrentProject();
}

/**
 * Reset internal state. **Test-only** — not exported from the package's
 * public API. Allows tests to call `configureZitadel()` multiple times
 * across isolated test cases without the write-once guard rejecting them.
 */
export function _resetConfigForTesting(): void {
  setCurrentProject(null);
  setProxyPath("");
}
