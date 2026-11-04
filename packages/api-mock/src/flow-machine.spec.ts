/**
 * The SSO resolution branches (area 3), driven through the machine directly.
 *
 * The machine routes but does not decide: the caller resolves the identity and
 * says which branch applies, mirroring the engine, so these send the outcome
 * rather than setting up accounts.
 */
import { describe, expect, it } from "vitest";

import { PASSWORD_FIELD } from "./fixtures/login.js";
import { startFlowActor, type FlowStepName, type SsoOutcome } from "./flow-machine.js";

function atProvider(): ReturnType<typeof startFlowActor> {
  const actor = startFlowActor();
  actor.send({ type: "START", purpose: "login" });
  actor.send({ type: "SUBMIT", action: "sso", fields: {}, sso_provider_id: "google" });
  return actor;
}

function stepAfterReturn(outcome: SsoOutcome): FlowStepName {
  const actor = atProvider();
  actor.send({
    type: "PROVIDER_RETURN",
    fields: { email: "ada@example.test" },
    outcome: outcome,
  });
  return actor.getSnapshot().value as FlowStepName;
}

describe("the provider round trip", () => {
  it("sends the button to the provider, carrying which one was pressed", () => {
    const actor = atProvider();

    expect(actor.getSnapshot().value).toBe("sso-redirect");
    expect(actor.getSnapshot().context.ssoProviderId).toBe("google");
  });

  it("signs a linked identity straight in", () => {
    expect(stepAfterReturn("sso_authenticated")).toBe("done");
  });

  it("collects what the provider did not supply for a new identity", () => {
    expect(stepAfterReturn("sso_user_not_found")).toBe("register-sso");
  });

  it("stops at the conflict step when the email already has an account", () => {
    // Minting a second account for an email that already has one is the
    // outcome this branch exists to prevent.
    expect(stepAfterReturn("user_already_exists")).toBe("sso-conflict");
  });

  it("treats an unresolved return as a new identity rather than a sign-in", () => {
    // Failing closed: the worst reading of "we could not tell" is to sign
    // someone in, so an absent outcome must not reach `done`. The outcome is
    // omitted here on purpose -- supplying one would test the wrong thing.
    const actor = atProvider();
    actor.send({ type: "PROVIDER_RETURN", fields: {} });

    expect(actor.getSnapshot().value).toBe("register-sso");
  });

  it("treats an explicitly null outcome the same way", () => {
    const actor = atProvider();
    actor.send({ type: "PROVIDER_RETURN", fields: {}, outcome: null });

    expect(actor.getSnapshot().value).toBe("register-sso");
  });

  it("takes no client submit while the provider has the browser", () => {
    // The engine's callback is a GET the provider redirects to; there is no
    // client action that stands in for it.
    const actor = atProvider();
    actor.send({ type: "SUBMIT", action: "callback", fields: { email: "ada@example.test" } });

    expect(actor.getSnapshot().value).toBe("sso-redirect");
  });
});

describe("a failed provider return", () => {
  it("goes back to the step the provider was chosen on", () => {
    const actor = atProvider();
    actor.send({ type: "PROVIDER_RETURN", fields: {}, outcome: "error" });

    expect(actor.getSnapshot().value).toBe("identifier");
  });

  it("goes back to sign-up when that is where the button was", () => {
    const actor = startFlowActor();
    actor.send({ type: "START", purpose: "register" });
    actor.send({ type: "SUBMIT", action: "sso", fields: {}, sso_provider_id: "google" });
    actor.send({ type: "PROVIDER_RETURN", fields: {}, outcome: "error" });

    expect(actor.getSnapshot().value).toBe("register");
  });

  it("goes back to the conflict step when the second provider fails", () => {
    const actor = atProvider();
    actor.send({ type: "PROVIDER_RETURN", fields: {}, outcome: "user_already_exists" });
    actor.send({ type: "SUBMIT", action: "sso", fields: {}, sso_provider_id: "acme" });
    actor.send({ type: "PROVIDER_RETURN", fields: {}, outcome: "error" });

    expect(actor.getSnapshot().value).toBe("sso-conflict");
  });
});

describe("register-sso", () => {
  it("creates the account on submit", () => {
    const actor = atProvider();
    actor.send({
      type: "PROVIDER_RETURN",
      fields: {},
      outcome: "sso_user_not_found",
    });

    actor.send({ type: "SUBMIT", action: "submit", fields: { givenName: "Ada" } });

    expect(actor.getSnapshot().value).toBe("done");
    expect(actor.getSnapshot().context.capturedFields.givenName).toBe("Ada");
  });

  it("goes back to sign-in rather than registering when asked", () => {
    const actor = atProvider();
    actor.send({
      type: "PROVIDER_RETURN",
      fields: {},
      outcome: "sso_user_not_found",
    });

    actor.send({ type: "SUBMIT", action: "sign_in", fields: {} });

    expect(actor.getSnapshot().value).toBe("identifier");
  });
});

describe("sso-conflict", () => {
  const conflicted = () => {
    const actor = atProvider();
    actor.send({
      type: "PROVIDER_RETURN",
      fields: { email: "ada@example.test" },
      outcome: "user_already_exists",
    });
    return actor;
  };

  it("accepts a password and signs in", () => {
    const actor = conflicted();

    actor.send({
      type: "SUBMIT",
      action: "submit",
      fields: { [PASSWORD_FIELD]: "correct-horse-battery-staple" },
    });

    expect(actor.getSnapshot().value).toBe("done");
  });

  it("hands a passkey to the passkey step rather than completing on its own", () => {
    const actor = conflicted();

    actor.send({ type: "SUBMIT", action: "passkey", fields: {} });

    expect(actor.getSnapshot().value).toBe("passkey-login");
  });

  it("offers a way back to sign-in", () => {
    const actor = conflicted();

    actor.send({ type: "SUBMIT", action: "sign_in", fields: {} });

    expect(actor.getSnapshot().value).toBe("identifier");
  });

  it("rotates the session token on every hop, as the engine does", () => {
    const actor = atProvider();
    const atRedirect = actor.getSnapshot().context.sessionToken;
    actor.send({
      type: "PROVIDER_RETURN",
      fields: {},
      outcome: "user_already_exists",
    });

    expect(actor.getSnapshot().context.sessionToken).not.toBe(atRedirect);
  });
});

/** A user who typed their email and pressed a provider button on the password step. */
function returnFromPassword(outcome: SsoOutcome | "error"): FlowStepName {
  const actor = startFlowActor();
  actor.send({ type: "START", purpose: "login" });
  actor.send({ type: "SUBMIT", action: "submit", fields: { email: "ada@example.test" } });
  actor.send({ type: "SUBMIT", action: "sso", fields: {}, sso_provider_id: "google" });
  actor.send({ type: "PROVIDER_RETURN", fields: { email: "ada@example.test" }, outcome });
  return actor.getSnapshot().value as FlowStepName;
}

describe("a return from the provider pressed on the password step", () => {
  it("signs a linked identity in", () => {
    expect(returnFromPassword("sso_authenticated")).toBe("done");
  });

  it("explains a collision on the conflict step, as the engine's written route does", () => {
    expect(returnFromPassword("user_already_exists")).toBe("sso-conflict");
  });

  it("restarts the flow for an unknown provider account, because the attempt is bound to a user", () => {
    expect(returnFromPassword("sso_user_not_found")).toBe("identifier");
  });

  it("goes back to the password step when the provider fails", () => {
    expect(returnFromPassword("error")).toBe("password");
  });

  it("still collects an unknown provider account on the entry step", () => {
    expect(stepAfterReturn("sso_user_not_found")).toBe("register-sso");
  });
});

/**
 * The mock offers provider buttons on every step in `PROVIDER_STEPS`
 * (`sso-providers.ts`), so every one of those steps has to act on the press.
 * A step that advertises a button and then falls through to its own default
 * reports a journey the engine would never produce.
 */
describe("every step that offers providers acts on the press", () => {
  it("leaves for the provider from sign-up, not the password step", () => {
    const actor = startFlowActor();
    actor.send({ type: "START", purpose: "register" });
    actor.send({ type: "SUBMIT", action: "sso", fields: {}, sso_provider_id: "google" });

    expect(actor.getSnapshot().value).toBe("sso-redirect");
    expect(actor.getSnapshot().context.ssoProviderId).toBe("google");
  });

  it("leaves for the provider from the password step, rather than signing in", () => {
    const actor = startFlowActor();
    actor.send({ type: "START", purpose: "login" });
    actor.send({ type: "SUBMIT", action: "submit", fields: { email: "ada@example.test" } });
    expect(actor.getSnapshot().value).toBe("password");

    actor.send({ type: "SUBMIT", action: "sso", fields: {}, sso_provider_id: "google" });

    expect(actor.getSnapshot().value).toBe("sso-redirect");
  });

  it("leaves for the provider from the conflict step, rather than signing in", () => {
    const actor = atProvider();
    actor.send({
      type: "PROVIDER_RETURN",
      fields: { email: "ada@example.test" },
      outcome: "user_already_exists",
    });
    actor.send({ type: "SUBMIT", action: "sso", fields: {}, sso_provider_id: "acme" });

    expect(actor.getSnapshot().value).toBe("sso-redirect");
    expect(actor.getSnapshot().context.ssoProviderId).toBe("acme");
  });
});

describe("a flow that answers an authorization request", () => {
  function bound(purpose: "login" | "register" = "login"): ReturnType<typeof startFlowActor> {
    const actor = startFlowActor();
    actor.send({ type: "START", purpose, authRequest: "req_mock" });
    return actor;
  }

  function submit(actor: ReturnType<typeof startFlowActor>, action: string): void {
    actor.send({ type: "SUBMIT", action, fields: {} });
  }

  // The engine inserts consent after whatever signed the user in (ADR 081
  // §11), so every route to `done` has to meet it.
  it.each<[string, (actor: ReturnType<typeof startFlowActor>) => void]>([
    [
      "a password",
      (actor) => {
        actor.send({ type: "SUBMIT", action: "submit", fields: { email: "ada@example.test" } });
        actor.send({ type: "SUBMIT", action: "submit", fields: { [PASSWORD_FIELD]: "hunter2" } });
      },
    ],
    [
      "a passkey",
      (actor) => {
        submit(actor, "passkey");
        submit(actor, "submit");
      },
    ],
    [
      "a linked provider identity",
      (actor) => {
        actor.send({ type: "SUBMIT", action: "sso", fields: {}, sso_provider_id: "google" });
        actor.send({ type: "PROVIDER_RETURN", fields: {}, outcome: "sso_authenticated" });
      },
    ],
    [
      "a sign-up through a provider",
      (actor) => {
        actor.send({ type: "SUBMIT", action: "sso", fields: {}, sso_provider_id: "google" });
        actor.send({ type: "PROVIDER_RETURN", fields: {}, outcome: "sso_user_not_found" });
        submit(actor, "submit");
      },
    ],
    [
      "the conflict step",
      (actor) => {
        actor.send({ type: "SUBMIT", action: "sso", fields: {}, sso_provider_id: "google" });
        actor.send({ type: "PROVIDER_RETURN", fields: {}, outcome: "user_already_exists" });
        submit(actor, "submit");
      },
    ],
  ])("asks for consent after signing in with %s", (_, signIn) => {
    const actor = bound();
    signIn(actor);

    expect(actor.getSnapshot().value).toBe("consent");
  });

  it("asks for consent after a sign-up", () => {
    const actor = bound("register");
    submit(actor, "submit");
    submit(actor, "submit");

    expect(actor.getSnapshot().value).toBe("consent");
  });

  it.each(["accept", "deny"] as const)("ends on %s with that answer", (answer) => {
    const actor = bound();
    actor.send({ type: "SUBMIT", action: "submit", fields: { email: "ada@example.test" } });
    actor.send({ type: "SUBMIT", action: "submit", fields: { [PASSWORD_FIELD]: "hunter2" } });
    submit(actor, answer);

    expect(actor.getSnapshot().value).toBe("done");
    expect(actor.getSnapshot().context).toMatchObject({
      authRequest: "req_mock",
      consentAnswer: answer,
      sessionUser: false,
    });
  });

  it("stays on the consent step for any other action", () => {
    const actor = bound();
    actor.send({ type: "SUBMIT", action: "submit", fields: { email: "ada@example.test" } });
    actor.send({ type: "SUBMIT", action: "submit", fields: { [PASSWORD_FIELD]: "hunter2" } });
    submit(actor, "back");

    expect(actor.getSnapshot().value).toBe("consent");
  });

  it("answers for a live session without a sign-in, asking for consent", () => {
    const actor = startFlowActor();
    actor.send({
      type: "START",
      purpose: "login",
      authRequest: "req_mock",
      liveSession: { email: "ada@example.test", consented: false },
    });

    expect(actor.getSnapshot().value).toBe("consent");
    expect(actor.getSnapshot().context).toMatchObject({
      sessionUser: true,
      capturedFields: { email: "ada@example.test" },
    });
  });

  it("answers at once for a live session that already consented", () => {
    const actor = startFlowActor();
    actor.send({
      type: "START",
      purpose: "login",
      authRequest: "req_mock",
      liveSession: { email: "ada@example.test", consented: true },
    });

    expect(actor.getSnapshot().value).toBe("done");
    expect(actor.getSnapshot().context).toMatchObject({
      sessionUser: true,
      consentAnswer: "accept",
    });
  });

  it("leaves a flow without a request alone, live session or not", () => {
    const actor = startFlowActor();
    actor.send({
      type: "START",
      purpose: "login",
      liveSession: { email: "ada@example.test", consented: true },
    });
    expect(actor.getSnapshot().value).toBe("identifier");

    actor.send({ type: "SUBMIT", action: "submit", fields: { email: "ada@example.test" } });
    actor.send({ type: "SUBMIT", action: "submit", fields: { [PASSWORD_FIELD]: "hunter2" } });

    expect(actor.getSnapshot().value).toBe("done");
    expect(actor.getSnapshot().context).toMatchObject({ authRequest: null, sessionUser: false });
  });
});
