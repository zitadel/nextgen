/**
 * jsdom-friendly integration tests for `<zitadel-login>`. Network calls go
 * through the typed `@zitadel-nextgen/api` fetch client; we intercept them
 * with `msw/node` driven by the shared xstate flow walker in
 * `@zitadel-nextgen/api-mock`.
 *
 * Behaviour that needs the FACE platform (form participation, focus
 * delegation, real Enter-to-submit) lives in
 * `zitadel-login.browser.spec.ts` because jsdom 29 only ships a partial
 * `ElementInternals` implementation.
 */
import { setApiBaseUrl } from "@zitadel-nextgen/api/runtime/base-url";
import {
  applyBranding,
  clearBranding,
  setupMockHandlers,
  type CapturedRequest,
  type MockHandle,
} from "@zitadel-nextgen/api-mock";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";

const API_BASE = "https://flow.test.invalid";

let mock: MockHandle = setupMockHandlers();
const server = setupServer(...mock.handlers);

beforeAll(() => {
  setApiBaseUrl(API_BASE);
  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(() => {
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

async function mount(host: HTMLElement): Promise<ZitadelLogin> {
  const element = document.createElement("zitadel-login") as ZitadelLogin;
  element.purpose = "login";
  element.projectId = "demo-project";
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
    expect(fields.length).toBe(1);
    expect(fields[0]?.getAttribute("name")).toBe("email");
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
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );

    await waitFor(() => {
      const next = element.shadowRoot?.querySelector("zl-field");
      return next?.getAttribute("name") === "password" ? next : null;
    });

    const submits = mock.getCaptured().filter(
      (req): req is Extract<CapturedRequest, { kind: "submitFlowStep" }> =>
        req.kind === "submitFlowStep",
    );
    expect(submits).toHaveLength(1);
    expect(submits[0]?.body).toMatchObject({
      action: "submit",
      fields: { email: "alice@acme.com" },
    });
    expect(typeof submits[0]?.body.session_token).toBe("string");
  });

  it("emits zitadel-flow-complete when the step ends with `complete: show`", async () => {
    const element = await mount(host);
    const completeEvents: CustomEvent[] = [];
    element.addEventListener("zitadel-flow-complete", (event) =>
      completeEvents.push(event as CustomEvent),
    );

    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );
    await waitFor(() => {
      const next = element.shadowRoot?.querySelector("zl-field");
      return next?.getAttribute("name") === "password" ? next : null;
    });
    element.shadowRoot?.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );
    await waitFor(() => (completeEvents.length > 0 ? completeEvents : null));
    // The mock returns complete: "show" so the app (not the component) drives
    // navigation after exchanging the handoff_token for a session cookie.
    expect(completeEvents[0]?.detail).toEqual(
      expect.objectContaining({ behavior: "show" }),
    );
    expect(completeEvents[0]?.detail.handoff_token).toBeTruthy();
  });

  it("surfaces network errors via zitadel-flow-error", async () => {
    server.resetHandlers(
      http.post(
        "*/flow",
        () => HttpResponse.error(),
        { once: true },
      ),
    );

    const errorEvents: CustomEvent[] = [];
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.projectId = "demo-project";
    element.addEventListener("zitadel-flow-error", (event) =>
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
});
