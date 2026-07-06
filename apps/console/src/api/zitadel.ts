import { configureZitadel, getApi } from "@zitadel/api/config";

/**
 * Console SDK configuration (Console ADR 0002).
 *
 * The console holds no credential. Requests go to a same-origin API base
 * (`/api` by default); in dev the Vite proxy injects the project-secret
 * bearer server-side, and in production the Go server will do the same.
 * The browser bundle never contains a secret.
 *
 * `projectId` is non-secret public runtime metadata (it scopes list/detail
 * calls that require a `project_id` query param) and is read from a public
 * `VITE_`-prefixed env var.
 */
const project = configureZitadel({
  proxyPath: import.meta.env.VITE_CONSOLE_API_BASE ?? "/api",
  projectId: import.meta.env.VITE_CONSOLE_PROJECT_ID ?? "",
});

/** Typed Zitadel API client, base URL pre-bound, no client-held token. */
export const api = getApi(project);

/** The configured project id, passed to operations that require `project_id`. */
export const projectId = project.projectId;
