/**
 * Thin wrappers around the orval-generated `@zitadel-nextgen/api` fetch
 * functions for the three Flow API operations the orchestrator drives:
 *
 * - `POST /flow`              — `createFlow`
 * - `POST /flow/{id}/submit`  — `submitFlowStep`
 * - `GET  /flow/{id}`         — `getFlowStep`
 * - `POST /sessions/exchange` — `exchangeHandoff`
 *
 * The wrappers exist for one reason: every Flow API call must run with
 * `credentials: "include"` so the stateless `_zflow` HttpOnly cookie
 * round-trips. Centralising that here keeps every call site honest.
 *
 * Types come straight from `@zitadel-nextgen/api/generated/model`. Orval
 * emits per-operation aliases (`CreateFlow201`, `GetFlowStep200`,
 * `SubmitFlowStep200`) for what is structurally the same response; the
 * orchestrator stores them as `CreateFlow201` because that is the alias
 * orval gives the start-of-flow response.
 */
import type { ZitadelApi } from "@zitadel-nextgen/api/config";
import type {
  CreateFlow201,
  CreateFlowBody,
  ExchangeHandoff200,
  ExchangeHandoffBody,
  SubmitFlowStepBody,
} from "@zitadel-nextgen/api/generated/model";

/** OpenAPI default; used when `session-exchange-path` is omitted on `<zitadel-login>`. */
export const DEFAULT_SESSION_EXCHANGE_PATH = "/sessions/exchange";

const apiRequestInit: RequestInit = { credentials: "include" };

/**
 * Resolve the URL for `POST …/sessions/exchange` (or a host override).
 *
 * - Default path (`/sessions/exchange`): prefixed with `apiBase` so
 *   `api-base="/__nextgen"` continues to hit `/__nextgen/sessions/exchange`.
 * - Any other path: resolved from `location.origin`, independent of
 *   `api-base`, for SPAs that rewrite exchange under a separate prefix
 *   (e.g. `/api/auth/exchange`).
 */
export function resolveSessionExchangeUrl(
  apiBase: string,
  sessionExchangePath = DEFAULT_SESSION_EXCHANGE_PATH,
): string {
  const path = sessionExchangePath.startsWith("/")
    ? sessionExchangePath
    : `/${sessionExchangePath}`;

  if (path !== DEFAULT_SESSION_EXCHANGE_PATH) {
    const origin =
      typeof globalThis.location !== "undefined" ? globalThis.location.origin : "";
    if (!origin) {
      throw new Error("Custom session-exchange-path requires a browser origin.");
    }
    return new URL(path, origin).href;
  }

  const base = apiBase.replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

export async function startFlow(api: ZitadelApi, input: CreateFlowBody): Promise<CreateFlow201> {
  return api.createFlow(input, apiRequestInit);
}

export async function submitStep(
  api: ZitadelApi,
  id: string,
  body: SubmitFlowStepBody,
): Promise<CreateFlow201> {
  return api.submitFlowStep(id, body, apiRequestInit);
}

export async function getCurrentStep(api: ZitadelApi, id: string): Promise<CreateFlow201> {
  return api.getFlowStep(id, apiRequestInit);
}

/**
 * Exchange a terminal-flow `handoff_token` for an authenticated session.
 * The server sets the `__nextgen_session` HttpOnly cookie on success.
 */
export async function exchangeSession(
  apiBase: string,
  body: ExchangeHandoffBody,
  sessionExchangePath?: string,
): Promise<ExchangeHandoff200> {
  const res = await fetch(resolveSessionExchangeUrl(apiBase, sessionExchangePath), {
    ...apiRequestInit,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = [204, 205, 304].includes(res.status) ? null : await res.text();
  const data: ExchangeHandoff200 = text ? JSON.parse(text) : {};
  return data;
}
