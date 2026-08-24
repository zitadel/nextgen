import {
  applyBranding,
  clearBranding,
  PASSWORD_FIELD,
  setupMockHandlers,
  type CapturedRequest,
  type MockHandle,
} from "@zitadel/api-mock";
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
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-login.js";
import type { ZlAlert } from "../atoms/zl-alert.js";
import type { ZitadelLogin } from "./zitadel-login.js";

const API_BASE = "https://flow.test.invalid";

let mock: MockHandle = setupMockHandlers();
const server = setupServer(...mock.handlers);

let testProject = configureZitadel({
  proxyPath: API_BASE,
  projectId: "demo-project",
});

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(() => {
  _resetConfigForTesting();
  testProject = configureZitadel({
    proxyPath: API_BASE,
    projectId: "demo-project",
  });
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

function type(element: ZitadelLogin, name: string, value: string): void {
  element.shadowRoot?.dispatchEvent(
    new CustomEvent("zl-input", { bubbles: true, composed: true, detail: { name, value } }),
  );
}

function submit(element: ZitadelLogin, action = "submit"): void {
  element.shadowRoot?.dispatchEvent(
    new CustomEvent("zl-submit", { bubbles: true, composed: true, detail: { action } }),
  );
}

/**
 * Walks the login path the real default flow defines, which the api-mock now
 * mirrors: `identifier` (email) → `password` → `done`. Two round trips, so
 * callers must await the password step rendering between them.
 *
 * The credential is keyed by the schema pointer {@link PASSWORD_FIELD}, exactly
 * as the server emits and requires it — submitting a plain `password` key makes
 * the real backend answer `req.invalid`.
 */
async function advanceMockLoginFlow(
  element: ZitadelLogin,
  email = "alice@acme.com",
): Promise<void> {
  type(element, "email", email);
  submit(element);
  // The identifier submit swaps in the password step; wait for its field to
  // exist before typing into it, or the value lands on the previous step.
  await waitFor(() => element.shadowRoot?.querySelector(`zl-field[name="${PASSWORD_FIELD}"]`));
  type(element, PASSWORD_FIELD, "hunter2");
  submit(element);
}

/** Create and attach a login element without waiting for a render. */
function attachLogin(host: HTMLElement): ZitadelLogin {
  const element = document.createElement("zitadel-login") as ZitadelLogin;
  element.purpose = "login";
  element.project = testProject;
  host.appendChild(element);
  return element;
}

async function mount(host: HTMLElement): Promise<ZitadelLogin> {
  const element = attachLogin(host);
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
    // The default flow's identifier step collects the email only; the
    // credential lives on its own step (see `advanceMockLoginFlow`).
    const fields = root?.querySelectorAll("zl-field") ?? [];
    expect(fields.length).toBe(1);
    expect(fields[0]?.getAttribute("name")).toBe("email");
  });

  it("advances from the identifier step to the credential step", async () => {
    const element = await mount(host);
    type(element, "email", "alice@acme.com");
    submit(element);

    const field = await waitFor(() =>
      element.shadowRoot?.querySelector(`zl-field[name="${PASSWORD_FIELD}"]`),
    );
    expect(field.getAttribute("type")).toBe("password");
    // The identifier submit carries only what that step declared.
    const submitted = mock
      .getCaptured()
      .find(
        (request): request is CapturedRequest & { kind: "submitFlowStep" } =>
          request.kind === "submitFlowStep",
      );
    expect(submitted?.body.fields).toEqual({ email: "alice@acme.com" });
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

  it("sends flow_definition_name when flow-name is set", async () => {
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.project = testProject;
    element.setAttribute("flow-name", "kiosk-login");
    host.appendChild(element);
    await waitFor(() => element.shadowRoot?.querySelector("zl-field"));

    // Exact match: nothing but the three keys — the default (no flow-name)
    // body shape is pinned by the startup tests above.
    expect(mock.getCaptured()[0]).toEqual({
      kind: "createFlow",
      body: {
        purpose: "login",
        project_id: "demo-project",
        flow_definition_name: "kiosk-login",
      },
    });
  });

  it("explains a flow-name that matches no active flow definition", async () => {
    // The server envelope only says "not found" — the orchestrator owns
    // knowing the name came from its `flow-name` attribute.
    server.use(
      http.post(
        "*/flow",
        () =>
          HttpResponse.json(
            {
              code: "flowdef.not_found",
              message: "flow definition: not found",
            },
            { status: 404 },
          ),
        { once: true },
      ),
    );
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.project = testProject;
    element.setAttribute("flow-name", "no-such-flow");
    host.appendChild(element);

    await waitFor(() => element.shadowRoot?.querySelector("zl-alert"));
    const text = element.shadowRoot?.querySelector("zl-alert")?.textContent ?? "";
    expect(text).toContain('flow-name="no-such-flow"');
    expect(text).toContain("zitadel apply");
  });

  it("explains a flow-name that does not serve the requested purpose", async () => {
    server.use(
      http.post(
        "*/flow",
        () =>
          HttpResponse.json(
            {
              code: "flowdef.purpose_mismatch",
              message: "flow definition: does not serve requested purpose",
            },
            { status: 400 },
          ),
        { once: true },
      ),
    );
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.project = testProject;
    element.setAttribute("flow-name", "register-only");
    host.appendChild(element);

    await waitFor(() => element.shadowRoot?.querySelector("zl-alert"));
    const text = element.shadowRoot?.querySelector("zl-alert")?.textContent ?? "";
    expect(text).toContain('flow-name="register-only"');
    expect(text).toContain('purpose "login"');
  });

  it("submits with {session_token, action, fields} and applies the next step", async () => {
    const element = await mount(host);

    // `advanceMockLoginFlow` feeds the `zl-input`/`zl-submit` events the
    // orchestrator listens for — the same ones form-associated `<zl-field>`
    // instances dispatch in a real browser. We sidestep the form-association
    // code path because jsdom only partially implements `ElementInternals`.
    await advanceMockLoginFlow(element);

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
    // One submit per step of the split flow, each carrying only that step's
    // own declared fields — the credential never rides along with the email.
    expect(submits).toHaveLength(2);
    expect(submits[0]?.body).toMatchObject({
      action: "submit",
      fields: { email: "alice@acme.com" },
    });
    expect(submits[1]?.body).toMatchObject({
      action: "submit",
      fields: { [PASSWORD_FIELD]: "hunter2" },
    });
    expect(submits.every((req) => typeof req.body.session_token === "string")).toBe(true);
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

  it("surfaces the server's error-envelope message on a req.invalid submit rejection", async () => {
    const element = await mount(host);
    const serverMessage =
      'origin "http://127.0.0.1:3000" is not allowed for this project (allowed: http://localhost:3000)';
    // Envelope-shaped 400 (no `step`), like the flow handler's passkey
    // origin-allowlist rejection — must bubble past submitStep's
    // flow-response unwrap and reach the user verbatim.
    server.use(
      http.post(
        "*/flow/*/submit",
        () => HttpResponse.json({ code: "req.invalid", message: serverMessage }, { status: 400 }),
        { once: true },
      ),
    );

    const errorEvents: CustomEvent[] = [];
    element.addEventListener("zitadel-flow-error", (event: Event) =>
      errorEvents.push(event as CustomEvent),
    );
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );

    await waitFor(() => (errorEvents.length > 0 ? errorEvents : null), 3000);
    expect(errorEvents[0]?.detail.message).toBe(serverMessage);
    await waitFor(() => element.shadowRoot?.querySelector("zl-alert"));
    expect(element.shadowRoot?.querySelector("zl-alert")?.textContent).toContain(serverMessage);
    // The failure keeps the login surface: the alert renders inside the same
    // page-shell/card chrome a step would, not bare on an otherwise empty
    // page — a misconfigured origin is the common trigger and used to blank
    // the app after the first step had painted normally.
    const alert = element.shadowRoot?.querySelector("zl-alert");
    expect(alert?.closest("zl-card")).not.toBeNull();
    expect(alert?.closest("zl-page-shell")).not.toBeNull();
  });

  it("renders branding overlay applied via api-mock applyBranding", async () => {
    applyBranding({
      layout: "split",
      logo_url: "https://logo.example/img.svg",
    });
    await mount(host);
    const captured = mock.getCaptured();
    expect(captured[0]).toEqual({
      kind: "createFlow",
      body: { purpose: "login", project_id: "demo-project" },
    });
  });

  it("renders the bundled default template when the server sends no liquid_template", async () => {
    // `clearBranding()` in beforeEach means the mock — like the real server —
    // ships no `branding.liquid_template`. The `data-testid` markers exist
    // only in the components-bundled template, so their presence proves the
    // client-side default rendered.
    const element = await mount(host);
    expect(
      element.shadowRoot!.querySelector('zl-field[data-testid="zitadel-field-email"]'),
    ).toBeTruthy();
  });

  it("renders a server-sent branding.liquid_template instead of the bundled default", async () => {
    applyBranding({
      liquid_template: '<p data-testid="tenant-template">tenant-owned</p>',
    });
    const element = attachLogin(host);

    // Can't use mount(): the marker is what signals the render completed.
    const marker = await waitFor(() =>
      element.shadowRoot?.querySelector('[data-testid="tenant-template"]'),
    );
    expect(marker.textContent).toBe("tenant-owned");
    // patchMandatoryGates re-injects the step's mandatory fields into tenant
    // templates that omit them, so a bare zl-field is expected — but the
    // bundled default (recognisable by its data-testid markers) must not be
    // the template that rendered.
    expect(
      element.shadowRoot!.querySelector('zl-field[data-testid="zitadel-field-email"]'),
    ).toBeNull();
  });

  it("renders a primary passkey action as exactly one button", async () => {
    // Regression for the duplicate "Continue with passkey" button: the
    // template renders primary actions generically AND has a dedicated
    // passkey block, which must skip a passkey that is already primary.
    server.use(
      http.post("*/flow", () =>
        HttpResponse.json(
          {
            id: "flow_test",
            session_id: "sess_test",
            session_token: "st_test",
            step: {
              name: "passkey-first",
              texts: { title_key: "identifier.title" },
              fields: [],
              actions: [
                {
                  name: "passkey",
                  text_key: "identifier.action.passkey",
                  primary: true,
                },
              ],
              gates: {},
            },
          },
          { status: 201 },
        ),
      ),
    );

    const element = attachLogin(host);

    await waitFor(() => element.shadowRoot?.querySelector('zl-button[action="passkey"]'));
    const passkeyButtons = element.shadowRoot!.querySelectorAll('zl-button[action="passkey"]');
    expect(passkeyButtons).toHaveLength(1);
    expect(passkeyButtons[0]?.getAttribute("hierarchy")).toBe("primary");
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
      value: {
        create: create as unknown as CredentialsContainer["create"],
        get: vi.fn(),
      },
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

  it("shows the pending UI during a hung ceremony; cancel lands in the cancelled banner", async () => {
    const originalCredentials = Object.getOwnPropertyDescriptor(navigator, "credentials");
    const originalPublicKeyCredential = Object.getOwnPropertyDescriptor(
      window,
      "PublicKeyCredential",
    );
    // A ceremony that never resolves on its own — only the abort signal
    // (wired to the atom's Cancel button) can end it.
    const create = vi.fn(
      (arg: { signal?: AbortSignal }) =>
        new Promise<PublicKeyCredential>((_resolve, reject) => {
          arg.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: class PublicKeyCredentialStub {},
    });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        create: create as unknown as CredentialsContainer["create"],
        get: vi.fn(),
      },
    });

    try {
      const element = await mount(host);
      const submitsBefore = mock
        .getCaptured()
        .filter((req) => req.kind === "submitFlowStep").length;
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

      // The atom renders its pending UI into its light DOM inside the
      // orchestrator's shadow root, without a step re-render.
      const cancel = await waitFor(() =>
        element.shadowRoot?.querySelector<HTMLElement>('[data-testid="zitadel-passkey-cancel"]'),
      );
      expect(
        element.shadowRoot?.querySelector('[data-testid="zitadel-passkey-pending"]'),
      ).toBeTruthy();

      cancel.click();

      // Cancel → abort → cancelled banner; challenge stripped so the atom
      // (and its pending UI) unmounts and the ceremony is not restarted.
      await waitFor(() => {
        const alert = element.shadowRoot?.querySelector("zl-alert");
        return alert?.textContent?.includes("closed before completing") ? alert : null;
      });
      expect(element.shadowRoot?.querySelector("zl-passkey")).toBeNull();
      expect(create).toHaveBeenCalledTimes(1);
      // The cancel click must not have produced a step submission.
      const submitsAfter = mock.getCaptured().filter((req) => req.kind === "submitFlowStep").length;
      expect(submitsAfter).toBe(submitsBefore);
    } finally {
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

  it("renders the timeout copy when the ceremony reports timed_out", async () => {
    const element = await mount(host);

    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-passkey-error", {
        bubbles: true,
        composed: true,
        detail: {
          challenge_id: "ch_mock_passkey_login",
          error: "The operation timed out.",
          aborted: true,
          timed_out: true,
        },
      }),
    );

    const alert = await waitFor(() => {
      const candidate = element.shadowRoot?.querySelector("zl-alert");
      return candidate?.textContent?.includes("timed out") ? candidate : null;
    });
    expect(alert.textContent).toContain("The passkey request timed out. Please try again.");
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
              error: "error.email_invalid",
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

    // Wait until the inline error renders — confirms applyResponse ran.
    // `error.email_invalid` attaches to the email field via the
    // fieldErrorKeys routing.
    await waitFor(() => {
      const field = element.shadowRoot?.querySelector('zl-field[name="email"]');
      return field?.getAttribute("error") ? field : null;
    });
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

  it("routes a field-validation error key inline on the field, not as a banner", async () => {
    const element = await mount(host);

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
              ],
              actions: [{ name: "submit", text_key: "submit.signin", primary: true }],
              gates: {},
              error: "error.email_invalid",
            },
            branding: {},
          },
          { status: 400 },
        ),
      ),
    );
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );

    const field = await waitFor(() => {
      const candidate = element.shadowRoot?.querySelector('zl-field[name="email"][invalid]');
      return candidate?.getAttribute("error") ? candidate : null;
    });
    expect(field.getAttribute("error")).toBe("Please enter a valid email");
    // The raw key must not leak anywhere, and no banner renders.
    expect(element.shadowRoot?.querySelector("zl-alert")).toBeNull();
    expect(element.shadowRoot?.textContent).not.toContain("error.email_invalid");
  });

  it("splits '; '-joined violation keys into one inline error per rendered field", async () => {
    const element = await mount(host);

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
              error: "error.email_invalid; error.password_min_length",
            },
            branding: {},
          },
          { status: 400 },
        ),
      ),
    );
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );

    // Both fields are rendered, so both violations route inline to their
    // control: email via the catalog-known `error.email_invalid` key, password
    // via the localised generic fallback for `error.password_min_length`. No
    // form-level banner renders.
    const password = await waitFor(() => {
      const candidate = element.shadowRoot?.querySelector('zl-field[name="password"][invalid]');
      return candidate?.getAttribute("error") ? candidate : null;
    });
    expect(password.getAttribute("error")).toBe("Password is too short.");
    const email = element.shadowRoot?.querySelector('zl-field[name="email"][invalid]');
    expect(email?.getAttribute("error")).toBe("Please enter a valid email");
    expect(element.shadowRoot?.querySelector("zl-alert")).toBeNull();
  });

  it("surfaces an inline-routed key as a banner when the step lacks its field", async () => {
    const element = await mount(host);

    server.use(
      http.post("*/flow/*/submit", () =>
        HttpResponse.json(
          {
            id: "flow_test",
            session_token: "st_test",
            step: {
              name: "password",
              texts: { title_key: "password.title" },
              // No email field on this step — error.email_invalid has no
              // inline outlet, and formLevelError would suppress its
              // banner; the downgrade must keep it visible.
              fields: [
                {
                  name: "password",
                  type: "password",
                  text_key: "password.field.password",
                  required: true,
                },
              ],
              actions: [{ name: "submit", text_key: "submit.signin", primary: true }],
              gates: {},
              error: "error.email_invalid",
            },
            branding: {},
          },
          { status: 400 },
        ),
      ),
    );
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );

    const alert = await waitFor(() => {
      const candidate = element.shadowRoot?.querySelector("zl-alert");
      return candidate?.textContent?.includes("Please enter a valid email") ? candidate : null;
    });
    expect(alert).toBeTruthy();
    expect(element.shadowRoot?.querySelector("zl-field[invalid]")).toBeNull();
  });

  it("leaves unrecognised raw step errors verbatim in the banner", async () => {
    const element = await mount(host);

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
              ],
              actions: [{ name: "submit", text_key: "submit.signin", primary: true }],
              gates: {},
              error: "user_not_found",
            },
            branding: {},
          },
          { status: 400 },
        ),
      ),
    );
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );

    const alert = await waitFor(() => {
      const candidate = element.shadowRoot?.querySelector("zl-alert");
      return candidate?.textContent?.includes("user_not_found") ? candidate : null;
    });
    expect(alert).toBeTruthy();
  });

  /** Drives the flow into a 400 step error; resolves once `ready` probes truthy. */
  async function mountWithStepError(
    hostEl: HTMLElement,
    error: string,
    ready: (element: ZitadelLogin) => Element | null | undefined,
  ): Promise<ZitadelLogin> {
    const element = await mount(hostEl);
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
              error,
            },
            branding: {},
          },
          { status: 400 },
        ),
      ),
    );
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );
    await waitFor(() => ready(element));
    return element;
  }

  function mountWithStepErrorBanner(hostEl: HTMLElement, error: string): Promise<ZitadelLogin> {
    return mountWithStepError(hostEl, error, (element) =>
      element.shadowRoot?.querySelector("zl-alert[data-zl-step-error]"),
    );
  }

  function typeInto(element: ZitadelLogin, name: string, value: string): void {
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-input", {
        bubbles: true,
        composed: true,
        detail: { name, value },
      }),
    );
  }

  it("clears the step error banner when the user edits a field, keeping typed input", async () => {
    const element = await mountWithStepErrorBanner(host, "user_not_found");

    typeInto(element, "email", "fixed@acme.com");

    expect(element.shadowRoot?.querySelector("zl-alert[data-zl-step-error]")).toBeNull();
    // No step rebuild happened: the typed value survives further keystrokes.
    typeInto(element, "email", "fixed2@acme.com");
    expect(element.shadowRoot?.querySelector("zl-alert[data-zl-step-error]")).toBeNull();
    const emailField = element.shadowRoot?.querySelector<HTMLElement & { value?: string }>(
      'zl-field[name="email"]',
    );
    expect(emailField?.value).toBe("fixed2@acme.com");
  });

  it("clears only the edited field's inline error", async () => {
    const element = await mountWithStepError(
      host,
      // Both keys are catalog-known and field-specific → both inline,
      // no banner.
      "error.email_invalid; error.password_required",
      (el) => el.shadowRoot?.querySelector('zl-field[name="email"][invalid]'),
    );

    const password = element.shadowRoot?.querySelector<HTMLElement & { invalid?: boolean }>(
      'zl-field[name="password"]',
    );
    expect(password?.invalid).toBe(true);

    typeInto(element, "email", "fixed@acme.com");

    const email = element.shadowRoot?.querySelector<HTMLElement & { invalid?: boolean }>(
      'zl-field[name="email"]',
    );
    expect(email?.invalid).toBe(false);
    // The untouched field keeps its inline error until it is edited too.
    expect(password?.invalid).toBe(true);
  });

  it("does not resurrect a dismissed banner during the loading re-render", async () => {
    const element = await mountWithStepErrorBanner(host, "user_not_found");
    typeInto(element, "email", "fixed@acme.com");
    expect(element.shadowRoot?.querySelector("zl-alert[data-zl-step-error]")).toBeNull();

    // Park the next submit so the loading re-render is observable.
    let releaseSubmit: (() => void) | undefined;
    server.use(
      http.post(
        "*/flow/*/submit",
        () =>
          new Promise((resolve) => {
            releaseSubmit = () =>
              resolve(
                HttpResponse.json({
                  id: "flow_test",
                  session_token: "st_test",
                  step: {
                    name: "done",
                    texts: {},
                    fields: [],
                    actions: [],
                    gates: {},
                    complete: "show",
                  },
                  branding: {},
                }),
              );
          }),
      ),
    );
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );
    await waitFor(() => (Reflect.get(element, "loading") === true ? true : null));
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector("zl-alert[data-zl-step-error]")).toBeNull();
    releaseSubmit?.();
  });

  it("shows the banner again when the next response re-reports the error", async () => {
    const element = await mountWithStepErrorBanner(host, "user_not_found");
    typeInto(element, "email", "still-wrong@acme.com");
    expect(element.shadowRoot?.querySelector("zl-alert[data-zl-step-error]")).toBeNull();

    // The 400 handler from mountWithStepErrorBanner is still active: the
    // server re-reports the same error on the next submit.
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );
    await waitFor(() => element.shadowRoot?.querySelector("zl-alert[data-zl-step-error]"));
  });

  it("keeps an explicitly dismissed banner away through the next loading render", async () => {
    const element = await mountWithStepErrorBanner(host, "user_not_found");

    // The shipped templates render the design's non-dismissible alert, so the
    // close control has to be opted into here — as a tenant template opting
    // into `dismissible` would. What is under test is the orchestrator holding
    // the dismissal across the next render, not who renders the control.
    const banner = element.shadowRoot?.querySelector<ZlAlert>("zl-alert[data-zl-step-error]");
    expect(banner).toBeTruthy();
    banner?.setAttribute("dismissible", "");
    await banner?.updateComplete;
    const closeButton = banner?.shadowRoot?.querySelector<HTMLButtonElement>('[part="close"]');
    expect(closeButton).toBeTruthy();
    closeButton?.click();
    expect(element.shadowRoot?.querySelector("zl-alert[data-zl-step-error]")).toBeNull();

    let releaseSubmit: (() => void) | undefined;
    server.use(
      http.post(
        "*/flow/*/submit",
        () =>
          new Promise((resolve) => {
            releaseSubmit = () =>
              resolve(
                HttpResponse.json({
                  id: "flow_test",
                  session_token: "st_test",
                  step: {
                    name: "done",
                    texts: {},
                    fields: [],
                    actions: [],
                    gates: {},
                    complete: "show",
                  },
                  branding: {},
                }),
              );
          }),
      ),
    );
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );
    await waitFor(() => (Reflect.get(element, "loading") === true ? true : null));
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector("zl-alert[data-zl-step-error]")).toBeNull();
    releaseSubmit?.();
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
    // The identifier step declares only `email`.
    expect(submits[0]?.body.fields).toEqual({ email: "" });
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
      await waitFor(() => element.shadowRoot?.querySelector('zl-field[type="password"]'));
    }

    it("renders no visible control for the kind: back action (gesture-only)", async () => {
      const element = await mount(host);
      await navigateToRegisterPassword(element);

      // The step carries a kind: "back" action on the wire, but the template
      // renders nothing for it — the browser's back gesture is the affordance
      // (ADR 022). The kind-based exclusion also keeps it out of the generic
      // secondary-button loop.
      expect(element.shadowRoot?.querySelector('[data-action="back"]')).toBeNull();
      expect(
        element.shadowRoot?.querySelector('[data-testid="zitadel-action-back"]'),
      ).toBeNull();
    });

    it("pushes a single sentinel entry without touching the URL", async () => {
      await settleHistory();
      const pushState = vi.spyOn(history, "pushState");
      try {
        const element = await mount(host);
        await navigateToRegisterPassword(element);

        // Exactly one sentinel for the back-capable step, and no URL
        // argument — the host page's location (including any hash-router
        // fragment) stays untouched.
        const zlCalls = pushState.mock.calls.filter(
          ([state]) => (state as { zl?: boolean } | null)?.zl === true,
        );
        expect(zlCalls).toHaveLength(1);
        expect(zlCalls[0]?.[2]).toBeUndefined();
      } finally {
        pushState.mockRestore();
      }
    });

    /**
     * jsdom performs `history.back()` traversals asynchronously — a retire
     * from a previous test can deliver its `popstate` into the current
     * one. Drain the queue (including any bounce responses) before
     * installing spies so assertions only see this test's activity.
     */
    async function settleHistory(): Promise<void> {
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    it("browser back gesture submits the back action, re-arms, then retires the sentinel", async () => {
      const pushState = vi.spyOn(history, "pushState");
      const back = vi.spyOn(history, "back");
      try {
        const element = await mount(host);
        await navigateToRegisterPassword(element);
        await settleHistory();
        const zlPushesBefore = pushState.mock.calls.filter(
          ([state]) => (state as { zl?: boolean } | null)?.zl === true,
        ).length;
        const backCallsBefore = back.mock.calls.length;

        // Simulate the browser consuming the sentinel (back gesture).
        window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

        // The gesture maps to the step's back action…
        await waitFor(() => {
          const pw = element.shadowRoot?.querySelector('zl-field[type="password"]');
          return pw === null ? true : null;
        });
        const submits = mock
          .getCaptured()
          .filter(
            (req): req is Extract<CapturedRequest, { kind: "submitFlowStep" }> =>
              req.kind === "submitFlowStep",
          );
        expect(submits.find((s) => s.body.action === "back")).toBeDefined();

        // …the sentinel was re-armed before submitting…
        const zlPushesAfter = pushState.mock.calls.filter(
          ([state]) => (state as { zl?: boolean } | null)?.zl === true,
        ).length;
        expect(zlPushesAfter).toBe(zlPushesBefore + 1);

        // …and retired once the resulting step (register, no back action)
        // rendered, so the next back press leaves the widget.
        expect(back.mock.calls.length).toBe(backCallsBefore + 1);
      } finally {
        back.mockRestore();
        pushState.mockRestore();
      }
    });

    it("ignores a popstate that lands on the sentinel itself", async () => {
      const element = await mount(host);
      await navigateToRegisterPassword(element);
      await settleHistory();
      const submitsBefore = mock
        .getCaptured()
        .filter((req) => req.kind === "submitFlowStep").length;

      // The host page pushed an entry above the sentinel (e.g. an in-page
      // #anchor click) and the user backed out of it: the traversal lands
      // ON the sentinel. That is not a request to go back in the flow.
      window.dispatchEvent(new PopStateEvent("popstate", { state: { zl: true } }));

      const submitsAfter = mock
        .getCaptured()
        .filter((req) => req.kind === "submitFlowStep").length;
      expect(submitsAfter).toBe(submitsBefore);

      // The widget stays armed: a real back press still maps to the back
      // action afterwards.
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
      await waitFor(() => {
        const pw = element.shadowRoot?.querySelector('zl-field[type="password"]');
        return pw === null ? true : null;
      });
      const backSubmit = mock
        .getCaptured()
        .filter(
          (req): req is Extract<CapturedRequest, { kind: "submitFlowStep" }> =>
            req.kind === "submitFlowStep",
        )
        .find((s) => s.body.action === "back");
      expect(backSubmit).toBeDefined();
    });

    it("does not pop a host-pushed entry when retiring the sentinel", async () => {
      const element = await mount(host);
      await navigateToRegisterPassword(element);
      await settleHistory();

      // The host app pushes its own entry after the widget armed — the
      // sentinel is no longer the top entry.
      history.pushState({ host: true }, "");
      const back = vi.spyOn(history, "back");
      try {
        // Completing the step renders a step without a back action, which
        // disarms the widget. It must NOT traverse: history.back() here
        // would pop the host's entry and trigger a host navigation. The
        // sentinel leaks instead (skipped later by the popstate handler).
        type(element, PASSWORD_FIELD, "hunter2secure");
        submit(element);
        await waitFor(() => {
          const pw = element.shadowRoot?.querySelector('zl-field[type="password"]');
          return pw === null ? true : null;
        });

        expect(back).not.toHaveBeenCalled();
      } finally {
        back.mockRestore();
      }
    });

    it("back gesture on a step without a back action leaves history alone", async () => {
      await mount(host);
      await settleHistory();
      const pushState = vi.spyOn(history, "pushState");
      const back = vi.spyOn(history, "back");
      const forward = vi.spyOn(history, "forward");
      try {
        const submitsBefore = mock
          .getCaptured()
          .filter((req) => req.kind === "submitFlowStep").length;

        // Initial step is never armed — a popstate here is host-page
        // traversal and must not be intercepted or bounced.
        window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

        const submitsAfter = mock
          .getCaptured()
          .filter((req) => req.kind === "submitFlowStep").length;
        expect(submitsAfter).toBe(submitsBefore);
        expect(back).not.toHaveBeenCalled();
        expect(forward).not.toHaveBeenCalled();
        const zlCalls = pushState.mock.calls.filter(
          ([state]) => (state as { zl?: boolean } | null)?.zl === true,
        );
        expect(zlCalls).toHaveLength(0);
      } finally {
        forward.mockRestore();
        back.mockRestore();
        pushState.mockRestore();
      }
    });

    it("forward press onto a retired sentinel bounces back", async () => {
      await mount(host);
      await settleHistory();
      const back = vi.spyOn(history, "back");
      try {
        // A retired sentinel survives as a forward entry; traversing onto
        // it must bounce — the flow cannot move forward through browser
        // navigation (ADR 022 §Edge cases).
        window.dispatchEvent(new PopStateEvent("popstate", { state: { zl: true } }));

        expect(back).toHaveBeenCalledTimes(1);
      } finally {
        back.mockRestore();
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

        const popstateCalls = removeSpy.mock.calls.filter(([event]) => event === "popstate");
        expect(popstateCalls.length).toBeGreaterThanOrEqual(1);
      } finally {
        removeSpy.mockRestore();
      }
    });
  });

  it("captures <zl-select> and <zl-checkbox> values on submit", async () => {
    // A step whose only inputs are the non-text atoms. Regression: the
    // orchestrator used to read `.value` from `<zl-field>` only, so a chosen
    // select option and a ticked checkbox were submitted as empty strings.
    server.use(
      http.post("*/flow", () =>
        HttpResponse.json(
          {
            id: "flow_test",
            session_token: "st_test",
            step: {
              name: "register",
              texts: { title_key: "register.title" },
              fields: [
                {
                  name: "maritalStatus",
                  type: "select",
                  text_key: "register.field.maritalStatus",
                  required: false,
                  validation: {
                    enum: ["Single", "Married", "Divorced", "Widowed"],
                  },
                },
                {
                  name: "newsletterOptIn",
                  type: "checkbox",
                  text_key: "register.field.newsletterOptIn",
                  required: false,
                },
              ],
              actions: [{ name: "submit", text_key: "submit.register", primary: true }],
              gates: {},
            },
            branding: {},
          },
          { status: 201 },
        ),
      ),
    );

    let submittedFields: Record<string, unknown> | undefined;
    server.use(
      http.post("*/flow/*/submit", async ({ request }) => {
        const body = (await request.json()) as {
          fields: Record<string, unknown>;
        };
        submittedFields = body.fields;
        return HttpResponse.json({
          id: "flow_test",
          session_token: "st_test",
          step: {
            name: "done",
            texts: { title_key: "done.title" },
            fields: [],
            actions: [],
            gates: {},
          },
          branding: {},
        });
      }),
    );

    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.project = testProject;
    host.appendChild(element);

    const select = await waitFor(() =>
      element.shadowRoot?.querySelector<HTMLElement & { value?: string }>(
        'zl-select[name="maritalStatus"]',
      ),
    );
    const checkbox = await waitFor(() =>
      element.shadowRoot?.querySelector<HTMLElement & { checked?: boolean }>(
        'zl-checkbox[name="newsletterOptIn"]',
      ),
    );

    select.value = "Married";
    checkbox.checked = true;

    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );

    // A checkbox maps to a JSON boolean property, so a ticked box submits the
    // real boolean `true` (not the "true"/"on" value token) to satisfy the
    // server's schema-type validation on create_user.
    await waitFor(() => submittedFields ?? null);
    expect(submittedFields).toEqual({
      maritalStatus: "Married",
      newsletterOptIn: true,
    });
  });

  it("submits an unticked checkbox as boolean false", async () => {
    // An untouched optional checkbox must submit real `false`, not "" — the
    // schema validates the property as a boolean and rejects an empty string.
    server.use(
      http.post("*/flow", () =>
        HttpResponse.json(
          {
            id: "flow_test",
            session_token: "st_test",
            step: {
              name: "register",
              texts: { title_key: "register.title" },
              fields: [
                {
                  name: "newsletterOptIn",
                  type: "checkbox",
                  text_key: "register.field.newsletterOptIn",
                  required: false,
                },
              ],
              actions: [{ name: "submit", text_key: "submit.register", primary: true }],
              gates: {},
            },
            branding: {},
          },
          { status: 201 },
        ),
      ),
    );

    let submittedFields: Record<string, unknown> | undefined;
    server.use(
      http.post("*/flow/*/submit", async ({ request }) => {
        const body = (await request.json()) as {
          fields: Record<string, unknown>;
        };
        submittedFields = body.fields;
        return HttpResponse.json({
          id: "flow_test",
          session_token: "st_test",
          step: {
            name: "done",
            texts: { title_key: "done.title" },
            fields: [],
            actions: [],
            gates: {},
          },
          branding: {},
        });
      }),
    );

    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.project = testProject;
    host.appendChild(element);

    await waitFor(() =>
      element.shadowRoot?.querySelector<HTMLElement>('zl-checkbox[name="newsletterOptIn"]'),
    );

    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );

    await waitFor(() => submittedFields ?? null);
    expect(submittedFields).toEqual({ newsletterOptIn: false });
  });

  it("omits an untouched enum select instead of submitting an empty string", async () => {
    // An optional select renders a leading empty placeholder option, so an
    // untouched field holds "". "" is not a member of the enum, so sending it
    // would fail the server's enum validation (create_user: "no enum value
    // matched"). The orchestrator must omit the field entirely. A text field
    // in the same step still submits its "" default so required-checks run.
    server.use(
      http.post("*/flow", () =>
        HttpResponse.json(
          {
            id: "flow_test",
            session_token: "st_test",
            step: {
              name: "register",
              texts: { title_key: "register.title" },
              fields: [
                {
                  name: "email",
                  type: "email",
                  text_key: "register.field.email",
                  required: true,
                },
                {
                  name: "maritalStatus",
                  type: "select",
                  text_key: "register.field.maritalStatus",
                  required: false,
                  validation: {
                    enum: ["Single", "Married", "Divorced", "Widowed"],
                  },
                },
              ],
              actions: [{ name: "submit", text_key: "submit.register", primary: true }],
              gates: {},
            },
            branding: {},
          },
          { status: 201 },
        ),
      ),
    );

    let submittedFields: Record<string, string> | undefined;
    server.use(
      http.post("*/flow/*/submit", async ({ request }) => {
        const body = (await request.json()) as {
          fields: Record<string, string>;
        };
        submittedFields = body.fields;
        return HttpResponse.json({
          id: "flow_test",
          session_token: "st_test",
          step: {
            name: "done",
            texts: { title_key: "done.title" },
            fields: [],
            actions: [],
            gates: {},
          },
          branding: {},
        });
      }),
    );

    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.project = testProject;
    host.appendChild(element);

    // Wait for the select to render, then submit without choosing an option.
    await waitFor(() =>
      element.shadowRoot?.querySelector<HTMLElement>('zl-select[name="maritalStatus"]'),
    );

    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );

    await waitFor(() => submittedFields ?? null);
    expect(submittedFields).toEqual({ email: "" });
    expect(submittedFields).not.toHaveProperty("maritalStatus");
  });
});
