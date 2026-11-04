import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import type { CreateFlow201 } from "@zitadel/api/generated/model";
import {
  clearBranding,
  MOCK_AUTH_CLIENT,
  PASSWORD_FIELD,
  setupMockHandlers,
  type MockHandle,
} from "@zitadel/api-mock";
import type { LitElement } from "lit";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";

/**
 * `<zitadel-login>` on the page the server's authorization endpoint sends the
 * browser to (ADR 081 §8–§11): `?auth_request=<handle>` names the request, the
 * flow asks for consent after the sign-in, and it ends by sending the browser
 * back to the client. The shared mock binds its flow to the request it is
 * started with, as the engine does.
 */

const API_BASE = "https://flow.test.invalid";
const AUTH_REQUEST = "req_mock";

type StepDetail = { step: CreateFlow201["step"]; client?: CreateFlow201["client"] };

const server = setupServer();
const realLocation = window.location;
let mock: MockHandle = setupMockHandlers();
let element: ZitadelLogin;
let steps: StepDetail[];
let page: string;
let assign: ReturnType<typeof vi.fn>;

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  _resetConfigForTesting();
  clearBranding();
  useMock(setupMockHandlers());
  page = window.location.href;
  steps = [];
  element = document.createElement("zitadel-login");
  element.purpose = "login";
  element.project = configureZitadel({ proxyPath: API_BASE, projectId: "demo-project" });
  element.addEventListener("zitadel-flow-step", (event) => {
    steps.push((event as CustomEvent<StepDetail>).detail);
  });
});

afterEach(() => {
  element.remove();
  vi.restoreAllMocks();
  server.resetHandlers();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  history.replaceState(null, "", page);
});

function useMock(handle: MockHandle): void {
  mock = handle;
  server.resetHandlers(...mock.handlers);
}

/** Open the login page at `path`, recording navigations away from it instead of making them. */
function openAt(path: string): void {
  history.replaceState(null, "", path);
  assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...realLocation, assign },
  });
}

function root(): ShadowRoot {
  return element.shadowRoot!;
}

async function waitFor<T>(probe: () => T | null | undefined, timeout = 10_000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error("waitFor timed out");
}

/** Attach the element and wait for the flow's first step to render. */
async function mount(): Promise<void> {
  document.body.appendChild(element);
  await vi.waitFor(() => expect(steps).toHaveLength(1));
  await element.updateComplete;
}

function type(name: string, value: string): void {
  root().dispatchEvent(
    new CustomEvent("zl-input", { bubbles: true, composed: true, detail: { name, value } }),
  );
}

function submit(action = "submit"): void {
  root().dispatchEvent(
    new CustomEvent("zl-submit", { bubbles: true, composed: true, detail: { action } }),
  );
}

/** Sign in on the identifier and password steps; the flow's request then asks for consent. */
async function signIn(): Promise<void> {
  type("email", "ada@example.com");
  submit();
  await waitFor(() => root().querySelector(`zl-field[name="${PASSWORD_FIELD}"]`));
  type(PASSWORD_FIELD, "hunter2");
  submit();
  await waitFor(() => root().querySelector('[data-testid="zitadel-consent"]'));
  await element.updateComplete;
}

/** Press the rendered control for `action`, as the visitor does. */
async function press(action: string): Promise<void> {
  const button = await waitFor(() =>
    root().querySelector<LitElement>(`zl-button[action="${action}"]`),
  );
  await button.updateComplete;
  button.shadowRoot!.querySelector("button")!.click();
}

function text(selector: string): string | undefined {
  return root().querySelector(selector)?.textContent?.trim();
}

function createBodies() {
  return mock
    .getCaptured()
    .flatMap((request) => (request.kind === "createFlow" ? [request.body] : []));
}

function submittedActions(): string[] {
  return mock
    .getCaptured()
    .flatMap((request) => (request.kind === "submitFlowStep" ? [request.body.action] : []));
}

function exchanges() {
  return mock.getCaptured().filter((request) => request.kind === "exchangeHandoff");
}

/** Where the widget sent the browser, once it has. */
async function navigatedTo(): Promise<URL> {
  await vi.waitFor(() => expect(assign).toHaveBeenCalledOnce());
  return new URL(String(assign.mock.calls[0]?.[0]));
}

const requestRefused = () =>
  HttpResponse.json(
    {
      code: "flow.auth_request_invalid",
      message: "the sign-in request is not valid here; start again from the app",
    },
    { status: 400 },
  );

const AUTH_REQUEST_INVALID_EN =
  "This sign-in link expired or was opened in another browser. Go back to the app and start again.";

describe("<zitadel-login> sends the page's authorization request", () => {
  it("as auth_request_id on POST /flow", async () => {
    openAt(`/login?auth_request=${AUTH_REQUEST}`);
    await mount();

    expect(createBodies()).toEqual([expect.objectContaining({ auth_request_id: AUTH_REQUEST })]);
  });

  it("never for a page without one", async () => {
    openAt("/login?next=%2Fdashboard");
    await mount();

    expect(createBodies()).toHaveLength(1);
    expect(createBodies()[0]).not.toHaveProperty("auth_request_id");
    expect(steps[0]).not.toHaveProperty("client");
  });

  it("again when the server asks for a fresh flow", async () => {
    openAt(`/login?auth_request=${AUTH_REQUEST}`);
    await mount();
    server.use(
      http.post(
        "*/flow/:id/submit",
        () =>
          HttpResponse.json(
            { code: "flow.restart_required", message: "the flow must be restarted" },
            { status: 409 },
          ),
        { once: true },
      ),
    );

    type("email", "ada@example.com");
    submit();

    await vi.waitFor(() => expect(createBodies()).toHaveLength(2));
    expect(createBodies()[1]).toMatchObject({ auth_request_id: AUTH_REQUEST });
  });

  it("when a resume handle no longer resolves and a fresh flow starts", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    server.use(
      http.get(
        "*/flow/:id",
        () =>
          HttpResponse.json({ code: "flow.not_found", message: "flow not found" }, { status: 404 }),
        { once: true },
      ),
    );
    openAt(`/login?auth_request=${AUTH_REQUEST}&flow=flow_stale`);
    await mount();

    expect(createBodies()).toEqual([expect.objectContaining({ auth_request_id: AUTH_REQUEST })]);
    expect(steps[0]?.client).toEqual(MOCK_AUTH_CLIENT);
  });

  it("and names the client on every zitadel-flow-step, the first one included", async () => {
    openAt(`/login?auth_request=${AUTH_REQUEST}`);
    await mount();
    await signIn();

    expect(steps.map(({ step }) => step.name)).toEqual(["identifier", "password", "consent"]);
    expect(steps.map(({ client }) => client)).toEqual([
      MOCK_AUTH_CLIENT,
      MOCK_AUTH_CLIENT,
      MOCK_AUTH_CLIENT,
    ]);
  });
});

describe("<zitadel-login> on the consent step", () => {
  it("shows who asks, where it returns to, and what it may do", async () => {
    openAt(`/login?auth_request=${AUTH_REQUEST}`);
    await mount();
    await signIn();

    expect(text(".zl-card-title")).toBe("Allow access to your account?");
    expect(text(".zl-card-subtitle")).toBe("Only allow apps you trust.");
    expect(text('[data-testid="zitadel-consent-client"]')).toBe("Agent");
    expect(text('[data-testid="zitadel-consent-redirect-host"]')).toBe(
      "Returns to 127.0.0.1:53124",
    );
    expect(text(".zl-consent__lead")).toBe("If you allow it, the app can:");
    expect(
      Array.from(root().querySelectorAll('[data-testid="zitadel-consent-scopes"] li'), (li) =>
        li.textContent?.trim(),
      ),
    ).toEqual([
      "Use Zitadel API on your behalf",
      "Confirm who you are",
      "See your name and profile",
      "See your email address",
      "Keep access while you're away",
    ]);
    // The mock's client names no logo, so nothing stands in for one.
    expect(root().querySelector(".zl-consent img")).toBeNull();
    const accept = root().querySelector('zl-button[action="accept"]');
    expect(accept?.getAttribute("hierarchy")).toBe("primary");
    expect(accept?.getAttribute("label")).toBe("Allow");
    const deny = root().querySelector('zl-button[action="deny"]');
    expect(deny?.getAttribute("hierarchy")).toBe("secondary");
    expect(deny?.getAttribute("label")).toBe("Deny");
  });

  it("shows the client's logo when it names one", async () => {
    useMock(setupMockHandlers({ authClient: { logo_uri: "https://agent.example/logo.svg" } }));
    openAt(`/login?auth_request=${AUTH_REQUEST}`);
    await mount();
    await signIn();

    expect(root().querySelector(".zl-consent__client img")?.getAttribute("src")).toBe(
      "https://agent.example/logo.svg",
    );
  });

  it("says it in the visitor's language", async () => {
    element.lang = "de";
    openAt(`/login?auth_request=${AUTH_REQUEST}`);
    await mount();
    await signIn();

    expect(text(".zl-card-title")).toBe("Zugriff auf dein Konto erlauben?");
    expect(text('[data-testid="zitadel-consent-redirect-host"]')).toBe(
      "Kehrt zurück zu 127.0.0.1:53124",
    );
    expect(root().querySelector('zl-button[action="accept"]')?.getAttribute("label")).toBe(
      "Erlauben",
    );
  });

  it.each([
    ["accept", { code: "code_mock" }],
    ["deny", { error: "access_denied" }],
  ] as const)("submits %s and returns the answer to the client", async (action, answer) => {
    openAt(`/login?auth_request=${AUTH_REQUEST}`);
    await mount();
    await signIn();

    await press(action);
    const target = await navigatedTo();

    expect(submittedActions().at(-1)).toBe(action);
    expect(target.host).toBe(MOCK_AUTH_CLIENT.redirect_host);
    expect(Object.fromEntries(target.searchParams)).toMatchObject(answer);
  });

  it("is the first step when a live session already signed the user in", async () => {
    mock.setLiveSession({ email: "ada@example.com" });
    openAt(`/login?auth_request=${AUTH_REQUEST}`);
    document.body.appendChild(element);
    await waitFor(() => root().querySelector('[data-testid="zitadel-consent"]'));

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ step: { name: "consent" }, client: MOCK_AUTH_CLIENT });
    expect(text('[data-testid="zitadel-consent-client"]')).toBe("Agent");

    // The session is already here, so the answer has no handoff to exchange.
    await press("accept");
    expect((await navigatedTo()).searchParams.get("code")).toBe("code_mock");
    expect(exchanges()).toHaveLength(0);
  });
});

describe("<zitadel-login> returning to the client", () => {
  it("keeps the session here first, then leaves", async () => {
    openAt(`/login?auth_request=${AUTH_REQUEST}`);
    let exchangedBeforeLeaving = false;
    assign.mockImplementation(() => {
      exchangedBeforeLeaving = exchanges().length === 1;
    });
    await mount();
    await signIn();

    await press("accept");
    const target = await navigatedTo();

    expect(target.searchParams.get("code")).toBe("code_mock");
    expect(exchangedBeforeLeaving).toBe(true);
    expect(exchanges()[0]).toMatchObject({ projectId: "demo-project" });
    // The loader holds while the browser leaves: no second screen for one answer.
    expect(root().querySelector("zl-card")).toBeNull();
    expect(root().querySelector('slot[name="loader"]')).not.toBeNull();
  });

  it("leaves at once when the first response already answers, with no handoff", async () => {
    mock.setLiveSession({ email: "ada@example.com", consented: true });
    openAt(`/login?auth_request=${AUTH_REQUEST}`);
    document.body.appendChild(element);

    expect((await navigatedTo()).searchParams.get("code")).toBe("code_mock");
    expect(steps).toEqual([expect.objectContaining({ client: MOCK_AUTH_CLIENT })]);
    expect(steps[0]?.step.complete).toBe("redirect");
    expect(exchanges()).toHaveLength(0);
    expect(root().querySelector("zl-card")).toBeNull();
  });

  it("still leaves when keeping the session fails, and reports the failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mock.failNextExchange();
    openAt(`/login?auth_request=${AUTH_REQUEST}`);
    const errors: string[] = [];
    element.addEventListener("zitadel-flow-error", (event) => {
      errors.push((event as CustomEvent<{ message: string }>).detail.message);
    });
    await mount();
    await signIn();

    await press("accept");

    expect((await navigatedTo()).searchParams.get("code")).toBe("code_mock");
    expect(exchanges()).toHaveLength(1);
    expect(errors).toEqual(["Session exchange is temporarily unavailable."]);
  });

  it.each([true, false])(
    "goes to the client rather than post-sign-in-url or next (force-post-sign-in-url: %s)",
    async (force) => {
      openAt(`/login?auth_request=${AUTH_REQUEST}&next=%2Fdashboard`);
      element.postSignInUrl = "/admin";
      element.forcePostSignInUrl = force;
      await mount();
      await signIn();

      await press("accept");

      expect((await navigatedTo()).host).toBe(MOCK_AUTH_CLIENT.redirect_host);
    },
  );

  it("leaves a redirect without a request as it was: no exchange before it", async () => {
    openAt("/login");
    await mount();

    // Driven directly: no flow the mock starts without a request ends in a
    // redirect, since the default flow's terminal step shows a screen.
    const redirect = "https://rp.example.invalid/cb?code=abc";
    void (
      element as unknown as { applyResponse(wire: CreateFlow201): Promise<void> }
    ).applyResponse({
      id: "flow_terminal",
      session_id: "sess_mock",
      step: {
        name: "done",
        complete: "redirect",
        redirect_url: redirect,
        fields: [],
        actions: [],
        gates: {},
      },
      redirect_uri: redirect,
      handoff_token: "handoff_unbound",
    });

    expect((await navigatedTo()).toString()).toBe(redirect);
    expect(exchanges()).toHaveLength(0);
  });
});

describe("<zitadel-login> with a request the server refuses", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("explains that the link expired or belongs to another browser", async () => {
    mock.expireAuthRequest("req_expired");
    openAt("/login?auth_request=req_expired");
    const errors: string[] = [];
    element.addEventListener("zitadel-flow-error", (event) => {
      errors.push((event as CustomEvent<{ message: string }>).detail.message);
    });
    document.body.appendChild(element);

    const alert = await waitFor(() => root().querySelector("zl-alert"));
    expect(alert.textContent?.trim()).toBe(AUTH_REQUEST_INVALID_EN);
    expect(errors).toEqual([AUTH_REQUEST_INVALID_EN]);
    expect(createBodies()).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it("explains it in the visitor's language", async () => {
    mock.expireAuthRequest("req_expired");
    element.lang = "de";
    openAt("/login?auth_request=req_expired");
    document.body.appendChild(element);

    const alert = await waitFor(() => root().querySelector("zl-alert"));
    expect(alert.textContent?.trim()).toBe(
      "Dieser Anmeldelink ist abgelaufen oder wurde in einem anderen Browser geöffnet. Kehre zur App zurück und beginne erneut.",
    );
  });

  it("explains it when the request lapses during the flow", async () => {
    openAt(`/login?auth_request=${AUTH_REQUEST}`);
    await mount();
    await signIn();
    server.use(http.post("*/flow/:id/submit", requestRefused, { once: true }));

    await press("accept");

    const alert = await waitFor(() => root().querySelector("zl-alert"));
    expect(alert.textContent?.trim()).toBe(AUTH_REQUEST_INVALID_EN);
    expect(assign).not.toHaveBeenCalled();
  });
});
