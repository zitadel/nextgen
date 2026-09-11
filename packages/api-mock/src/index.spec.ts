import { configureZitadel } from "@zitadel/api/config";
import {
  createFlow,
  getFlowStep,
  submitFlowStep,
} from "@zitadel/api/generated/endpoints/zitadelNextGen";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import type { MockHandle } from "./handlers.js";
import { applyBranding, clearBranding, PASSWORD_FIELD, setupMockHandlers } from "./index.js";

const PROJECT_ID = "proj_demo";

/**
 * Decode the payload of a JWT without verifying its signature. Used by the
 * handoff-token assertions below to inspect the `sub` claim — the standalone
 * `/sessions/exchange` endpoint already verifies the signature elsewhere.
 */
function decodeJwtPayload(token: string): { sub: string } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error(`expected three JWT parts, got ${parts.length}`);
  }
  const [, payload] = parts as [string, string, string];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    sub: string;
  };
}

const server = setupServer();
let mock: MockHandle = setupMockHandlers();

beforeAll(() => {
  // Any absolute URL works — the orval-generated handlers match `*/flow*`
  // with a wildcard prefix.
  configureZitadel({ proxyPath: "http://localhost", projectId: PROJECT_ID });
  server.listen({ onUnhandledRequest: "error" });
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  mock = setupMockHandlers();
  server.use(...mock.handlers);
  mock.reset();
  clearBranding();
});

afterEach(() => {
  server.resetHandlers();
});

describe("setupMockHandlers", () => {
  test("walks the split sign-in: identifier -> password -> done", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    expect(start.step.name).toBe("identifier");
    expect(start.step.fields?.map((f) => f.name)).toEqual(["email"]);
    expect(start.id).toBeTruthy();

    const password = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com" },
    });
    // The real default flow collects the credential on its own step, keyed by
    // the schema pointer — not plain `password` (the server 400s on that).
    expect(password.step.name).toBe("password");
    expect(password.step.fields?.map((f) => f.name)).toEqual([PASSWORD_FIELD]);
    // ADR 022: the engine injects `back` on any step with a predecessor.
    expect(password.step.actions?.some((a) => a.kind === "back")).toBe(true);

    const done = await submitFlowStep(start.id, {
      session_token: password.session_token,
      action: "submit",
      fields: { [PASSWORD_FIELD]: "hunter2" },
    });
    expect(done.step.name).toBe("done");
    // complete: "show" — the web component fires zitadel-flow-complete and
    // waits for the app to navigate; the server does not redirect.
    expect(done.step.complete).toBe("show");
    expect(done.redirect_uri).toBeUndefined();
    expect(done.handoff_token).toBeTruthy();
  });

  test("captures every request body for assertions", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com", password: "hunter2" },
    });
    await getFlowStep(start.id);

    const captured = mock.getCaptured();
    expect(captured).toHaveLength(3);
    expect(captured[0]).toEqual({
      kind: "createFlow",
      body: { purpose: "login", project_id: PROJECT_ID },
    });
    expect(captured[1]).toMatchObject({
      kind: "submitFlowStep",
      body: { fields: { email: "alice@acme.com", password: "hunter2" } },
    });
    expect(captured[2]).toMatchObject({ kind: "getFlowStep" });
  });

  test("rotates the session token on every response", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    const submit = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com" },
    });
    expect(start.session_token).not.toBe(submit.session_token);
  });

  test("routes register through two-step sign-up and the passkey upsell to done", async () => {
    const start = await createFlow({ purpose: "register", project_id: PROJECT_ID });
    expect(start.step.name).toBe("register");
    expect(start.step.fields?.some((f) => f.name === "email")).toBe(true);
    expect(start.step.fields?.some((f) => f.name === "given_name")).toBe(true);
    expect(start.step.fields?.some((f) => f.name === "family_name")).toBe(true);
    expect(start.step.fields?.some((f) => f.name === "date_of_birth")).toBe(true);

    const passwordStep = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: {
        email: "alice@acme.com",
        given_name: "Alice",
        family_name: "Acme",
      },
    });
    expect(passwordStep.step.name).toBe("register-password");
    // Same schema pointer as the sign-in credential step — the real flow
    // definition declares `x-auth-methods#password` on both.
    expect(passwordStep.step.fields?.map((f) => f.name)).toEqual([PASSWORD_FIELD]);

    // The account exists from here, so the flow offers a passkey before
    // finishing rather than dropping the user straight into `done`.
    const upsell = await submitFlowStep(passwordStep.id, {
      session_token: passwordStep.session_token,
      action: "submit",
      fields: { [PASSWORD_FIELD]: "hunter2" },
    });
    expect(upsell.step.name).toBe("passkey-upsell");
    expect(upsell.step.fields ?? []).toEqual([]);
    expect(upsell.step.actions?.map((a) => a.name)).toEqual(["passkey_register", "skip"]);

    const done = await submitFlowStep(upsell.id, {
      session_token: upsell.session_token,
      action: "skip",
    });
    expect(done.step.name).toBe("done");
    expect(done.step.complete).toBe("show");
    expect(done.handoff_token).toBeTruthy();
  });

  test("redirects to SSO when sso_provider_id is set", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    const submit = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: {},
      sso_provider_id: "google",
    });
    expect(submit.step.name).toBe("sso-redirect");
    expect(submit.step.redirect_url).toBeTruthy();
  });

  /**
   * Credential failures land on the **password** step, which is the first
   * request that can fail authentication in the split flow. The error address
   * comes from the flow context, since the password submit carries no email.
   */
  async function submitCredentials(email: string) {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    const password = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email },
    });
    expect(password.step.name).toBe("password");
    return submitFlowStep(start.id, {
      session_token: password.session_token,
      action: "submit",
      fields: { [PASSWORD_FIELD]: "hunter2" },
    });
  }

  test("sign-in wrong credentials stays on password with a field error", async () => {
    const submit = await submitCredentials("wrong@example.com");
    expect(submit.step.name).toBe("password");
    expect(submit.step.error).toBe("error.invalid_credentials");
  });

  test("sign-in server error stays on password with a form-level error key", async () => {
    const submit = await submitCredentials("server@example.com");
    expect(submit.step.name).toBe("password");
    expect(submit.step.error).toBe("error.sign_in_server");
  });

  test("back from the password step returns to the identifier", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    const password = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com" },
    });
    const back = await submitFlowStep(start.id, {
      session_token: password.session_token,
      action: "back",
      fields: {},
    });
    expect(back.step.name).toBe("identifier");
  });

  test("passkey-login: pre-registered credential reaches done with challenge round-trip", async () => {
    mock.registerCredential("alice@acme.com", "cred-alice-1");

    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    const login = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "passkey",
      fields: {},
    });
    expect(login.step.name).toBe("passkey-login");
    expect(login.step.challenge).toBeTruthy();

    const done = await submitFlowStep(login.id, {
      session_token: login.session_token,
      action: "submit",
      fields: {},
      challenge_response: { proof: { id: "cred-alice-1" } },
    });
    expect(done.step.name).toBe("done");
    expect(done.handoff_token).toBeTruthy();
    expect(decodeJwtPayload(done.handoff_token ?? "").sub).toBe("alice@acme.com");
  });

  test("passkey-login: discoverable credential carries authenticated user into handoff token", async () => {
    mock.registerCredential("bob@example.com", "cred-bob-1");

    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    const login = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "passkey",
      fields: {},
    });
    expect(login.step.name).toBe("passkey-login");

    const done = await submitFlowStep(login.id, {
      session_token: login.session_token,
      action: "submit",
      fields: {},
      challenge_response: { proof: { id: "cred-bob-1" } },
    });
    expect(done.step.name).toBe("done");
    expect(done.handoff_token).toBeTruthy();
    expect(decodeJwtPayload(done.handoff_token ?? "").sub).toBe("bob@example.com");
  });

  test("passkey-login: unregistered credential stays on passkey-login with error", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    const login = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "passkey",
      fields: {},
    });
    expect(login.step.name).toBe("passkey-login");

    const fail = await submitFlowStep(login.id, {
      session_token: login.session_token,
      action: "submit",
      fields: {},
      challenge_response: { proof: { id: "cred-unknown" } },
    });
    expect(fail.step.name).toBe("passkey-login");
    expect(fail.step.error).toBe("error.passkey_not_registered");
    expect(fail.step.challenge).toBeUndefined();
  });

  test("passkey-login: submit without proof stays on passkey-login with error", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    const login = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "passkey",
      fields: {},
    });
    expect(login.step.name).toBe("passkey-login");

    const fail = await submitFlowStep(login.id, {
      session_token: login.session_token,
      action: "submit",
      fields: {},
    });
    expect(fail.step.name).toBe("passkey-login");
    expect(fail.step.error).toBe("error.passkey_not_registered");
    expect(fail.step.challenge).toBeUndefined();
  });

  test("merges the active branding overlay onto every response", async () => {
    applyBranding({ layout: "split", logo_url: "https://logo.example/img.svg" });

    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    expect(start.branding).toMatchObject({
      layout: "split",
      logo_url: "https://logo.example/img.svg",
    });

    clearBranding();
    const next = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com" },
    });
    expect(next.branding).toBeUndefined();
  });

  describe("back-navigation (ADR 022)", () => {
    test("register-password → back → register", async () => {
      const start = await createFlow({ purpose: "register", project_id: PROJECT_ID });
      expect(start.step.name).toBe("register");

      const regPw = await submitFlowStep(start.id, {
        session_token: start.session_token,
        action: "submit",
        fields: { email: "alice@acme.com", given_name: "Alice", family_name: "Acme" },
      });
      expect(regPw.step.name).toBe("register-password");
      expect(regPw.step.actions?.find((a) => a.kind === "back")).toBeTruthy();

      const back = await submitFlowStep(regPw.id, {
        session_token: regPw.session_token,
        action: "back",
        fields: {},
      });
      expect(back.step.name).toBe("register");
    });

    test("back rotates the session token", async () => {
      const start = await createFlow({ purpose: "register", project_id: PROJECT_ID });
      const regPw = await submitFlowStep(start.id, {
        session_token: start.session_token,
        action: "submit",
        fields: { email: "alice@acme.com", given_name: "Alice", family_name: "Acme" },
      });
      const back = await submitFlowStep(regPw.id, {
        session_token: regPw.session_token,
        action: "back",
        fields: {},
      });
      expect(back.session_token).not.toBe(regPw.session_token);
    });

    test("identifier step has no back action", async () => {
      const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
      expect(start.step.actions?.find((a) => a.kind === "back")).toBeUndefined();
    });

    test("register step has no back action (initial step for register purpose)", async () => {
      const start = await createFlow({ purpose: "register", project_id: PROJECT_ID });
      expect(start.step.name).toBe("register");
      expect(start.step.actions?.find((a) => a.kind === "back")).toBeUndefined();
    });
  });
});
