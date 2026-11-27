/**
 * Thin wrappers around the orval-generated `@zitadel/api` fetch
 * functions for the API operations the orchestrator drives:
 *
 * - `POST   /flows`              — `createFlow`
 * - `POST   /flows/{flow_id}/submit`  — `submitFlowStep`
 * - `GET    /flows/{flow_id}`         — `getFlowStep`
 * - `POST   /sessions/exchange` — `exchangeHandoff`
 * - `GET    /sessions/me`       — `getMySession`
 * - `GET    /sessions/me/csrf`  — `getMySessionCsrfToken`
 * - `DELETE /sessions/me`       — `revokeMySession`
 *
 * The wrappers exist for one reason: every API call must run with
 * `credentials: "include"` so the stateless `_zflow` and session
 * HttpOnly cookies round-trip. Centralising that here keeps every call site
 * honest.
 *
 * Types come straight from `@zitadel/api/generated/model`. Orval
 * emits per-operation aliases (`CreateFlow201`, `GetFlowStep200`,
 * `SubmitFlowStep200`) for what is structurally the same response; the
 * orchestrator stores them as `CreateFlow201` because that is the alias
 * orval gives the start-of-flow response.
 */
import type { ZitadelProject } from "@zitadel/api/config";
import {
  createFlow,
  exchangeHandoff,
  getFlowStep,
  getMySession,
  getMySessionCsrfToken,
  revokeMySession,
  submitFlowStep,
} from "@zitadel/api/generated/endpoints/zitadelNextGen";
import { callWith, type CallSettings } from "@zitadel/api/runtime/call";
import type {
  CreateFlow201,
  CreateFlowBody,
  ExchangeHandoff200,
  ExchangeHandoffBody,
  ExchangeHandoffParams,
  GetMySession200,
  SubmitFlowStepBody,
} from "@zitadel/api/generated/model";
import { ApiError, CSRF_HEADER, apiErrorCode } from "@zitadel/api/runtime/fetch";

const apiRequestInit: RequestInit = { credentials: "include" };

/**
 * The settings a call for the project runs with: its proxy path and key, and no
 * request policy, so nothing another client on the page set reaches the call.
 *
 * @param project - The project the call is for.
 * @returns The settings for `callWith`.
 */
function settingsOf(project: ZitadelProject): CallSettings {
  return { baseUrl: project.proxyPath, token: project.publishableKey, policy: {} };
}

/**
 * The signed-in session as the orchestrator renders it. `GET /sessions/me`
 * hydrates the user's conventional identity attributes, so the generated
 * schema carries optional `name` and `email` alongside `user_id`; both stay
 * absent for anonymous sessions and schemas without those properties.
 */
export type SessionIdentity = GetMySession200;

/**
 * Starts a flow (`POST /flows`) for the project and returns its first step.
 *
 * @param project - The project the flow belongs to.
 * @param input - The flow's purpose, project and optional starting values.
 * @returns The created flow with its first step.
 * @throws {ApiError} When the server refuses the request.
 */
export async function startFlow(
  project: ZitadelProject,
  input: CreateFlowBody,
): Promise<CreateFlow201> {
  return callWith(settingsOf(project), createFlow, input, apiRequestInit);
}

/**
 * Submits the current step of a flow (`POST /flows/{id}/submit`).
 *
 * Field validation errors come back as 400 with the step echoed and
 * `step.error` set; that shape is returned like a 200 so the step re-renders
 * with its error. Every other failure rejects.
 *
 * @param project - The project the flow belongs to.
 * @param id - The flow's id.
 * @param body - The submitted action and field values.
 * @returns The flow with its next step, or the same step with its error.
 * @throws {ApiError} When the server refuses the submit for another reason.
 */
export async function submitStep(
  project: ZitadelProject,
  id: string,
  body: SubmitFlowStepBody,
): Promise<CreateFlow201> {
  try {
    return await callWith(settingsOf(project), submitFlowStep, id, body, apiRequestInit);
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && isFlowResponse(error.body)) {
      return error.body;
    }
    throw error;
  }
}

/**
 * Whether an error body is a flow response (a step echoed with its error).
 *
 * @param body - The error's body.
 * @returns `true` when the body carries a `step`.
 */
function isFlowResponse(body: unknown): body is CreateFlow201 {
  return typeof body === "object" && body !== null && "step" in body;
}

/**
 * Reads a flow's current step (`GET /flows/{id}`), as when a page reloads
 * mid-flow.
 *
 * @param project - The project the flow belongs to.
 * @param id - The flow's id.
 * @returns The flow with its current step.
 * @throws {ApiError} When the flow is gone or the server refuses the request.
 */
export async function getCurrentStep(project: ZitadelProject, id: string): Promise<CreateFlow201> {
  return callWith(settingsOf(project), getFlowStep, id, apiRequestInit);
}

/**
 * Exchange a terminal-flow `handoff_token` for an authenticated session.
 * The server sets the HttpOnly session cookie on success.
 *
 * Uses the generated `exchangeHandoff` client which handles the
 * `project_id` query parameter via {@link ExchangeHandoffParams}.
 *
 * @param project - The project the session is for.
 * @param body - The handoff token.
 * @param params - The project id query parameter.
 * @returns The exchanged session.
 * @throws {ApiError} When the server refuses the token.
 */
export async function exchangeSession(
  project: ZitadelProject,
  body: ExchangeHandoffBody,
  params: ExchangeHandoffParams,
): Promise<ExchangeHandoff200> {
  return callWith(settingsOf(project), exchangeHandoff, body, params, apiRequestInit);
}

/**
 * Reads the current session (`GET /sessions/me`) with credentials so the
 * session cookie authenticates the request. Used by the
 * orchestrator's signed-in surfaces to render the user's identity.
 *
 * The read names the element's project. A session of another project on the
 * same server, which the server refuses (`403 sess.project_mismatch`) or a
 * server that predates the parameter answers for, resolves to `null`: it is
 * live, but not this app's. Any other failure rejects.
 *
 * @param project - The project the element is configured with.
 * @param projectId - The project id to read the session for; empty reads any.
 * @returns The session, or `null` when it belongs to another project.
 * @throws {ApiError} When the read fails for another reason.
 */
export async function getSession(
  project: ZitadelProject,
  projectId: string,
): Promise<SessionIdentity | null> {
  if (!projectId) {
    return callWith(settingsOf(project), getMySession, undefined, apiRequestInit);
  }
  try {
    const session = await callWith(
      settingsOf(project),
      getMySession,
      { project_id: projectId },
      apiRequestInit,
    );
    return session.project_id === projectId ? session : null;
  } catch (error) {
    if (apiErrorCode(error) === "sess.project_mismatch") {
      return null;
    }
    throw error;
  }
}

/**
 * Revokes the current session (`DELETE /sessions/me`) with credentials. The
 * server deletes the session and clears the cookie via `Set-Cookie: Max-Age=0`.
 * Sign-out is a write, so it carries the session's CSRF token (ADR 053 §5),
 * read first from `GET /sessions/me/csrf` and sent on this one request only:
 * the element shares the page with the host app's own API client.
 *
 * Both calls name the element's project. Two refusals leave nothing of this
 * app's to revoke, so the call resolves: a session that is already gone, signed
 * out in another tab or expired (`401 auth.unauthorized`), and a session of
 * another project on the same server (`403 sess.project_mismatch`), which stays
 * live and keeps its cookie. Any other failure rejects.
 *
 * @param project - The project the element is configured with.
 * @param projectId - The project id to revoke the session for; empty for any.
 * @returns Once the session is revoked or already not this app's.
 * @throws {ApiError} When revoking fails for another reason.
 */
export async function revokeSession(project: ZitadelProject, projectId: string): Promise<void> {
  const params = projectId ? { project_id: projectId } : undefined;
  try {
    const { csrf_token } = await callWith(
      settingsOf(project),
      getMySessionCsrfToken,
      params,
      apiRequestInit,
    );
    await callWith(settingsOf(project), revokeMySession, params, {
      ...apiRequestInit,
      headers: { [CSRF_HEADER]: csrf_token },
    });
  } catch (error) {
    const code = apiErrorCode(error);
    if (code === "auth.unauthorized" || code === "sess.project_mismatch") {
      return;
    }
    throw error;
  }
}
