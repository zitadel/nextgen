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
/** The same-origin API base every console request targets (Console ADR 0002). */
export const apiBase = import.meta.env.VITE_CONSOLE_API_BASE ?? "/api";

/**
 * The app-wide `ZitadelProject` handle — root ADR 016: configure once,
 * derive everywhere. The `projectId` recorded here is only the build-time
 * env override; the *effective* project id is resolved through
 * `getConsoleProjectId()` in `src/runtime/runtime.ts`, which prefers this
 * override and falls back to the runtime-discovered `console_project_id`
 * (Console ADR 0004 §5). Callers needing a project id must use that helper
 * rather than this handle's field.
 */
export const project = configureZitadel({
  proxyPath: apiBase,
  projectId: import.meta.env.VITE_CONSOLE_PROJECT_ID ?? "",
});

/** Typed Zitadel API client, base URL pre-bound, no client-held token. */
export const api = getApi(project);
