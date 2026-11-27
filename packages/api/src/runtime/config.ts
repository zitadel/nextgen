import { createZitadelApi, type ZitadelApi } from "./api-factory";
import { ZitadelClient } from "./client";

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

  /**
   * The project's **publishable key** (ADR 036): an origin-scoped,
   * browser-safe bearer sent on public-plane calls (flow operations and the
   * body-delivered handoff exchange). Safe to ship in client bundles and
   * committed config by construction — never put a project secret
   * (`sk_proj_…`) here. Optional — omitted, requests carry no bearer and
   * secret-requiring operations must be authenticated by a server-side
   * proxy instead.
   */
  publishableKey?: string;
}

/**
 * The initialized project handle returned by `configureZitadel`.
 * Pure data — use factory functions like `getApi` to derive services.
 */
export interface ZitadelProject {
  /** Proxy path for API requests. */
  readonly proxyPath: string;

  /** Project ID passed to flow creation. */
  readonly projectId: string;

  /** Full URL of the Zitadel auth backend. */
  readonly url?: string;

  /** The project's publishable key (ADR 036), sent as the bearer when set. */
  readonly publishableKey?: string;
}

export type { ZitadelApi };

/**
 * Slot for the configured project, stored on `globalThis` under a
 * {@link Symbol.for} key. Every copy of this module evaluated in the
 * same JS realm resolves the symbol through the global symbol registry
 * to the same identity, so they all read and write a single slot —
 * needed because the standalone components bundle inlines its own copy
 * of this file, and dual-package hazards / monorepo duplicates can load
 * a second copy alongside the app's. With a module-local `let` each
 * instance kept its own singleton and `configureZitadel()` calls in one
 * were invisible to `getZitadelConfig()` calls in another. Sharing is
 * realm-scoped — separate realms (iframes, Node `vm` contexts, worker
 * threads) have their own registries and are not unified by this.
 */
const PROJECT_SLOT = Symbol.for("@zitadel/api/config:currentProject");

function readSlot(): ZitadelProject | null {
  const value = (globalThis as Record<symbol, unknown>)[PROJECT_SLOT];
  return (value as ZitadelProject | null | undefined) ?? null;
}

function writeSlot(value: ZitadelProject | null): void {
  (globalThis as Record<symbol, unknown>)[PROJECT_SLOT] = value;
}

/**
 * Per-project API client cache. Ensures `getApi(project)` returns the
 * same instance for the same project handle — no re-wrapping on every call.
 * Module-local on purpose: keyed by the shared frozen `ZitadelProject`
 * object identity, so cross-instance reads still resolve through the
 * same key and at worst memoize once per module instance.
 */
const apiCache = new WeakMap<ZitadelProject, ZitadelApi>();

/** Per-project client cache, for the same reason as {@link apiCache}. */
const clientCache = new WeakMap<ZitadelProject, ZitadelClient>();

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
  const existing = readSlot();

  if (existing !== null) {
    if (
      existing.proxyPath === resolvedProxyPath &&
      existing.projectId === config.projectId &&
      existing.url === config.url &&
      existing.publishableKey === config.publishableKey
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
    publishableKey: config.publishableKey,
  });
  writeSlot(project);
  return project;
}

/**
 * Returns the {@link ZitadelClient} for the given project: its proxy path as
 * the base URL and its publishable key (when the handle carries one) as the
 * bearer, the ADR 036 public-plane credential. The app's own client may run
 * destructive operations, since signing out is a `DELETE`. Cached per project
 * handle — safe to call multiple times.
 *
 * Call the generated operations with it to bundle only those you use:
 *
 * ```ts
 * import { getMySession } from "@zitadel/api/generated/endpoints/zitadelNextGen";
 * const session = await getMySession(getClient(project));
 * ```
 */
export function getClient(project: ZitadelProject): ZitadelClient {
  let client = clientCache.get(project);
  if (!client) {
    client = new ZitadelClient({
      baseUrl: project.proxyPath,
      token: project.publishableKey,
      allowDestructive: true,
    });
    clientCache.set(project, client);
  }
  return client;
}

/**
 * Returns every operation bound to the project's {@link getClient} client.
 * It imports every operation; code that calls a few should call them with
 * {@link getClient} instead. Cached per project handle — safe to call multiple times.
 *
 * ```ts
 * const project = configureZitadel({ ... });
 * export const api = getApi(project);
 * ```
 */
export function getApi(project: ZitadelProject): ZitadelApi {
  let api = apiCache.get(project);
  if (!api) {
    api = createZitadelApi(getClient(project));
    apiCache.set(project, api);
  }
  return api;
}

/**
 * Returns the current project handle, or `null` if {@link configureZitadel}
 * has not been called yet.
 */
export function getZitadelConfig(): ZitadelProject | null {
  return readSlot();
}

/**
 * Reset internal state. **Test-only**, and not part of the supported
 * public API even though the `./config` subpath ships every binding in
 * this module: the leading `_` marks it as private and the behaviour
 * is free to change without notice. Lets tests call `configureZitadel()`
 * multiple times across isolated cases without the write-once guard
 * rejecting them.
 */
export function _resetConfigForTesting(): void {
  writeSlot(null);
}
