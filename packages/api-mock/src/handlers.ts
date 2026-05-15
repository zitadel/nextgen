/**
 * MSW handler factory for the mock Flow API.
 *
 * Drives an xstate `flowMachine` actor. `POST /flow` resets the actor and
 * starts a new walk; `POST /flow/{id}/submit` advances the actor and returns
 * the matching step fixture; `GET /flow/{id}` re-renders the current step.
 *
 * Branding is applied by `withBranding` (overlay set via `applyBranding`).
 * Request bodies are captured for assertions via `getCapturedRequests()`.
 *
 * Each call to `setupMockHandlers()` creates an isolated closure — `actor`,
 * `captured`, and `iss` are local to that invocation. `resetFlow()` and
 * `getCapturedRequests()` delegate to the most recently created handle so
 * existing test call-sites work without modification.
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

const FLOW_ID = "flow_mock";

/** Points to the most recently created mock handle for delegation. */
let _current: { reset: () => void; getCaptured: () => readonly CapturedRequest[] } | null = null;

/** Reset the active mock's actor to the idle state and clear captured requests. */
export function resetFlow(): void {
  _current?.reset();
}

/** Return captured request bodies from the active mock for test assertions. */
export function getCapturedRequests(): readonly CapturedRequest[] {
  return _current?.getCaptured() ?? [];
}

/**
 * Build the MSW handlers. Each call creates an independent closure (actor,
 * captured log, iss) so parallel test suites never share state. The returned
 * array is consumed by `setupServer(...)` (node) or passed to a worker
 * (browser). `resetFlow()` and `getCapturedRequests()` automatically delegate
 * to the most recently returned set of handlers.
 *
 * @param options.iss - Issuer URL embedded in the handoff token (default:
 *   `"http://localhost:4000"`). Pass the server's own origin so that
 *   `verifyHandoffToken` can enforce issuer consistency.
 */
export function setupMockHandlers(options: { iss?: string } = {}): RequestHandler[] {
  const iss = options.iss ?? "http://localhost:4000";
  let actor: FlowActor = startFlowActor();
  let captured: CapturedRequest[] = [];

  function reset(): void {
    actor = startFlowActor();
    captured = [];
  }

  function getCaptured(): readonly CapturedRequest[] {
    return captured;
  }

  function currentResponse(): CreateFlow201 {
    const snapshot = actor.getSnapshot();
    const input = {
      flowId: FLOW_ID,
      sessionToken: snapshot.context.sessionToken,
      capturedEmail: snapshot.context.capturedFields["email"],
      iss,
    };
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

  // Register as the active handle so resetFlow() / getCapturedRequests() work.
  _current = { reset, getCaptured };

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
