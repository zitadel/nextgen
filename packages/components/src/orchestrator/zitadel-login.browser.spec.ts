import type { CreateFlow201 } from "@zitadel-nextgen/api/generated/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";

/**
 * Real-browser checks for the orchestrator-side a11y / form-participation
 * contract. Tests that need the FACE platform live here; the unit suite
 * keeps the rendering / Liquid / sanitiser specs that work in jsdom.
 *
 * The orchestrator calls the typed `@zitadel-nextgen/api` client
 * directly. This suite swaps `globalThis.fetch` for a queue of pre-baked
 * `CreateFlow201` payloads — equivalent to swapping the previous
 * `transport` property, one level lower in the stack. Fetch is stubbed
 * (rather than running `msw/browser`) because vitest's browser provider
 * has no out-of-the-box service-worker registration; the unit suite
 * covers the MSW-handler-driven contract.
 */

const identifierStep: CreateFlow201 = {
  id: "flow_1",
  session_id: "sess_1",
  session_token: "tok_1",
  step: {
    name: "identifier",
    texts: { title_key: "identifier.title" },
    fields: {
      email: {
        type: "email",
        text_key: "identifier.field.email",
        required: true,
      },
    },
    actions: { submit: { text_key: "submit.continue", primary: true } },
    gates: {},
  },
};

const passwordStep: CreateFlow201 = {
  id: "flow_1",
  session_id: "sess_1",
  session_token: "tok_2",
  step: {
    name: "password",
    texts: { title_key: "password.title" },
    fields: {
      password: {
        type: "password",
        text_key: "password.field.password",
        required: true,
      },
    },
    actions: { submit: { text_key: "submit.signin", primary: true } },
    gates: {},
  },
};

async function waitFor<T>(probe: () => T | null | undefined, timeout = 1500): Promise<T> {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error("waitFor timed out");
}

/**
 * Stubs `globalThis.fetch` to return a queue of pre-built `CreateFlow201`
 * JSON bodies. Each network call (regardless of URL) drains one entry from
 * the queue; the last entry is replayed if the queue is exhausted, matching
 * how the WalkingFixtureTransport used to behave.
 */
function installFlowFetchStub(responses: readonly CreateFlow201[]): {
  calls: { url: string; init: RequestInit | undefined }[];
  restore: () => void;
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let cursor = 0;
  const fetchStub = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      const next = responses[Math.min(cursor, responses.length - 1)];
      cursor += 1;
      return new Response(JSON.stringify(next), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  );
  const original = globalThis.fetch;
  globalThis.fetch = fetchStub as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe("<zitadel-login> form + focus (chromium)", () => {
  let host: HTMLDivElement;
  let stub: ReturnType<typeof installFlowFetchStub>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    stub = installFlowFetchStub([identifierStep, passwordStep]);
  });

  afterEach(() => {
    host.remove();
    stub.restore();
  });

  async function mount(): Promise<ZitadelLogin> {
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.projectId = "test-project";
    host.appendChild(element);
    await waitFor(() => element.shadowRoot?.querySelector("zl-field"));
    return element;
  }

  it("renders the step inside a real <form>", async () => {
    const element = await mount();
    const form = element.shadowRoot?.querySelector("form");
    expect(form).toBeTruthy();
    expect(form?.querySelector("zl-field")).toBeTruthy();
  });

  it("intercepts native submit and walks to the next step", async () => {
    const element = await mount();
    const shadowRoot = element.shadowRoot;
    if (!shadowRoot) throw new Error("expected element to have a shadow root");
    const field = shadowRoot.querySelector("zl-field") as HTMLElement & {
      value: string;
      updateComplete: Promise<unknown>;
    };
    field.value = "alice@acme.com";
    await field.updateComplete;
    const form = shadowRoot.querySelector("form") as HTMLFormElement;
    form.requestSubmit();
    await waitFor(() => {
      const next = element.shadowRoot?.querySelector("zl-field");
      return next?.getAttribute("name") === "password" ? next : null;
    });
    const passwordField = element.shadowRoot?.querySelector("zl-field");
    expect(passwordField?.getAttribute("name")).toBe("password");
  });

  it("moves focus to the first field after a step swap", async () => {
    const element = await mount();
    const shadowRoot = element.shadowRoot;
    if (!shadowRoot) throw new Error("expected element to have a shadow root");
    const field = shadowRoot.querySelector("zl-field") as HTMLElement & {
      value: string;
      updateComplete: Promise<unknown>;
    };
    field.value = "alice@acme.com";
    await field.updateComplete;
    const form = shadowRoot.querySelector("form") as HTMLFormElement;
    form.requestSubmit();
    await waitFor(() => {
      const next = element.shadowRoot?.querySelector("zl-field");
      return next?.getAttribute("name") === "password" ? next : null;
    });
    // Allow the rAF in moveFocusToFirstField to fire.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const passwordField = element.shadowRoot?.querySelector("zl-field") as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const innerInput = passwordField.shadowRoot?.querySelector("input");
    expect(passwordField.shadowRoot?.activeElement).toBe(innerInput);
  });

  // Regression: frameworks like @lit/react attach the element first and
  // assign object properties (`branding`, `locale`) afterwards. The
  // orchestrator must defer flow-start until properties have been applied.
  it("starts the flow when projectId is set after attach (React-style)", async () => {
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    host.appendChild(element);
    // Property assigned after the element is in the DOM, simulating @lit/react.
    element.projectId = "test-project";
    await waitFor(() => element.shadowRoot?.querySelector("zl-field"));
    const field = element.shadowRoot?.querySelector("zl-field");
    expect(field?.getAttribute("name")).toBe("email");
  });
});
