import {
  getApi,
  getZitadelConfig,
  type ZitadelApi,
  type ZitadelProject,
} from "@zitadel/api/config";

/** Matches the `configureZitadel()` default so attribute and JS config agree. */
const DEFAULT_PROXY_PATH = "/__nextgen";

/**
 * Declarative configuration read from an element's HTML attributes
 * (`project-id` / `proxy-path` / `url`). Empty strings mean "unset".
 */
export interface ProjectAttrs {
  readonly projectId: string;
  readonly proxyPath: string;
  readonly url: string;
}

/**
 * Cache of project handles synthesized from attributes, keyed by their value
 * tuple. `getApi()` caches its client in a `WeakMap` keyed by the project's
 * identity, so the same attribute values must yield the *same* frozen object
 * across the several `resolveApi()` calls a single flow makes — otherwise
 * every call misses the cache and re-wraps a fresh client. Distinct configs
 * on one page are effectively one, so this never grows unbounded in practice.
 */
const syntheticProjects = new Map<string, ZitadelProject>();

/**
 * Builds a `ZitadelProject` from declarative attributes, or `undefined` when
 * no `project-id` was given (nothing to configure). Mirrors
 * `configureZitadel()`'s proxy-path defaulting so the two config paths are
 * interchangeable.
 */
function projectFromAttrs({ projectId, proxyPath, url }: ProjectAttrs): ZitadelProject | undefined {
  if (!projectId) return undefined;
  const resolvedProxyPath = proxyPath || DEFAULT_PROXY_PATH;
  const resolvedUrl = url || undefined;
  const key = JSON.stringify([projectId, resolvedProxyPath, resolvedUrl ?? ""]);
  let project = syntheticProjects.get(key);
  if (!project) {
    project = Object.freeze({ projectId, proxyPath: resolvedProxyPath, url: resolvedUrl });
    syntheticProjects.set(key, project);
  }
  return project;
}

/**
 * Resolves the effective SDK project handle and its typed API client for an
 * orchestrator element. Precedence, highest first:
 *
 * 1. the element's `project` property (an SDK handle set from JS / a framework),
 * 2. the global handle from `configureZitadel()`,
 * 3. the `project-id` / `proxy-path` / `url` attributes set declaratively in HTML.
 *
 * Both JS paths (property and global) win over the declarative attributes, so a
 * deliberate `configureZitadel()` is never silently overridden by fallback or
 * stale HTML attributes; the attributes are the no-JS fallback.
 *
 * Both `<zitadel-login>` and `<zitadel-logout>` need the same resolution and
 * the same "no config" failure, so it lives here rather than being copied
 * into each element. Callers run this inside their try/catch so a missing
 * configuration surfaces through the element's normal error path rather than
 * as an unhandled rejection.
 *
 * @param project Optional per-element override handle.
 * @param attrs Declarative config read from the element's attributes.
 * @param element Tag name used in the thrown error (e.g. `<zitadel-login>`).
 */
export function resolveApi(
  project: ZitadelProject | undefined,
  attrs: ProjectAttrs,
  element: string,
): { project: ZitadelProject; api: ZitadelApi } {
  const cfg = project ?? getZitadelConfig() ?? projectFromAttrs(attrs);
  if (!cfg) {
    throw new Error(
      `${element} requires a configured project: set the \`project-id\` attribute, ` +
        `set the \`project\` property, or call configureZitadel().`,
    );
  }
  return { project: cfg, api: getApi(cfg) };
}
