import type { CreateFlow201 } from "@zitadel/api/generated/model";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import type { ZitadelProject } from "@zitadel/api/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";

/**
 * Real-browser checks for the orchestrator-side a11y / form-participation
 * contract. Tests that need the FACE platform live here; the unit suite
 * keeps the rendering / Liquid / sanitiser specs that work in jsdom.
 *
 * The orchestrator calls the typed `@zitadel/api` client
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
  },
};

const passkeyUpsellStep: CreateFlow201 = {
  id: "flow_1",
  session_id: "sess_1",
  session_token: "tok_2",
  step: {
    name: "passkey-upsell",
    texts: { title_key: "passkey-upsell.title" },
    fields: [],
    actions: [
      { name: "setup", text_key: "passkey-upsell.action.setup", primary: true },
      { name: "skip", text_key: "passkey-upsell.action.skip" },
    ],
    gates: {},
  },
};

async function fillSignInFields(
  root: ShadowRoot,
  email = "alice@acme.com",
  password = "hunter2",
): Promise<void> {
  const fields = root.querySelectorAll("zl-field") as NodeListOf<
    HTMLElement & { value: string; updateComplete: Promise<unknown> }
  >;
  fields[0]!.value = email;
  fields[1]!.value = password;
  await fields[0]!.updateComplete;
  await fields[1]!.updateComplete;
  root.dispatchEvent(
    new CustomEvent("zl-input", {
      bubbles: true,
      composed: true,
      detail: { name: "email", value: email },
    }),
  );
  root.dispatchEvent(
    new CustomEvent("zl-input", {
      bubbles: true,
      composed: true,
      detail: { name: "password", value: password },
    }),
  );
}

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
  let testProject: ZitadelProject;

  beforeEach(() => {
    _resetConfigForTesting();
    testProject = configureZitadel({ proxyPath: "/__nextgen", projectId: "test-project", url: "http://localhost:4000" });
    host = document.createElement("div");
    document.body.appendChild(host);
    stub = installFlowFetchStub([identifierStep, passkeyUpsellStep]);
  });

  afterEach(() => {
    host.remove();
    stub.restore();
  });

  async function mount(): Promise<ZitadelLogin> {
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.project = testProject;
    host.appendChild(element);
    await waitFor(() => {
      const root = element.shadowRoot;
      return root && root.querySelectorAll("zl-field").length === 2 ? root : null;
    });
    await waitFor(() =>
      element.getAttribute("aria-busy") === "false" ? element : null,
    );
    return element;
  }

  it("renders the step inside a real <form>", async () => {
    const element = await mount();
    const form = element.shadowRoot?.querySelector("form");
    expect(form).toBeTruthy();
    expect(form?.querySelectorAll("zl-field").length).toBe(2);
  });

  it("walks to the next step on orchestrated submit", async () => {
    const element = await mount();
    const root = element.shadowRoot!;
    await fillSignInFields(root);
    root.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );
    await waitFor(() => {
      const title = element.shadowRoot?.querySelector(".zl-card-title");
      return title?.textContent?.includes("Sign in faster") ? title : null;
    });
  });

  it("ignores a duplicate submit while the first request is in-flight", async () => {
    const element = await mount();
    const root = element.shadowRoot!;
    await fillSignInFields(root);
    const event = new CustomEvent("zl-submit", {
      bubbles: true,
      composed: true,
      detail: { action: "submit" },
    });
    root.dispatchEvent(event);
    root.dispatchEvent(event);
    await waitFor(() => {
      const title = element.shadowRoot?.querySelector(".zl-card-title");
      return title?.textContent?.includes("Sign in faster") ? title : null;
    });
    expect(stub.calls).toHaveLength(2);
  });

  it("moves focus to the first focusable control after a step swap", async () => {
    const element = await mount();
    const root = element.shadowRoot!;
    await fillSignInFields(root);
    root.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );
    await waitFor(() => {
      const title = element.shadowRoot?.querySelector(".zl-card-title");
      return title?.textContent?.includes("Sign in faster") ? title : null;
    });
    // Focus moves once the new step's markup has committed (rAF today;
    // `await this.updateComplete` after the Phase 5 refactor). Poll until it
    // lands so this pins the behaviour regardless of the scheduling mechanism.
    const primary = element.shadowRoot?.querySelector('zl-button[hierarchy="primary"]');
    expect(primary).toBeTruthy();
    await waitFor(() => (element.shadowRoot?.activeElement === primary ? primary : null));
    expect(element.shadowRoot?.activeElement).toBe(primary);
  });

  // Regression: frameworks like @lit/react attach the element first and
  // assign object properties (`branding`, `locale`) afterwards. The
  // orchestrator must defer flow-start until properties have been applied.
  it("starts the flow when project is set after attach (React-style)", async () => {
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    host.appendChild(element);
    // Property assigned after the element is in the DOM, simulating @lit/react.
    element.project = testProject;
    await waitFor(() => element.shadowRoot?.querySelectorAll("zl-field").length === 2);
    const fields = element.shadowRoot?.querySelectorAll("zl-field");
    expect(fields?.[0]?.getAttribute("name")).toBe("email");
    expect(fields?.[1]?.getAttribute("name")).toBe("password");
  });
});
