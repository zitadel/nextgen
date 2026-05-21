import {
  createFlow,
  getFlowStep,
  submitFlowStep,
} from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen";
import { setApiBaseUrl } from "@zitadel-nextgen/api/runtime/base-url";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
  applyBranding,
  clearBranding,
  setupMockHandlers,
} from "./index.js";
import type { MockHandle } from "./handlers.js";

const PROJECT_ID = "demo-project";
const server = setupServer();
let mock: MockHandle = setupMockHandlers();

beforeAll(() => {
  // Any absolute URL works — the orval-generated handlers match `*/flow*`
  // with a wildcard prefix.
  setApiBaseUrl("http://localhost");
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
  test("walks combined sign-in -> passkey-upsell -> done", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    expect(start.step.name).toBe("identifier");
    expect(start.step.fields?.email).toBeTruthy();
    expect(start.step.fields?.password).toBeTruthy();
    expect(start.id).toBeTruthy();

    const submitSignIn = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com", password: "hunter2" },
    });
    expect(submitSignIn.step.name).toBe("passkey-upsell");

    const submitPasskey = await submitFlowStep(submitSignIn.id, {
      session_token: submitSignIn.session_token,
      action: "skip",
      fields: {},
    });
    expect(submitPasskey.step.name).toBe("done");
    // complete: "show" — the web component fires zitadel-flow-complete and
    // waits for the app to navigate; the server does not redirect.
    expect(submitPasskey.step.complete).toBe("show");
    expect(submitPasskey.redirect_uri).toBeUndefined();
    expect(submitPasskey.handoff_token).toBeTruthy();
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

  test("routes register through sign-up step to passkey-upsell", async () => {
    const start = await createFlow({ purpose: "register", project_id: PROJECT_ID });
    expect(start.step.name).toBe("register");
    const submit = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: {
        email: "alice@acme.com",
        password: "hunter2",
      },
    });
    expect(submit.step.name).toBe("passkey-upsell");
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

  test("sign-in wrong credentials stays on identifier with password field error", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    const submit = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "wrong@example.com", password: "hunter2" },
    });
    expect(submit.step.name).toBe("identifier");
    expect(submit.step.error).toBe("error.invalid_credentials");
  });

  test("passkey setup failure stays on passkey-upsell with error key", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    const upsell = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "passkey-cancel@example.com", password: "hunter2" },
    });
    expect(upsell.step.name).toBe("passkey-upsell");
    const fail = await submitFlowStep(upsell.id, {
      session_token: upsell.session_token,
      action: "setup",
      fields: {},
    });
    expect(fail.step.name).toBe("passkey-upsell");
    expect(fail.step.error).toBe("error.passkey_cancelled");
  });

  test("sign-in server error stays on identifier with form-level error key", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    const submit = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "server@example.com", password: "hunter2" },
    });
    expect(submit.step.name).toBe("identifier");
    expect(submit.step.error).toBe("error.sign_in_server");
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
});
