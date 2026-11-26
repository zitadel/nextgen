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
import { setApiAuthToken } from "@zitadel/api/runtime/auth";
import { setProxyPath } from "@zitadel/api/runtime/base-url";
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
 * Points the generated functions at the project's proxy path and key. It runs
 * before each call, as another project on the page may have changed them.
 *
 * @param project - The project the call is for.
 */
function useProject(project: ZitadelProject): void {
  setProxyPath(project.proxyPath);
  setApiAuthToken(project.publishableKey);
}

/**
 * The signed-in session as the orchestrator renders it. `GET /sessions/me`
 * hydrates the user's conventional identity attributes, so the generated
 * schema carries optional `name` and `email` alongside `user_id`; both stay
 * absent for anonymous sessions and schemas without those properties.
 */
export type SessionIdentity = GetMySession200;

export async function startFlow(
  project: ZitadelProject,
  input: CreateFlowBody,
): Promise<CreateFlow201> {
  useProject(project);
  return createFlow(input, apiRequestInit);
}

// Field validation errors come back as 400 with the step echoed and
// `step.error` set. Unwrap that shape so it flows through like a 200;
// everything else bubbles.
export async function submitStep(
  project: ZitadelProject,
  id: string,
  body: SubmitFlowStepBody,
): Promise<CreateFlow201> {
  try {
    useProject(project);
    return await submitFlowStep(id, body, apiRequestInit);
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

export async function getCurrentStep(project: ZitadelProject, id: string): Promise<CreateFlow201> {
  useProject(project);
  return getFlowStep(id, apiRequestInit);
}

/**
 * Exchange a terminal-flow `handoff_token` for an authenticated session.
 * The server sets the HttpOnly session cookie on success.
 *
 * Uses the generated `exchangeHandoff` client which handles the
 * `project_id` query parameter via {@link ExchangeHandoffParams}.
 */
export async function exchangeSession(
  project: ZitadelProject,
  body: ExchangeHandoffBody,
  params: ExchangeHandoffParams,
): Promise<ExchangeHandoff200> {
  useProject(project);
  return exchangeHandoff(body, params, apiRequestInit);
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
 */
export async function getSession(
  project: ZitadelProject,
  projectId: string,
): Promise<SessionIdentity | null> {
  useProject(project);
  if (!projectId) {
    return getMySession(undefined, apiRequestInit);
  }
  try {
    const session = await getMySession({ project_id: projectId }, apiRequestInit);
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
 */
export async function revokeSession(project: ZitadelProject, projectId: string): Promise<void> {
  const params = projectId ? { project_id: projectId } : undefined;
  try {
    useProject(project);
    const { csrf_token } = await getMySessionCsrfToken(params, apiRequestInit);
    useProject(project);
    await revokeMySession(params, {
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
