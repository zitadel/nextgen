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
  getCapturedRequests,
  resetFlow,
  setupMockHandlers,
} from "./index.js";

const PROJECT_ID = "demo-project";
const server = setupServer();

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
  server.use(...setupMockHandlers());
  resetFlow();
  clearBranding();
});

afterEach(() => {
  server.resetHandlers();
});

describe("setupMockHandlers", () => {
  test("walks identifier -> password -> done", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    expect(start.step.name).toBe("identifier");
    expect(start.id).toBeTruthy();

    const submitIdentifier = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com" },
    });
    expect(submitIdentifier.step.name).toBe("password");

    const submitPassword = await submitFlowStep(submitIdentifier.id, {
      session_token: submitIdentifier.session_token,
      action: "submit",
      fields: { password: "hunter2" },
    });
    expect(submitPassword.step.name).toBe("done");
    expect(submitPassword.step.complete).toBe("redirect");
    expect(submitPassword.redirect_uri).toBeTruthy();
    expect(submitPassword.handoff_token).toBeTruthy();
  });

  test("captures every request body for assertions", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com" },
    });
    await getFlowStep(start.id);

    const captured = getCapturedRequests();
    expect(captured).toHaveLength(3);
    expect(captured[0]).toEqual({
      kind: "createFlow",
      body: { purpose: "login", project_id: PROJECT_ID },
    });
    expect(captured[1]).toMatchObject({
      kind: "submitFlowStep",
      body: { fields: { email: "alice@acme.com" } },
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

  test("routes register through its own step before password", async () => {
    const start = await createFlow({ purpose: "register", project_id: PROJECT_ID });
    expect(start.step.name).toBe("register");
    const submit = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: {
        email: "alice@acme.com",
        given_name: "Alice",
        family_name: "Acme",
      },
    });
    expect(submit.step.name).toBe("password");
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
