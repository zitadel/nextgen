/**
 * Thin wrappers around the orval-generated `@zitadel/api` fetch
 * functions for the API operations the orchestrator drives:
 *
 * - `POST /flow`              — `createFlow`
 * - `POST /flow/{id}/submit`  — `submitFlowStep`
 * - `GET  /flow/{id}`         — `getFlowStep`
 * - `POST /sessions/exchange` — `exchangeHandoff`
 *
 * The wrappers exist for one reason: every API call must run with
 * `credentials: "include"` so the stateless `_zflow` HttpOnly cookie
 * round-trips. Centralising that here keeps every call site honest.
 *
 * Types come straight from `@zitadel/api/generated/model`. Orval
 * emits per-operation aliases (`CreateFlow201`, `GetFlowStep200`,
 * `SubmitFlowStep200`) for what is structurally the same response; the
 * orchestrator stores them as `CreateFlow201` because that is the alias
 * orval gives the start-of-flow response.
 */
import type { ZitadelApi } from "@zitadel/api/config";
import type {
  CreateFlow201,
  CreateFlowBody,
  ExchangeHandoff200,
  ExchangeHandoffBody,
  ExchangeHandoffParams,
  SubmitFlowStepBody,
} from "@zitadel/api/generated/model";
import { ApiError } from "@zitadel/api/runtime/fetch";

const apiRequestInit: RequestInit = { credentials: "include" };

export async function startFlow(api: ZitadelApi, input: CreateFlowBody): Promise<CreateFlow201> {
  return api.createFlow(input, apiRequestInit);
}

// Field validation errors come back as 400 with the step echoed and
// `step.error` set. Unwrap that shape so it flows through like a 200;
// everything else bubbles.
export async function submitStep(
  api: ZitadelApi,
  id: string,
  body: SubmitFlowStepBody,
): Promise<CreateFlow201> {
  try {
    return await api.submitFlowStep(id, body, apiRequestInit);
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && isFlowResponse(error.body)) {
      return error.body;
    }
    throw error;
  }
}

function isFlowResponse(body: unknown): body is CreateFlow201 {
  return typeof body === "object" && body !== null && "step" in body;
}

export async function getCurrentStep(api: ZitadelApi, id: string): Promise<CreateFlow201> {
  return api.getFlowStep(id, apiRequestInit);
}

/**
 * Exchange a terminal-flow `handoff_token` for an authenticated session.
 * The server sets the `__nextgen_session` HttpOnly cookie on success.
 *
 * Uses the generated `exchangeHandoff` client which handles the
 * `project_id` query parameter via {@link ExchangeHandoffParams}.
 */
export async function exchangeSession(
  api: ZitadelApi,
  body: ExchangeHandoffBody,
  params: ExchangeHandoffParams,
): Promise<ExchangeHandoff200> {
  return api.exchangeHandoff(body, params, apiRequestInit);
}
