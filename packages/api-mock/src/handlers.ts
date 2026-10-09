/**
 * MSW handler factory for the mock Flow API.
 *
 * Drives an xstate `flowMachine` actor. `POST /flow` resets the actor and
 * starts a new walk; `POST /flow/{id}/submit` advances the actor and returns
 * the matching step fixture; `GET /flow/{id}` re-renders the current step;
 * `GET /__nextgen/idp/callback` (and `/idp/callback`) is the provider's return.
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
} from "@zitadel/api/generated/endpoints/zitadelNextGen.msw";
import type {
  CreateFlow201,
  CreateFlowBody,
  CreateFlowBodyPurpose,
  ExchangeHandoffBody,
  SubmitFlowStepBody,
} from "@zitadel/api/generated/model";
import { http, HttpResponse, type RequestHandler } from "msw";

import { withBranding } from "./branding.js";
import { withSsoProviders } from "./sso-providers.js";
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
  /**
   * Put the flow where an identity provider's callback leaves it, and return
   * the handle to resume it with.
   *
   * The browser's half of the round trip cannot happen in-process: choosing a
   * provider navigates the whole page to the authorization endpoint, and it is
   * the provider's return to the callback that advances the flow. This stands
   * in for that leg: it sends the same `sso` submission the client does, then
   * drives the same transition the callback route does, so a caller that
   * cannot leave the page — a Storybook story, a component test — can still
   * reach `register-sso` and `sso-conflict`.
   *
   * Which one it lands on follows from the email, exactly as it does over the
   * wire: an address this provider has already signed up signs straight in, an
   * address that has an account here but no link is the collision, and anything
   * else is a new identity. With `error`, the provider's OAuth error code, the
   * flow goes back to the step the provider was chosen on, carrying
   * `error.sso_cancelled` for `access_denied` and `error.sso_failed` otherwise.
   */
  returnFromProvider: (input: {
    provider: string;
    email: string;
    purpose?: CreateFlowBodyPurpose;
    error?: string;
  }) => string;
};

const FLOW_ID = "flow_mock";

/**
 * The engine's one answer to a callback it cannot place (`idp_callback.go`):
 * without a pending sign-in there is no return target to send the browser to.
 */
const IDP_CALLBACK_ERROR_PAGE = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Sign-in failed</title></head>
<body><p>The sign-in could not be completed. Return to the application and try again.</p></body>
</html>
`;

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
  // Where the callback sends the browser back to, recorded by the `sso`
  // submission as the engine records it on the state row.
  let returnTarget: string | null = null;
  // A failed provider return parks its key here, and the next render of the
  // originating step shows it once, as the engine's replay guard does.
  let pendingStepError: string | null = null;

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
      return "sso_user_not_found";
    }
    if (ssoIdentities.isLinked(slug, email)) {
      return "sso_authenticated";
    }
    return authn.hasAccount(email) ? "user_already_exists" : "sso_user_not_found";
  }

  function reset(): void {
    actor = startFlowActor();
    captured = [];
    returnTarget = null;
    pendingStepError = null;
    authn.clear();
    // Links too: a caller asking for a clean mock must not inherit an email
    // that a previous test signed up through a provider, which would turn the
    // next first-time sign-in into a straight sign-in.
    ssoIdentities.clear();
  }

  function registerCredential(userHandle: string, credentialId: string): void {
    authn.register(userHandle, credentialId);
  }

  /**
   * The provider's return, as the engine's callback processes it
   * (`flow_sso_callback.go`). An OAuth error response is stored as a step
   * error, `error.sso_cancelled` for `access_denied` (the person said no) and
   * `error.sso_failed` for anything else, and the flow goes back to the step
   * the provider was chosen on. Otherwise the identity decides the branch.
   *
   * Registering through a provider is what creates the link, and the submit
   * handler records it on the `register-sso` submit rather than here, so a
   * caller returning twice with the same email gets a new identity both times,
   * which is what not having finished the registration means.
   */
  function completeProviderReturn(input: { email?: string; error?: string | null }): void {
    if (input.error) {
      pendingStepError =
        input.error === "access_denied" ? "error.sso_cancelled" : "error.sso_failed";
      actor.send({ type: "PROVIDER_RETURN", fields: {}, outcome: "error" });
      return;
    }
    const { context } = actor.getSnapshot();
    const email = input.email ?? context.capturedFields.email;
    actor.send({
      type: "PROVIDER_RETURN",
      fields: email ? { email } : {},
      outcome: resolveSsoOutcome(context.ssoProviderId, email),
    });
  }

  function returnFromProvider(input: {
    provider: string;
    email: string;
    purpose?: CreateFlowBodyPurpose;
    error?: string;
  }): string {
    actor = startFlowActor();
    pendingStepError = null;
    actor.send({ type: "START", purpose: input.purpose ?? "login" });
    actor.send({
      type: "SUBMIT",
      action: "sso",
      fields: {},
      sso_provider_id: input.provider,
    });
    completeProviderReturn({ email: input.email, error: input.error });
    return FLOW_ID;
  }

  /**
   * `GET /__nextgen/idp/callback`, the route the provider redirects to.
   *
   * The engine reads `state`, `code` and the OAuth error response from the
   * query; the mock has a single flow, so it needs no state. A mock provider
   * has no `id_token` either, so an `email` query parameter stands in for its
   * email claim, falling back to the address the flow already captured.
   * Either way the browser goes back with `303` to the `return_target` of the
   * `sso` submission, where `GET /flow/{id}` shows the result.
   */
  function idpCallback({ request }: { request: Request }): Response {
    const noStore = { "Cache-Control": "private, no-store" };
    const target = returnTarget;
    if (actor.getSnapshot().value !== "sso-redirect" || !target) {
      return new HttpResponse(IDP_CALLBACK_ERROR_PAGE, {
        status: 400,
        headers: { ...noStore, "Content-Type": "text/html; charset=utf-8" },
      });
    }
    // Single-use, like the engine's state row: a replay gets the error page.
    returnTarget = null;
    const query = new URL(request.url).searchParams;
    const error = query.get("error");
    completeProviderReturn({
      email: query.get("email") ?? undefined,
      // A return with neither a code nor an error is a failed callback in the
      // engine, not a sign-in.
      error: error ?? (query.get("code") ? null : "invalid_request"),
    });
    return new HttpResponse(null, { status: 303, headers: { ...noStore, Location: target } });
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
  /**
   * The current step as a wire response, with the module-level overlays
   * applied: branding on every response, identity providers on the steps that
   * can start a sign-in. Both are off unless a caller opted in.
   */
  async function currentResponse(): Promise<CreateFlow201> {
    const response = withSsoProviders(await renderCurrentStep());
    const error = pendingStepError;
    if (!error) {
      return response;
    }
    pendingStepError = null;
    return { ...response, step: { ...response.step, error } };
  }

  async function renderCurrentStep(): Promise<CreateFlow201> {
    const snapshot = actor.getSnapshot();
    const userHandle = snapshot.context.capturedFields.email ?? "";
    const input = {
      flowId: FLOW_ID,
      sessionToken: snapshot.context.sessionToken,
      capturedEmail: snapshot.context.capturedFields.email,
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
      returnTarget = null;
      pendingStepError = null;
      actor.send({ type: "START", purpose: body.purpose });
      return currentResponse();
    }),
    // Hand-written rather than the generated wrapper: that one answers 200
    // with whatever it is given, and the refusal below is a 400.
    http.post("*/flow/:id/submit", async ({ params, request }) => {
      const ok = (step: CreateFlow201) => HttpResponse.json(step, { status: 200 });
      const flowId = String(params.id);
      const body = (await request.clone().json()) as SubmitFlowStepBody;
      captured.push({ kind: "submitFlowStep", flowId, body });
      // The engine refuses an sso submission without `return_target`, the
      // page the callback sends the browser back to, before anything else.
      if (body.action === "sso" && !body.return_target) {
        return HttpResponse.json(
          { code: "req.invalid", message: "return_target is required for action sso" },
          { status: 400 },
        );
      }
      const before = actor.getSnapshot().value as FlowStepName | "idle";
      // Only the provider's return to the callback route leaves for the
      // provider's result; no client action stands in for it.
      if (before === "sso-redirect") {
        return HttpResponse.json(
          { code: "flow.invalid_action", message: "action is not allowed on the current step" },
          { status: 400 },
        );
      }
      if (body.action === "sso" && body.return_target) {
        returnTarget = body.return_target;
      }
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
        return ok({ ...base, step: { ...base.step, error: registrationErrorKey } });
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
        return ok({ ...base, step: { ...base.step, error: loginErrorKey } });
      }

      const passkeyUpsellInput = { ...fixtureInput, capturedEmail: contextEmail };

      const upsellErrorKey =
        before === "passkey-upsell" && body.action !== "skip" && contextEmail
          ? authn.passkeyUpsellError(contextEmail)
          : null;
      if (upsellErrorKey) {
        const base = withBranding(passkeyUpsellStep(passkeyUpsellInput));
        return ok({ ...base, step: { ...base.step, error: upsellErrorKey } });
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
        return ok({ ...base, step: { ...step, error: setupErrorKey } });
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
        return ok({ ...base, step: { ...step, error: passkeyLoginErrorKey } });
      }

      const submitted = loginCred ? { ...fields, email: loginCred.userHandle } : fields;
      const provider = snapshot.context.ssoProviderId;
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
      });
      return ok(await currentResponse());
    }),
    getGetFlowStepMockHandler(async ({ params }) => {
      captured.push({ kind: "getFlowStep", flowId: String(params.id) });
      return currentResponse();
    }),
    // Both mounts the engine serves (`internal/api/flow_sso.go`): the
    // published path, and the one an SDK proxy forwards after stripping its
    // prefix.
    http.get("*/__nextgen/idp/callback", idpCallback),
    http.get("*/idp/callback", idpCallback),
    getExchangeHandoffMockHandler(async ({ request }) => {
      const body = (await request.clone().json()) as ExchangeHandoffBody;
      const url = new URL(request.url);
      const projectId = url.searchParams.get("project_id") ?? undefined;
      captured.push({ kind: "exchangeHandoff", body, projectId });
      return getExchangeHandoffResponseMock();
    }),
    // The session endpoints `<zitadel-session>` and `<zitadel-logout>` read on
    // mount. In-process there is no session cookie to present, so both answer
    // the contract's 401 for a signed-out browser.
    http.get("*/sessions/me", () =>
      HttpResponse.json(
        { code: "auth.unauthorized", message: "no session cookie" },
        { status: 401, headers: { "Cache-Control": "private, no-store" } },
      ),
    ),
    http.delete("*/sessions/me", () =>
      HttpResponse.json(
        { code: "auth.unauthorized", message: "no session cookie" },
        { status: 401 },
      ),
    ),
  ];

  return { handlers, reset, getCaptured, registerCredential, returnFromProvider };
}
