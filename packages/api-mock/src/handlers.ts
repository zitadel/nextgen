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
  getExchangeHandoffMockHandler,
  getExchangeHandoffResponseMock,
  getGetFlowStepMockHandler,
  getSubmitFlowStepMockHandler,
} from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen.msw";
import type {
  CreateFlow201,
  CreateFlowBody,
  ExchangeHandoffBody,
  SubmitFlowStepBody,
} from "@zitadel-nextgen/api/generated/model";
import type { RequestHandler } from "msw";

import { withBranding } from "./branding.js";
import { startFlowActor, type FlowActor, type FlowStepName } from "./flow-machine.js";
import {
  doneStep,
  identifierStep,
  passkeySetupStep,
  passkeyUpsellStep,
  passwordStep,
  registerStep,
  ssoRedirectStep,
} from "./fixtures/login.js";

export type CapturedRequest =
  | { kind: "createFlow"; body: CreateFlowBody }
  | { kind: "submitFlowStep"; flowId: string; body: SubmitFlowStepBody }
  | { kind: "getFlowStep"; flowId: string }
  | { kind: "exchangeHandoff"; body: ExchangeHandoffBody };

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
      case "passkey-upsell":
        return withBranding(passkeyUpsellStep(input));
      case "passkey-setup":
        return withBranding(passkeySetupStep(input));
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
      const before = actor.getSnapshot().value as FlowStepName | "idle";
      const fields = (body.fields ?? {}) as Record<string, string>;
      const email = fields.email;
      const snapshot = actor.getSnapshot();
      const fixtureInput = {
        flowId: FLOW_ID,
        sessionToken: snapshot.context.sessionToken,
        capturedEmail: email,
        iss,
      };

      // Figma sign-up `6593:141741`: duplicate email → inline error on email field.
      if (before === "register" && body.action === "submit" && email === "exists@example.com") {
        const response = withBranding(registerStep(fixtureInput));
        return {
          ...response,
          step: { ...response.step, error: "error.email_exists" },
        };
      }

      // Figma sign-in `6602:180268`: failed auth → inline error on password field.
      if (
        before === "identifier" &&
        body.action === "submit" &&
        email?.toLowerCase() === "wrong@example.com"
      ) {
        const response = withBranding(identifierStep(fixtureInput));
        return {
          ...response,
          step: { ...response.step, error: "error.invalid_credentials" },
        };
      }

      // Figma sign-in `6594:125237`: server-side failure → form-level alert.
      if (
        before === "identifier" &&
        body.action === "submit" &&
        email?.toLowerCase() === "server@example.com"
      ) {
        const response = withBranding(identifierStep(fixtureInput));
        return {
          ...response,
          step: { ...response.step, error: "error.sign_in_server" },
        };
      }

      const capturedEmail = snapshot.context.capturedFields.email?.toLowerCase();
      const passkeyUpsellInput = {
        ...fixtureInput,
        capturedEmail: snapshot.context.capturedFields.email,
      };

      // Figma passkey upsell `6594:630` — setup failures stay on step with alert.
      if (before === "passkey-upsell" && body.action !== "skip") {
        const passkeyErrorByEmail: Record<string, string> = {
          "passkey-cancel@example.com": "error.passkey_cancelled",
          "passkey-unsupported@example.com": "error.passkey_unsupported",
          "passkey-fail@example.com": "error.passkey_failed",
        };
        const errorKey = capturedEmail ? passkeyErrorByEmail[capturedEmail] : undefined;
        if (errorKey) {
          const response = withBranding(passkeyUpsellStep(passkeyUpsellInput));
          return {
            ...response,
            step: { ...response.step, error: errorKey },
          };
        }
      }

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
    getExchangeHandoffMockHandler(async ({ request }) => {
      const body = (await request.clone().json()) as ExchangeHandoffBody;
      captured.push({ kind: "exchangeHandoff", body });
      return getExchangeHandoffResponseMock();
    }),
  ];

  return { handlers, reset, getCaptured };
}
