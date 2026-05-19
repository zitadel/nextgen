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
import {
  createFlow,
  exchangeHandoff,
  getFlowStep,
  submitFlowStep,
} from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen";
import type {
  CreateFlow201,
  CreateFlowBody,
  ExchangeHandoff200,
  ExchangeHandoffBody,
  SubmitFlowStepBody,
} from "@zitadel-nextgen/api/generated/model";

const apiRequestInit: RequestInit = { credentials: "include" };

export async function startFlow(input: CreateFlowBody): Promise<CreateFlow201> {
  return createFlow(input, apiRequestInit);
}

export async function submitStep(
  id: string,
  body: SubmitFlowStepBody,
): Promise<CreateFlow201> {
  return submitFlowStep(id, body, apiRequestInit);
}

export async function getCurrentStep(id: string): Promise<CreateFlow201> {
  return getFlowStep(id, apiRequestInit);
}

/**
 * Exchange a terminal-flow `handoff_token` for an authenticated session.
 * The server sets the `__nextgen_session` HttpOnly cookie on success.
 */
export async function exchangeSession(
  body: ExchangeHandoffBody,
): Promise<ExchangeHandoff200> {
  return exchangeHandoff(body, apiRequestInit);
}
