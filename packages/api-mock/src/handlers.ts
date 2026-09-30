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
} from "@zitadel/api/generated/endpoints/zitadelNextGen.msw";
import type {
  CreateFlow201,
  CreateFlowBody,
  ExchangeHandoffBody,
  SubmitFlowStepBody,
} from "@zitadel/api/generated/model";
import type { RequestHandler } from "msw";

import { withBranding } from "./branding.js";
import {
  doneStep,
  identifierStep,
  passkeyLoginStep,
  passkeySetupStep,
  passkeyUpsellStep,
  passwordStep,
  recoverStep,
  registerPasswordStep,
  registerStep,
  registerSsoStep,
  ssoConflictStep,
  ssoRedirectStep,
} from "./fixtures/login.js";
import {
  startFlowActor,
  type FlowActor,
  type FlowStepName,
  type SsoOutcome,
} from "./flow-machine.js";
import { SsoIdentityStore } from "./lib/sso-identities.js";
import { AuthnStore, type PasskeyProof } from "./lib/authn/index.js";

export type CapturedRequest =
  | { kind: "createFlow"; body: CreateFlowBody }
  | { kind: "submitFlowStep"; flowId: string; body: SubmitFlowStepBody }
  | { kind: "getFlowStep"; flowId: string }
  | { kind: "exchangeHandoff"; body: ExchangeHandoffBody; projectId?: string };

export type MockHandle = {
  handlers: RequestHandler[];
  /** Reset the actor to idle and clear captured requests. */
  reset: () => void;
  /** Return captured request bodies for test assertions. */
  getCaptured: () => readonly CapturedRequest[];
  /**
   * Pre-register a WebAuthn credential so that a subsequent passkey-login
   * submission succeeds without going through the full register flow.
   * Useful in component tests that exercise the orchestrator's auto-submit
   * behaviour without needing a full registration ceremony first.
   */
  registerCredential: (userHandle: string, credentialId: string) => void;
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
  const iss = options.iss ?? "http://localhost:8080";
  let actor: FlowActor = startFlowActor();
  let captured: CapturedRequest[] = [];
  const authn = new AuthnStore();
  // Which emails this mock has already seen arrive through a provider. The
  // engine keys links on the provider's subject; see SsoIdentityStore for why
  // the mock keys on email.
  const ssoIdentities = new SsoIdentityStore();

  /**
   * Which branch the provider's return takes.
   *
   * A link this provider has seen signs the user straight in. An email that
   * already has an account here, but no link, is the collision: the account
   * exists and the provider must not silently mint a second one. Anything else
   * is a new external identity.
   */
  function resolveSsoOutcome(slug: string | null, email: string | undefined): SsoOutcome {
    if (!slug || !email) {
      return "identity_unknown";
    }
    if (ssoIdentities.isLinked(slug, email)) {
      return "callback";
    }
    return authn.getByUser(email).length > 0 ? "user_already_exists" : "identity_unknown";
  }

  function reset(): void {
    actor = startFlowActor();
    captured = [];
    authn.clear();
    // Links too: a caller asking for a clean mock must not inherit an email
    // that a previous test signed up through a provider, which would turn the
    // next first-time sign-in into a straight sign-in.
    ssoIdentities.clear();
  }

  function registerCredential(userHandle: string, credentialId: string): void {
    authn.register(userHandle, credentialId);
  }

  function getCaptured(): readonly CapturedRequest[] {
    return captured;
  }

  /**
   * Build the response shape for the current machine state.
   *
   * Reads `capturedFields.email` from the actor snapshot to look up the user's
   * registered credentials in `authn`, then selects and renders the matching
   * step fixture. Called after every state transition and on `GET /flow/{id}`.
   */
  async function currentResponse(): Promise<CreateFlow201> {
    const snapshot = actor.getSnapshot();
    const userHandle = snapshot.context.capturedFields["email"] ?? "";
    const input = {
      flowId: FLOW_ID,
      sessionToken: snapshot.context.sessionToken,
      capturedEmail: snapshot.context.capturedFields["email"],
      registeredCredentials: authn.getByUser(userHandle),
      iss,
    };
    const step = snapshot.value as FlowStepName | "idle";
    switch (step) {
      case "register":
        return withBranding(registerStep(input));
      case "register-password":
        return withBranding(registerPasswordStep(input));
      case "recover":
        return withBranding(recoverStep(input));
      case "password":
        return withBranding(passwordStep(input));
      case "passkey-upsell":
        return withBranding(passkeyUpsellStep(input));
      case "passkey-setup":
        return withBranding(passkeySetupStep(input));
      case "passkey-login":
        return withBranding(passkeyLoginStep(input));
      case "sso-redirect":
        return withBranding(ssoRedirectStep(input));
      case "register-sso":
        return withBranding(registerSsoStep(input));
      case "sso-conflict":
        return withBranding(ssoConflictStep(input));
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

      const registrationErrorKey =
        before === "register" && body.action === "submit" && email
          ? authn.registrationError(email)
          : null;
      if (registrationErrorKey) {
        const base = withBranding(registerStep(fixtureInput));
        return { ...base, step: { ...base.step, error: registrationErrorKey } };
      }

      const contextEmail = snapshot.context.capturedFields.email;

      // Invalid credentials surface on the **password** step, not the
      // identifier: in the split flow the identifier submit only resolves the
      // user, and the password submit is the first request that can fail
      // authentication. The address therefore comes from the flow context (the
      // password submit body carries no email).
      const loginErrorKey =
        before === "password" && body.action === "submit" && contextEmail
          ? authn.loginError(contextEmail)
          : null;
      if (loginErrorKey) {
        const base = withBranding(passwordStep({ ...fixtureInput, capturedEmail: contextEmail }));
        return { ...base, step: { ...base.step, error: loginErrorKey } };
      }

      const passkeyUpsellInput = { ...fixtureInput, capturedEmail: contextEmail };

      const upsellErrorKey =
        before === "passkey-upsell" && body.action !== "skip" && contextEmail
          ? authn.passkeyUpsellError(contextEmail)
          : null;
      if (upsellErrorKey) {
        const base = withBranding(passkeyUpsellStep(passkeyUpsellInput));
        return { ...base, step: { ...base.step, error: upsellErrorKey } };
      }

      const proof = body.challenge_response?.proof as PasskeyProof | undefined;

      const setupCred =
        before === "passkey-setup" && proof
          ? authn.registerFromProof(contextEmail ?? "mock-user@example.com", proof)
          : null;
      const setupErrorKey =
        before === "passkey-setup" && !setupCred ? "error.passkey_setup_failed" : null;
      if (setupErrorKey) {
        const base = withBranding(passkeySetupStep(passkeyUpsellInput));
        const { challenge: _c, ...step } = base.step;
        return { ...base, step: { ...step, error: setupErrorKey } };
      }

      const loginCred =
        before === "passkey-login" && body.action !== "cancel" && proof
          ? authn.authenticateFromProof(proof)
          : null;
      const passkeyLoginErrorKey =
        before === "passkey-login" && body.action !== "cancel" && !loginCred
          ? "error.passkey_not_registered"
          : null;
      if (passkeyLoginErrorKey) {
        const registeredCredentials = authn.getByUser(contextEmail ?? "");
        const loginInput = {
          flowId: FLOW_ID,
          sessionToken: snapshot.context.sessionToken,
          capturedEmail: contextEmail,
          registeredCredentials,
          iss,
        };
        const base = withBranding(passkeyLoginStep(loginInput));
        const { challenge: _c, ...step } = base.step;
        return { ...base, step: { ...step, error: passkeyLoginErrorKey } };
      }

      const submitted = loginCred ? { ...fields, email: loginCred.userHandle } : fields;
      const provider = snapshot.context.ssoProviderId;
      // Leaving the provider, nothing has resolved yet. Coming back from it,
      // the identity decides where the flow goes — the lookup the engine does
      // before it picks a branch.
      const ssoOutcome =
        before === "sso-redirect"
          ? resolveSsoOutcome(provider, submitted.email ?? snapshot.context.capturedFields.email)
          : null;
      // Registering through a provider is what creates the link, so it is
      // recorded when the step that mints the account submits.
      if (before === "register-sso" && body.action !== "sign_in") {
        const linkEmail = submitted.email ?? snapshot.context.capturedFields.email;
        if (provider && linkEmail) {
          ssoIdentities.link(provider, linkEmail);
        }
      }
      actor.send({
        type: "SUBMIT",
        action: body.action,
        fields: submitted,
        sso_provider_id: body.sso_provider_id ?? null,
        sso_outcome: ssoOutcome,
      });
      return currentResponse();
    }),
    getGetFlowStepMockHandler(async ({ params }) => {
      captured.push({ kind: "getFlowStep", flowId: String(params.id) });
      return currentResponse();
    }),
    getExchangeHandoffMockHandler(async ({ request }) => {
      const body = (await request.clone().json()) as ExchangeHandoffBody;
      const url = new URL(request.url);
      const projectId = url.searchParams.get("project_id") ?? undefined;
      captured.push({ kind: "exchangeHandoff", body, projectId });
      return getExchangeHandoffResponseMock();
    }),
  ];

  return { handlers, reset, getCaptured, registerCredential };
}
