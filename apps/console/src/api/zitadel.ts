import { configureZitadel, getApi } from "@zitadel/api/config";

/**
 * Console SDK configuration (Console ADR 0002).
 *
 * The console holds no credential: it issues same-origin API requests and
 * lets the platform authenticate them. Where "same-origin" points differs
 * by *who serves the console*, and only by that:
 *
 * - **Dev** — Vite serves the console on :5174 and the API lives on :8080,
 *   so requests target `/api`, which the dev-server proxy strips and
 *   forwards, injecting the project secret server-side (`vite.config.mts`).
 * - **Production** — the built console is embedded in the Go binary, which
 *   serves the ogen API at the origin root (`buildHTTPMux`). The base is
 *   therefore `""`: requests go straight to `/flow`, `/sessions/me`, … on
 *   the same origin, carrying the `__nextgen_session` cookie and (on
 *   public-plane calls) the runtime-discovered publishable key.
 *
 * ADR 0002 §4 originally assumed a Go-side `/api` shim mirroring the dev
 * proxy. It was never built and is no longer needed: the secret it would
 * have injected has no counterpart in the browser-safe credentials the
 * console uses today (root ADR 036's publishable key + the session cookie),
 * so it would be a bare prefix strip that publishes the whole API under a
 * second path. Defaulting to root instead is what the hosted login shell
 * already does (`apps/login-ui/src/main.ts`). `VITE_CONSOLE_API_BASE`
 * remains the escape hatch for a deployment that mounts the API elsewhere.
 *
 * `projectId` is non-secret public runtime metadata (it scopes list/detail
 * calls that require a `project_id` query param) and is read from a public
 * `VITE_`-prefixed env var.
 */
/**
 * The same-origin API base every console request targets (Console ADR 0002).
 * `||`, not `??`: the dev proxy (`vite.config.mts`) treats an empty
 * `VITE_CONSOLE_API_BASE` as unset, so the client must too — with `??`, a
 * present-but-empty var in a shell or CI would silently bypass the dev proxy.
 */
export const apiBase =
  import.meta.env.VITE_CONSOLE_API_BASE || (import.meta.env.DEV ? "/api" : "");

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
