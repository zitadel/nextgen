/**
 * MSW handler factory for the mock Flow API.
 *
 * Drives an xstate `flowMachine` actor. `POST /flow` resets the actor and
 * starts a new walk; `POST /flow/{id}/submit` advances the actor and returns
 * the matching step fixture; `GET /flow/{id}` re-renders the current step.
 *
 * Branding is applied by `withBranding` (overlay set via `applyBranding`).
 * Request bodies are captured for assertions via `getCapturedRequests()`.
 */
import {
  getCreateFlowMockHandler,
  getGetFlowStepMockHandler,
  getSubmitFlowStepMockHandler,
} from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen.msw";
import type {
  CreateFlow201,
  CreateFlowBody,
  SubmitFlowStepBody,
} from "@zitadel-nextgen/api/generated/model";
import type { RequestHandler } from "msw";

import { withBranding } from "./branding.js";
import { startFlowActor, type FlowActor, type FlowStepName } from "./flow-machine.js";
import {
  doneStep,
  identifierStep,
  passwordStep,
  registerStep,
  ssoRedirectStep,
} from "./fixtures/login.js";

export type CapturedRequest =
  | { kind: "createFlow"; body: CreateFlowBody }
  | { kind: "submitFlowStep"; flowId: string; body: SubmitFlowStepBody }
  | { kind: "getFlowStep"; flowId: string };

let actor: FlowActor = startFlowActor();
let captured: CapturedRequest[] = [];

const FLOW_ID = "flow_mock";

/** Issuer URL used when signing handoff tokens; set by {@link setupMockHandlers}. */
let currentIss = "http://localhost:4000";

export function resetFlow(): void {
  actor = startFlowActor();
  captured = [];
}

export function getCapturedRequests(): readonly CapturedRequest[] {
  return captured;
}

function currentResponse(): CreateFlow201 {
  const snapshot = actor.getSnapshot();
  const input = { flowId: FLOW_ID, sessionToken: snapshot.context.sessionToken, iss: currentIss };
  const step = snapshot.value as FlowStepName | "idle";
  switch (step) {
    case "register":
      return withBranding(registerStep(input));
    case "password":
      return withBranding(passwordStep(input));
    case "sso-redirect":
      return withBranding(ssoRedirectStep(input));
    case "done":
      return withBranding(doneStep(input));
    default:
      return withBranding(identifierStep(input));
  }
}

/**
 * Build the MSW handlers. Each call to `setupMockHandlers()` resets the
 * actor so consumers get a fresh walk. The returned array is consumed by
 * `setupServer(...)` (node) or `setupWorker(...)` (browser).
 *
 * @param options.iss - Issuer URL embedded in the handoff token (default:
 *   `"http://localhost:4000"`). Pass the server's own origin so that
 *   `verifyHandoffToken` can enforce issuer consistency.
 */
export function setupMockHandlers(options: { iss?: string } = {}): RequestHandler[] {
  currentIss = options.iss ?? "http://localhost:4000";
  resetFlow();

  return [
    getCreateFlowMockHandler(async ({ request }) => {
      const body = (await request.clone().json()) as CreateFlowBody;
      captured.push({ kind: "createFlow", body });
      actor.send({ type: "RESET" });
      actor.send({ type: "START", purpose: body.purpose });
      return currentResponse();
    }),
    getSubmitFlowStepMockHandler(async ({ params, request }) => {
      const flowId = String(params.id);
      const body = (await request.clone().json()) as SubmitFlowStepBody;
      captured.push({ kind: "submitFlowStep", flowId, body });
      actor.send({
        type: "SUBMIT",
        action: body.action,
        fields: (body.fields ?? {}) as Record<string, string>,
        sso_provider_id: body.sso_provider_id ?? null,
      });
      return currentResponse();
    }),
    getGetFlowStepMockHandler(({ params }) => {
      captured.push({ kind: "getFlowStep", flowId: String(params.id) });
      return currentResponse();
    }),
  ];
}
