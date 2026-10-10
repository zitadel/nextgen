import { type ZitadelProject, configureZitadel, getApi } from "@zitadel/api/config";

import type { ConsoleRegion } from "@/runtime/runtime";

/**
 * Console SDK configuration (Console ADR 0002).
 *
 * The console holds no credential: it issues same-origin API requests and
 * lets the platform authenticate them. Where "same-origin" points differs
 * by *who serves the console*, and only by that:
 *
 * - **Dev** — Vite serves the console on :5174 and the API lives on :8080,
 *   so requests target `/api`, which the dev-server proxy strips and
 *   forwards without adding a credential (`vite.config.mts`, #1300): the
 *   `__nextgen_session` cookie rides along, as in production.
 * - **Production** — the built console is embedded in the Go binary, which
 *   serves the ogen API at the origin root (`buildHTTPMux`). The base is
 *   therefore `""`: requests go straight to `/flow`, `/sessions/me`, … on
 *   the same origin, carrying the `__nextgen_session` cookie and (on
 *   public-plane calls) the runtime-discovered publishable key.
 *
 * Nothing is mounted at `/api` in the binary (Console ADR 0002 §4); the
 * embedded build targets the origin root, as the hosted login shell does
 * (`apps/login-ui/src/main.ts`). `VITE_CONSOLE_API_BASE` remains the escape
 * hatch for a deployment that mounts the API elsewhere.
 *
 * No project id is configured here. The project the console signs into is
 * learnt at boot from `/console/runtime.json` (Console ADR 0004 §3), in
 * development as in production, and read through `getConsoleProjectId()`;
 * management calls name the selected project (`src/lib/project-scope.ts`).
 */
/**
 * The same-origin API base every console request targets (Console ADR 0002).
 * `||`, not `??`: the dev proxy (`vite.config.mts`) treats an empty
 * `VITE_CONSOLE_API_BASE` as unset, so the client must too — with `??`, a
 * present-but-empty var in a shell or CI would silently bypass the dev proxy.
 */
export const apiBase = import.meta.env.VITE_CONSOLE_API_BASE || (import.meta.env.DEV ? "/api" : "");

/**
 * The app-wide `ZitadelProject` handle — root ADR 016: configure once,
 * derive everywhere. It carries no project id: the console learns the project
 * it signs into at boot, from the runtime document, after this module has
 * run. Callers needing it use `getConsoleProjectId()` in
 * `src/runtime/runtime.ts` (Console ADR 0004 §3); a screen that mounts
 * `<zitadel-login>` passes its own handle (`useConsoleProject`).
 */
export const project = configureZitadel({ proxyPath: apiBase, projectId: "" });

/**
 * The client of the deployment that serves the console — in platform mode the
 * identity home (Console ADR 0004 §6). The session lives there whatever
 * project is selected, so the session helpers and the sign-in handle use this
 * one and never {@link api}.
 */
export const homeApi = getApi(project);

type Api = typeof homeApi;

/**
 * A region's API base joined with the console's own: a path (`/eu`) sits below
 * the console's base — the dev proxy's `/api`, or the origin root — so the
 * same cookie and the same CSRF token reach it; an absolute URL stands on its
 * own.
 */
export function resolveRegionBase(regionBase: string): string {
  return /^https?:\/\//.test(regionBase) ? regionBase : `${apiBase}${regionBase}`;
}

const regionHandles = new Map<string, ZitadelProject>();

/**
 * The client of a region, by its API base. One handle per base, kept so the
 * SDK's per-handle client cache applies (`getApi`), with no project id and no
 * key: a region is called with the session cookie like the home is.
 */
export function apiForRegion(region: Pick<ConsoleRegion, "api_base">): Api {
  const base = resolveRegionBase(region.api_base);
  let handle = regionHandles.get(base);
  if (!handle) {
    handle = Object.freeze({ projectId: "", proxyPath: base });
    regionHandles.set(base, handle);
  }
  return getApi(handle);
}

let active: Api = homeApi;

/**
 * Points {@link api} at a region, or back at the home with `undefined`.
 *
 * In platform mode a project lives in one region, and every call a
 * project-scoped screen makes has to reach that region's API. Rather than
 * thread a client through twenty screens, the `_authed` guard sets the active
 * region from the selected project (`?project=`, `lib/project-scope.ts`)
 * before any loader runs, and the screens keep calling {@link api}. Standalone
 * never calls this: the home is the one deployment.
 */
export function setActiveApi(region: Pick<ConsoleRegion, "api_base"> | undefined): void {
  active = region ? apiForRegion(region) : homeApi;
}

/** Test-only: the client {@link api} currently forwards to. */
export function _getActiveApiForTesting(): Api {
  return active;
}

/**
 * Typed Zitadel API client, base URL pre-bound, no client-held token: the
 * client of the selected project's region in platform mode (see
 * {@link setActiveApi}), of the one deployment otherwise.
 */
export const api: Api = new Proxy(homeApi, {
  get: (_target, property) => Reflect.get(active, property, active),
});
