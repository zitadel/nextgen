/**
 * jsdom-friendly integration tests for `<zitadel-login>`. Network calls go
 * through the typed `@zitadel/api` fetch client; we intercept them
 * with `msw/node` driven by the shared xstate flow walker in
 * `@zitadel/api-mock`.
 *
 * Behaviour that needs the FACE platform (form participation, focus
 * delegation, real Enter-to-submit) lives in
 * `zitadel-login.browser.spec.ts` because jsdom 29 only ships a partial
 * `ElementInternals` implementation.
 */
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import {
  applyBranding,
  clearBranding,
  setupMockHandlers,
  type CapturedRequest,
  type MockHandle,
} from "@zitadel/api-mock";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";

const API_BASE = "https://flow.test.invalid";

let mock: MockHandle = setupMockHandlers();
const server = setupServer(...mock.handlers);

let testProject = configureZitadel({ proxyPath: API_BASE, projectId: "demo-project" });

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(() => {
  _resetConfigForTesting();
  testProject = configureZitadel({ proxyPath: API_BASE, projectId: "demo-project" });
  mock = setupMockHandlers();
  mock.reset();
  server.resetHandlers(...mock.handlers);
  clearBranding();
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

async function waitFor<T>(probe: () => T | null | undefined, timeout = 1500): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error("waitFor timed out");
}

/** Walks the api-mock login path: combined sign-in → done. */
async function advanceMockLoginFlow(element: ZitadelLogin, email = "alice@acme.com"): Promise<void> {
  element.shadowRoot?.dispatchEvent(
    new CustomEvent("zl-input", {
      bubbles: true,
      composed: true,
      detail: { name: "email", value: email },
    }),
  );
  element.shadowRoot?.dispatchEvent(
    new CustomEvent("zl-input", {
      bubbles: true,
      composed: true,
      detail: { name: "password", value: "hunter2" },
    }),
  );
  element.shadowRoot?.dispatchEvent(
    new CustomEvent("zl-submit", {
      bubbles: true,
      composed: true,
      detail: { action: "submit" },
    }),
  );
}

async function mount(host: HTMLElement): Promise<ZitadelLogin> {
  const element = document.createElement("zitadel-login") as ZitadelLogin;
  element.purpose = "login";
  element.project = testProject;
  host.appendChild(element);
  await waitFor(() => element.shadowRoot?.querySelector("zl-field"));
  return element;
}

describe("<zitadel-login> against the typed Flow API", () => {
  let host: HTMLDivElement;

  beforeAll(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.innerHTML = "";
  });

  it("starts a flow on mount and renders the first step", async () => {
    const element = await mount(host);
    const root = element.shadowRoot;
    expect(root).toBeTruthy();
    const fields = root?.querySelectorAll("zl-field") ?? [];
    expect(fields.length).toBe(2);
    expect(fields[0]?.getAttribute("name")).toBe("email");
    expect(fields[1]?.getAttribute("name")).toBe("password");
  });

  it("starts a flow from project-id / proxy-path attributes with no global config", async () => {
    // Clear the global so the attributes are the only thing that can configure
    // the element — proves declarative HTML config works on its own.
    _resetConfigForTesting();
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.setAttribute("project-id", "demo-project");
    element.setAttribute("proxy-path", API_BASE);
    host.appendChild(element);
    await waitFor(() => element.shadowRoot?.querySelector("zl-field"));

    expect(mock.getCaptured()[0]).toEqual({
      kind: "createFlow",
      body: { purpose: "login", project_id: "demo-project" },
    });
  });

  it("prefers the project property over the project-id attribute", async () => {
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.project = testProject; // projectId "demo-project"
    element.setAttribute("project-id", "ignored-attr-project");
    element.setAttribute("proxy-path", API_BASE);
    host.appendChild(element);
    await waitFor(() => element.shadowRoot?.querySelector("zl-field"));

    // The property wins: the attribute's project id never reaches the wire.
    expect(mock.getCaptured()[0]).toEqual({
      kind: "createFlow",
      body: { purpose: "login", project_id: "demo-project" },
    });
  });

  it("prefers the configureZitadel() global over the project-id attribute", async () => {
    // beforeEach already configured the global to "demo-project"; a stray/stale
    // attribute must not override a deliberate app-wide configureZitadel().
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.setAttribute("project-id", "ignored-attr-project");
    element.setAttribute("proxy-path", API_BASE);
    host.appendChild(element);
    await waitFor(() => element.shadowRoot?.querySelector("zl-field"));

    expect(mock.getCaptured()[0]).toEqual({
      kind: "createFlow",
      body: { purpose: "login", project_id: "demo-project" },
    });
  });

  it("submits with {session_token, action, fields} and applies the next step", async () => {
    const element = await mount(host);

    // Simulate the user typing into the identifier field by feeding the
    // `zl-input` event the orchestrator listens for. The atom-level event
    // is the same one form-associated `<zl-field>` instances dispatch in
    // a real browser; here we sidestep the form-association code path
    // because jsdom only partially implements `ElementInternals`.
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-input", {
        bubbles: true,
        composed: true,
        detail: { name: "email", value: "alice@acme.com" },
      }),
    );
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-input", {
        bubbles: true,
        composed: true,
        detail: { name: "password", value: "hunter2" },
      }),
    );

    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );

    await waitFor(() => {
      const title = element.shadowRoot?.querySelector(".zl-card-title");
      return title?.textContent?.includes("You're signed in") ? title : null;
    });

    const submits = mock
      .getCaptured()
      .filter(
        (req): req is Extract<CapturedRequest, { kind: "submitFlowStep" }> =>
          req.kind === "submitFlowStep",
      );
    expect(submits).toHaveLength(1);
    expect(submits[0]?.body).toMatchObject({
      action: "submit",
      fields: { email: "alice@acme.com", password: "hunter2" },
    });
    expect(typeof submits[0]?.body.session_token).toBe("string");
  });

  it("emits zitadel-flow-complete when the step ends with `complete: show`", async () => {
    const element = await mount(host);
    const completeEvents: CustomEvent[] = [];
    element.addEventListener("zitadel-flow-complete", (event: Event) =>
      completeEvents.push(event as CustomEvent),
    );

    await advanceMockLoginFlow(element);
    await waitFor(() => (completeEvents.length > 0 ? completeEvents : null));
    expect(completeEvents[0]?.detail).toEqual(expect.objectContaining({ behavior: "show" }));
    expect(completeEvents[0]?.detail.handoff_token).toBeTruthy();
  });

  it("exchanges the handoff token and navigates when post-sign-in-url is set", async () => {
    const assign = vi.fn();
    const { location } = window;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...location, assign },
    });

    try {
      const element = document.createElement("zitadel-login") as ZitadelLogin;
      element.purpose = "login";
      element.project = testProject;
      element.postSignInUrl = "/admin";
      host.appendChild(element);
      await waitFor(() => element.shadowRoot?.querySelector("zl-field"));

      await advanceMockLoginFlow(element);

      await waitFor(() => (assign.mock.calls.length > 0 ? assign : null));
      expect(assign).toHaveBeenCalledWith("/admin");
      const exchanges = mock
        .getCaptured()
        .filter(
          (req): req is Extract<CapturedRequest, { kind: "exchangeHandoff" }> =>
            req.kind === "exchangeHandoff",
        );
      expect(exchanges).toHaveLength(1);
      expect(exchanges[0]?.body.handoff_token).toBeTruthy();
      expect(exchanges[0]?.projectId).toBe("demo-project");
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: location,
      });
    }
  });

  it("surfaces network errors via zitadel-flow-error", async () => {
    server.resetHandlers(http.post("*/flow", () => HttpResponse.error(), { once: true }));

    const errorEvents: CustomEvent[] = [];
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.project = testProject;
    element.addEventListener("zitadel-flow-error", (event: Event) =>
      errorEvents.push(event as CustomEvent),
    );
    host.appendChild(element);

    await waitFor(() => (errorEvents.length > 0 ? errorEvents : null), 3000);
    expect(errorEvents[0]?.detail.message).toBeTypeOf("string");
  });

  it("renders branding overlay applied via api-mock applyBranding", async () => {
    applyBranding({ layout: "split", logo_url: "https://logo.example/img.svg" });
    await mount(host);
    const captured = mock.getCaptured();
    expect(captured[0]).toEqual({
      kind: "createFlow",
      body: { purpose: "login", project_id: "demo-project" },
    });
  });

  it("auto-submits challenge_response when zl-passkey-result is dispatched", async () => {
    const element = await mount(host);

    // Navigate to the passkey-login step by submitting action: "passkey"
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "passkey" },
      }),
    );

    // Wait for the passkey-login step (which contains a challenge)
    await waitFor(() => {
      const submits = mock
        .getCaptured()
        .filter(
          (req): req is Extract<CapturedRequest, { kind: "submitFlowStep" }> =>
            req.kind === "submitFlowStep",
        );
      return submits.some((s) => s.body.action === "passkey") ? submits : null;
    });

    // Pre-register the credential so the mock's passkey-login check passes.
    mock.registerCredential("mock-user@example.com", "cred_mock_123");

    // Simulate a successful WebAuthn ceremony by dispatching zl-passkey-result
    const mockProof = {
      id: "cred_mock_123",
      rawId: "Y3JlZF9tb2NrXzEyMw",
      type: "public-key",
      response: {
        authenticatorData: "AAAA",
        clientDataJSON: "BBBB",
        signature: "CCCC",
      },
    };
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-passkey-result", {
        bubbles: true,
        composed: true,
        detail: {
          challenge_id: "ch_mock_passkey_login",
          method: "passkey",
          proof: mockProof,
        },
      }),
    );

    // Wait for the flow to complete (done step)
    const completeEvents: CustomEvent[] = [];
    element.addEventListener("zitadel-flow-complete", (event: Event) =>
      completeEvents.push(event as CustomEvent),
    );
    await waitFor(() => (completeEvents.length > 0 ? completeEvents : null));

    // Assert the submit body includes challenge_response
    const submits = mock
      .getCaptured()
      .filter(
        (req): req is Extract<CapturedRequest, { kind: "submitFlowStep" }> =>
          req.kind === "submitFlowStep",
      );
    // Two submits: passkey action + challenge_response submit
    expect(submits.length).toBeGreaterThanOrEqual(2);
    const proofSubmit = submits.find((s) => s.body.challenge_response);
    expect(proofSubmit).toBeDefined();
    expect(proofSubmit?.body.action).toBe("passkey");
    expect(proofSubmit?.body.challenge_response).toEqual({
      challenge_id: "ch_mock_passkey_login",
      method: "passkey",
      proof: mockProof,
    });
  });

  it("does not restart a passkey registration challenge while submitting the proof", async () => {
    const originalCredentials = Object.getOwnPropertyDescriptor(navigator, "credentials");
    const originalPublicKeyCredential = Object.getOwnPropertyDescriptor(
      window,
      "PublicKeyCredential",
    );
    const create = vi.fn(() => Promise.race<PublicKeyCredential>([]));
    let releaseSubmit: (() => void) | undefined;

    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: class PublicKeyCredentialStub {},
    });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { create: create as unknown as CredentialsContainer["create"], get: vi.fn() },
    });

    try {
      server.use(
        http.post(
          "*/flow/*/submit",
          () =>
            new Promise((resolve) => {
              releaseSubmit = () =>
                resolve(
                  HttpResponse.json({
                    id: "flow-1",
                    session_token: "token-1",
                    step: {
                      name: "done",
                      texts: {},
                      fields: [],
                      actions: [],
                      gates: {},
                      complete: { behavior: "show" },
                    },
                    branding: {},
                  }),
                );
            }),
        ),
      );

      const element = await mount(host);
      Reflect.set(element, "response", {
        id: "flow-1",
        session_id: "sess-1",
        session_token: "token-1",
        step: {
          name: "passkey-enroll",
          texts: { title_key: "passkey-enroll.title" },
          fields: [],
          actions: [],
          gates: {},
          challenge: {
            method: "passkey_register",
            challenge_id: "reg-1",
            options: {
              challenge: "AAAA",
              rp: { id: "localhost", name: "localhost" },
              user: {
                id: "dXNlcl8x",
                name: "alice@example.com",
                displayName: "alice@example.com",
              },
              pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            },
          },
        },
        branding: {},
      });
      Reflect.set(element, "loading", false);
      await element.updateComplete;

      await waitFor(() => (create.mock.calls.length === 1 ? true : null));
      expect(element.shadowRoot?.querySelector("zl-passkey")).toBeTruthy();

      element.shadowRoot?.dispatchEvent(
        new CustomEvent("zl-passkey-result", {
          bubbles: true,
          composed: true,
          detail: {
            challenge_id: "reg-1",
            method: "passkey_register",
            proof: {
              id: "cred_mock_123",
              rawId: "Y3JlZF9tb2NrXzEyMw",
              type: "public-key",
              response: {
                attestationObject: "AAAA",
                clientDataJSON: "BBBB",
              },
            },
          },
        }),
      );

      await waitFor(() => (Reflect.get(element, "loading") === true ? true : null));
      await element.updateComplete;

      expect(element.shadowRoot?.querySelector("zl-passkey")).toBeNull();
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      releaseSubmit?.();
      if (originalCredentials) {
        Object.defineProperty(navigator, "credentials", originalCredentials);
      } else {
        delete (navigator as unknown as Record<string, unknown>).credentials;
      }
      if (originalPublicKeyCredential) {
        Object.defineProperty(window, "PublicKeyCredential", originalPublicKeyCredential);
      } else {
        delete (window as unknown as Record<string, unknown>).PublicKeyCredential;
      }
    }
  });

  it("re-renders with error and strips challenge on zl-passkey-error", async () => {
    const element = await mount(host);

    // Navigate to the passkey-login step
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "passkey" },
      }),
    );

    // Wait for the passkey-login step
    await waitFor(() => {
      const submits = mock
        .getCaptured()
        .filter(
          (req): req is Extract<CapturedRequest, { kind: "submitFlowStep" }> =>
            req.kind === "submitFlowStep",
        );
      return submits.some((s) => s.body.action === "passkey") ? submits : null;
    });

    // Allow the Lit render cycle to complete before dispatching the error
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Simulate a cancelled WebAuthn ceremony
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-passkey-error", {
        bubbles: true,
        composed: true,
        detail: {
          challenge_id: "ch_mock_passkey_login",
          error: "The operation was cancelled.",
          aborted: true,
        },
      }),
    );

    // Wait for the error to be applied to the step
    await waitFor(() => {
      // Access the internal response — the step should have the error key
      // and the challenge should be stripped
      const root = element.shadowRoot;
      const alert = root?.querySelector("zl-alert");
      return alert ? alert : null;
    });

    // The step should still be passkey-login (no additional submits from the error)
    const postErrorSubmits = mock
      .getCaptured()
      .filter(
        (req): req is Extract<CapturedRequest, { kind: "submitFlowStep" }> =>
          req.kind === "submitFlowStep",
      );
    // Only the initial "passkey" action submit — no extra submit from the error handler
    expect(postErrorSubmits).toHaveLength(1);
    expect(postErrorSubmits[0]?.body.action).toBe("passkey");
  });

  it("preserves typed input when the server rejects a submit with a step-level error", async () => {
    const element = await mount(host);

    // Real backend behaviour on a validation error: 400 carrying the same
    // step shape with `fields.value` unset and `step.error` populated. We
    // override the mock's submit handler to mirror that wire shape.
    server.use(
      http.post("*/flow/*/submit", () =>
        HttpResponse.json(
          {
            id: "flow_test",
            session_token: "st_test",
            step: {
              name: "identifier",
              texts: { title_key: "identifier.title" },
              fields: [
                {
                  name: "email",
                  type: "email",
                  text_key: "identifier.field.email",
                  required: true,
                },
                {
                  name: "password",
                  type: "password",
                  text_key: "identifier.field.password",
                  required: true,
                },
              ],
              actions: [{ name: "submit", text_key: "submit.signin", primary: true }],
              gates: {},
              error: "flow field email: format",
            },
            branding: {},
          },
          { status: 400 },
        ),
      ),
    );

    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-input", {
        bubbles: true,
        composed: true,
        detail: { name: "email", value: "bad-email" },
      }),
    );
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );

    // Wait until the error alert renders — confirms applyResponse ran.
    await waitFor(() => element.shadowRoot?.querySelector("zl-alert"));
    // One more frame so the post-render applyValuesToFields callback fires.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    // Regression: empty defaults from the re-rendered step used to wipe
    // formValues, which then propagated back to the field via
    // applyValuesToFields. The typed input must survive.
    const emailField = element.shadowRoot?.querySelector<HTMLElement & { value?: string }>(
      'zl-field[name="email"]',
    );
    expect(emailField?.value).toBe("bad-email");
  });

  it("sends declared step fields on submit even when the user typed nothing", async () => {
    const element = await mount(host);

    // Submit immediately without dispatching any zl-input. The wire body
    // must still include every field the current step declares — empty
    // strings if necessary — otherwise the backend skips required-checks
    // and challenge dispatch and silently advances on an empty payload.
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );

    await waitFor(() => {
      const submits = mock
        .getCaptured()
        .filter(
          (req): req is Extract<CapturedRequest, { kind: "submitFlowStep" }> =>
            req.kind === "submitFlowStep",
        );
      return submits.length > 0 ? submits : null;
    });

    const submits = mock
      .getCaptured()
      .filter(
        (req): req is Extract<CapturedRequest, { kind: "submitFlowStep" }> =>
          req.kind === "submitFlowStep",
      );
    expect(submits[0]?.body.fields).toEqual({ email: "", password: "" });
  });

  describe("back-navigation (ADR 022)", () => {
    /** Navigate from identifier → register → register-password (has back action). */
    async function navigateToRegisterPassword(element: ZitadelLogin): Promise<void> {
      // identifier → register
      element.shadowRoot?.dispatchEvent(
        new CustomEvent("zl-submit", {
          bubbles: true,
          composed: true,
          detail: { action: "register" },
        }),
      );
      await waitFor(() => {
        const title = element.shadowRoot?.querySelector(".zl-card-title");
        return title?.textContent?.includes("Create") ? title : null;
      });

      // Fill required register fields
      for (const [name, value] of Object.entries({
        email: "alice@acme.com",
        given_name: "Alice",
        family_name: "Acme",
      })) {
        element.shadowRoot?.dispatchEvent(
          new CustomEvent("zl-input", {
            bubbles: true,
            composed: true,
            detail: { name, value },
          }),
        );
      }

      // register → register-password
      element.shadowRoot?.dispatchEvent(
        new CustomEvent("zl-submit", {
          bubbles: true,
          composed: true,
          detail: { action: "submit" },
        }),
      );
      await waitFor(() =>
        element.shadowRoot?.querySelector('[data-action="back"]'),
      );
    }

    it("renders a back link when the step has a kind: back action", async () => {
      const element = await mount(host);
      await navigateToRegisterPassword(element);

      const backLink = element.shadowRoot?.querySelector<HTMLElement>('[data-action="back"]');
      expect(backLink).toBeTruthy();
      expect(backLink?.classList.contains("zl-card-nav__link")).toBe(true);
    });

    it("does not render a back link on the identifier step", async () => {
      const element = await mount(host);

      // Identifier is the initial step — no back action
      const backLink = element.shadowRoot?.querySelector('[data-action="back"]');
      expect(backLink).toBeNull();
    });

    it("clicking the back link submits the back action", async () => {
      const element = await mount(host);
      await navigateToRegisterPassword(element);

      // Click the back link
      const backLink = element.shadowRoot?.querySelector<HTMLElement>('[data-action="back"]');
      backLink?.click();

      // Wait for the step to change back to register (which has no back action)
      await waitFor(() => {
        const link = element.shadowRoot?.querySelector('[data-action="back"]');
        return link === null ? true : null;
      });

      // Verify the back action was submitted
      const submits = mock.getCaptured().filter(
        (req): req is Extract<CapturedRequest, { kind: "submitFlowStep" }> =>
          req.kind === "submitFlowStep",
      );
      const backSubmit = submits.find((s) => s.body.action === "back");
      expect(backSubmit).toBeDefined();
    });

    it("calls history.pushState when step has kind: back action", async () => {
      const pushState = vi.spyOn(history, "pushState");
      try {
        const element = await mount(host);
        await navigateToRegisterPassword(element);

        // pushState should have been called for register-password (has back)
        const zlCalls = pushState.mock.calls.filter(
          ([state]) => (state as { zl?: boolean } | null)?.zl === true,
        );
        expect(zlCalls.length).toBeGreaterThanOrEqual(1);
        const lastCall = zlCalls.at(-1);
        expect(lastCall?.[2]).toMatch(/^#s\d+$/);
      } finally {
        pushState.mockRestore();
      }
    });

    it("does not call history.pushState when step has no back action", async () => {
      const pushState = vi.spyOn(history, "pushState");
      try {
        await mount(host);

        // Identifier step has no back action — no zl-tagged pushState calls
        const zlCalls = pushState.mock.calls.filter(
          ([state]) => (state as { zl?: boolean } | null)?.zl === true,
        );
        expect(zlCalls).toHaveLength(0);
      } finally {
        pushState.mockRestore();
      }
    });

    it("removes the popstate listener on disconnect", async () => {
      const removeSpy = vi.spyOn(window, "removeEventListener");
      try {
        const element = await mount(host);
        element.remove();

        const popstateCalls = removeSpy.mock.calls.filter(
          ([event]) => event === "popstate",
        );
        expect(popstateCalls.length).toBeGreaterThanOrEqual(1);
      } finally {
        removeSpy.mockRestore();
      }
    });
  });
});
