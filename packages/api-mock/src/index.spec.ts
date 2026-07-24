import {
  createFlow,
  getFlowStep,
  submitFlowStep,
} from "@zitadel/api/generated/endpoints/zitadelNextGen";
import { configureZitadel } from "@zitadel/api/config";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
  applyBranding,
  clearBranding,
  setupMockHandlers,
} from "./index.js";
import type { MockHandle } from "./handlers.js";

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
  test("walks combined sign-in -> done", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    expect(start.step.name).toBe("identifier");
    expect(start.step.fields?.some((f) => f.name === "email")).toBe(true);
    expect(start.step.fields?.some((f) => f.name === "password")).toBe(true);
    expect(start.id).toBeTruthy();

    const done = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com", password: "hunter2" },
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

  test("routes register through two-step sign-up to done", async () => {
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
    expect(passwordStep.step.fields?.some((f) => f.name === "password")).toBe(true);

    const done = await submitFlowStep(passwordStep.id, {
      session_token: passwordStep.session_token,
      action: "submit",
      fields: { password: "hunter2" },
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
});

/** Brute-force the Altcha solution the way `<zl-captcha>` does. */
async function solveGate(config: Record<string, unknown>): Promise<string> {
  const { algorithm, challenge, salt, max_number } = config as {
    algorithm: string;
    challenge: string;
    salt: string;
    max_number: number;
  };
  const encoder = new TextEncoder();
  for (let n = 0; n <= max_number; n++) {
    const digest = await crypto.subtle.digest(algorithm, encoder.encode(salt + n));
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (hex === challenge) {
      return btoa(JSON.stringify({ algorithm, challenge, number: n, salt }));
    }
  }
  throw new Error("gate unsolvable within max_number");
}

describe("gate verification (verifyGates: true)", () => {
  beforeEach(() => {
    const gated = setupMockHandlers({ verifyGates: true });
    server.use(...gated.handlers);
  });

  test("issues a bot_check gate on the identifier step", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    const gate = start.step.gates?.["bot_check"];
    expect(gate?.kind).toBe("captcha");
    expect(gate?.provider).toBe("altcha");
    expect(gate?.config?.challenge).toBeTruthy();
  });

  test("rejects a submit without a proof and re-renders with a fresh challenge", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    const firstChallenge = start.step.gates?.["bot_check"]?.config?.challenge;

    const rejected = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com", password: "hunter2" },
    });
    expect(rejected.step.name).toBe("identifier");
    expect(rejected.step.error).toBe("error.gate_failed");
    const freshChallenge = rejected.step.gates?.["bot_check"]?.config?.challenge;
    expect(freshChallenge).toBeTruthy();
    expect(freshChallenge).not.toBe(firstChallenge);
  });

  test("rejects a tampered proof", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    const config = start.step.gates?.["bot_check"]?.config as Record<string, unknown>;
    const valid = await solveGate(config);
    const tampered = btoa(
      JSON.stringify({ ...(JSON.parse(atob(valid)) as Record<string, unknown>), number: -1 }),
    );

    const rejected = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com", password: "hunter2" },
      gate_proofs: { bot_check: tampered },
    });
    expect(rejected.step.error).toBe("error.gate_failed");
  });

  test("accepts a valid proof and advances the flow", async () => {
    const start = await createFlow({ purpose: "login", project_id: PROJECT_ID });
    const config = start.step.gates?.["bot_check"]?.config as Record<string, unknown>;
    const proof = await solveGate(config);

    const done = await submitFlowStep(start.id, {
      session_token: start.session_token,
      action: "submit",
      fields: { email: "alice@acme.com", password: "hunter2" },
      gate_proofs: { bot_check: proof },
    });
    expect(done.step.name).toBe("done");
    expect(done.step.error).toBeUndefined();
  });
});
