/**
 * The dev proxy's credential rule (`vite.config.mts`), kept here so a spec can
 * pin it. Node-side only: nothing in the app imports this.
 *
 * Whether a proxied request is scoped to a project other than the one the
 * injected secret belongs to. A project is named either by the `project_id`
 * query parameter (grants, schemas, …) or by the path (`/projects/{id}` and
 * everything under it). A request that names no project is not scoped
 * elsewhere: those are the credential's own (users, teams, `/projects/query`).
 *
 * An empty `secretProjectId` means the proxy does not know which project the
 * secret belongs to, so nothing counts as "other" and the secret is injected
 * as it was before this rule existed.
 */
export function targetsOtherProject(path: string, secretProjectId: string): boolean {
  if (!secretProjectId) return false;
  const url = new URL(path, "http://proxy.invalid");
  // `/projects/query` is the list; only a resource id names a project.
  const target =
    url.searchParams.get("project_id") ??
    /^\/projects\/(?!query(?:\/|$))([^/]+)/.exec(url.pathname)?.[1] ??
    null;
  return target !== null && target !== secretProjectId;
}
