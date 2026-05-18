/**
 * MSW handler factory for the mock Flow API.
 *
 * Drives an xstate `flowMachine` actor. `POST /flow` resets the actor and
 * starts a new walk; `POST /flow/{id}/submit` advances the actor and returns
 * the matching step fixture; `GET /flow/{id}` re-renders the current step.
 *
 * Branding is applied by `withBranding` (overlay set via `applyBranding`).
 * Request bodies are captured for assertions via the `getCaptured` method
 * returned by `setupMockHandlers()`.
 *
 * Each call to `setupMockHandlers()` creates an isolated closure — `actor`,
 * `captured`, and `iss` are local to that invocation. Callers own their own
 * `reset` and `getCaptured` references, so parallel test suites never share
 * state even when running in the same worker.
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
  passkeyChallenge,
  passkeyEnroll,
  passwordStep,
  registerStep,
  ssoRedirectStep,
} from "./fixtures/login.js";

export type CapturedRequest =
  | { kind: "createFlow"; body: CreateFlowBody }
  | { kind: "submitFlowStep"; flowId: string; body: SubmitFlowStepBody }
  | { kind: "getFlowStep"; flowId: string };

export type MockHandle = {
  handlers: RequestHandler[];
  /** Reset the actor to idle and clear captured requests. */
  reset: () => void;
  /** Return captured request bodies for test assertions. */
  getCaptured: () => readonly CapturedRequest[];
};

const FLOW_ID = "flow_mock";

/**
 * Build the MSW handlers. Each call creates an independent closure (actor,
 * captured log, iss) so parallel test suites never share state. Callers
 * should hold onto the returned `reset` and `getCaptured` references instead
 * of going through a shared module-level pointer.
 *
 * @param options.iss - Issuer URL embedded in the handoff token (default:
 *   `"http://localhost:4000"`). Pass the server's own origin so that
 *   `verifyHandoffToken` can enforce issuer consistency.
 */
export function setupMockHandlers(options: { iss?: string } = {}): MockHandle {
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

  async function currentResponse(): Promise<CreateFlow201> {
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
      case "passkey-challenge":
        return withBranding(passkeyChallenge(input));
      case "passkey-enroll":
        return withBranding(passkeyEnroll(input));
      case "sso-redirect":
        return withBranding(ssoRedirectStep(input));
      case "done":
        return withBranding(await doneStep(input));
      default:
        return withBranding(identifierStep(input));
    }
  }

  const handlers: RequestHandler[] = [
    getCreateFlowMockHandler(async ({ request }) => {
      const body = (await request.clone().json()) as CreateFlowBody;
      captured.push({ kind: "createFlow", body });
      // Replace the actor outright. The flow machine's `done` state is a
      // final (absorbing) state, so sending RESET to an actor that has
      // already reached `done` is a no-op — reusing it would replay the
      // previous session's captured email on the next createFlow call,
      // which made logout+login appear to re-authenticate as the prior
      // user without any user input.
      actor = startFlowActor();
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

  return { handlers, reset, getCaptured };
}
