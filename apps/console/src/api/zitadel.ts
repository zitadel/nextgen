import { configureZitadel, getApi } from "@zitadel/api/config";

/**
 * Console SDK configuration (Console ADR 0002).
 *
 * The console holds no credential: it issues same-origin API requests and
 * lets the platform authenticate them. Where "same-origin" points differs
 * by *who serves the console*, and only by that:
 *
 * - **Dev** — Vite serves the console on :5174 and the API lives on :8080,
 *   so requests target `/api/v1` on Vite's origin, which the dev-server proxy
 *   forwards unchanged and without adding a credential (`vite.config.ts`,
 *   #1300): the `__nextgen_session` cookie rides along, as in production.
 * - **Production** — the built console is embedded in the Go binary, which
 *   serves the API under `/api/v1` (`buildHTTPMux`, ADR 077). Requests go
 *   to `/api/v1/flow`, `/api/v1/sessions/me`, … on the same origin, carrying
 *   the `__nextgen_session` cookie and (on public-plane calls) the
 *   runtime-discovered publishable key.
 *
 * Either way the base is `""`: the generated client adds `/api/v1` itself.
 * `VITE_CONSOLE_API_BASE` remains the escape hatch for a deployment that puts
 * the server behind a path or on another origin: it goes in front of the
 * `/api/v1`.
 *
 * No project id is configured here. The project the console signs into is
 * learnt at boot from `/console/runtime.json` (Console ADR 0004 §3), in
 * development as in production, and read through `getConsoleProjectId()`;
 * management calls name the selected project (`src/lib/project-scope.ts`).
 */
/**
 * What every console request puts in front of the API's `/api/v1` (Console
 * ADR 0002): nothing, so the page's own origin, unless `VITE_CONSOLE_API_BASE`
 * names a path or an origin. An empty var counts as unset, as it does for the
 * dev proxy (`vite.config.ts`).
 */
export const apiBase = import.meta.env.VITE_CONSOLE_API_BASE || "";

/**
 * The app-wide `ZitadelProject` handle — root ADR 016: configure once,
 * derive everywhere. It carries no project id: the console learns the project
 * it signs into at boot, from the runtime document, after this module has
 * run. Callers needing it use `getConsoleProjectId()` in
 * `src/runtime/runtime.ts` (Console ADR 0004 §3); a screen that mounts
 * `<zitadel-login>` passes its own handle (`useConsoleProject`).
 */
export const project = configureZitadel({ proxyPath: apiBase, projectId: "" });

/** Typed Zitadel API client, base URL pre-bound, no client-held token. */
export const api = getApi(project);
