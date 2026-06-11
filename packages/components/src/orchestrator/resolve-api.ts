import { getApi, getZitadelConfig, type ZitadelApi, type ZitadelProject } from "@zitadel/api/config";

/**
 * Resolves the effective SDK project handle and its typed API client for an
 * orchestrator element. Prefers the element's `project` property; falls back
 * to the global handle set by `configureZitadel()`.
 *
 * Both `<zitadel-login>` and `<zitadel-logout>` need the same resolution and
 * the same "no config" failure, so it lives here rather than being copied
 * into each element. Callers run this inside their try/catch so a missing
 * configuration surfaces through the element's normal error path rather than
 * as an unhandled rejection.
 *
 * @param project Optional per-element override handle.
 * @param element Tag name used in the thrown error (e.g. `<zitadel-login>`).
 */
export function resolveApi(
  project: ZitadelProject | undefined,
  element: string,
): { project: ZitadelProject; api: ZitadelApi } {
  const cfg = project ?? getZitadelConfig();
  if (!cfg) {
    throw new Error(
      `${element} requires a configured project: call configureZitadel() or set the \`project\` property.`,
    );
  }
  return { project: cfg, api: getApi(cfg) };
}
