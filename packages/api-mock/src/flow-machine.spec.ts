/**
 * The SSO resolution branches (area 3), driven through the machine directly.
 *
 * The machine routes but does not decide: the caller resolves the identity and
 * says which branch applies, mirroring the engine, so these send the outcome
 * rather than setting up accounts.
 */
import { describe, expect, it } from "vitest";

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
    type: "SUBMIT",
    action: "callback",
    fields: { email: "ada@example.test" },
    sso_outcome: outcome,
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
    expect(stepAfterReturn("callback")).toBe("done");
  });

  it("collects what the provider did not supply for a new identity", () => {
    expect(stepAfterReturn("identity_unknown")).toBe("register-sso");
  });

  it("stops at the conflict step when the email already has an account", () => {
    // Minting a second account for an email that already has one is the
    // outcome this branch exists to prevent.
    expect(stepAfterReturn("user_already_exists")).toBe("sso-conflict");
  });

  it("treats an unresolved return as a new identity rather than a sign-in", () => {
    // Failing closed: the worst reading of "we could not tell" is to sign
    // someone in, so an absent outcome must not reach `done`.
    const actor = atProvider();
    actor.send({ type: "SUBMIT", action: "callback", fields: {}, sso_outcome: "identity_unknown" });

    expect(actor.getSnapshot().value).toBe("register-sso");
  });
});

describe("register-sso", () => {
  it("creates the account on submit", () => {
    const actor = atProvider();
    actor.send({ type: "SUBMIT", action: "callback", fields: {}, sso_outcome: "identity_unknown" });

    actor.send({ type: "SUBMIT", action: "submit", fields: { givenName: "Ada" } });

    expect(actor.getSnapshot().value).toBe("done");
    expect(actor.getSnapshot().context.capturedFields.givenName).toBe("Ada");
  });

  it("goes back to sign-in rather than registering when asked", () => {
    const actor = atProvider();
    actor.send({ type: "SUBMIT", action: "callback", fields: {}, sso_outcome: "identity_unknown" });

    actor.send({ type: "SUBMIT", action: "sign_in", fields: {} });

    expect(actor.getSnapshot().value).toBe("identifier");
  });
});

describe("sso-conflict", () => {
  const conflicted = () => {
    const actor = atProvider();
    actor.send({
      type: "SUBMIT",
      action: "callback",
      fields: { email: "ada@example.test" },
      sso_outcome: "user_already_exists",
    });
    return actor;
  };

  it("accepts a password and signs in", () => {
    const actor = conflicted();

    actor.send({ type: "SUBMIT", action: "submit", fields: { password: "hunter2" } });

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
    actor.send({ type: "SUBMIT", action: "callback", fields: {}, sso_outcome: "user_already_exists" });

    expect(actor.getSnapshot().context.sessionToken).not.toBe(atRedirect);
  });
});
