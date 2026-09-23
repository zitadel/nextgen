import {
  applySsoProviders,
  clearBranding,
  clearSsoProviders,
  setupMockHandlers,
  type MockHandle,
} from "@zitadel/api-mock";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-login.js";
import type { ZlSsoProviders } from "../atoms/zl-sso-providers.js";
import type { ZitadelLogin } from "./zitadel-login.js";

/**
 * The provider journey end to end through the orchestrator: the step offers
 * providers, choosing one submits the reserved `sso` action with the
 * connection id, and the browser is handed to the provider's authorize URL.
 *
 * Driven by the shared mock rather than bespoke handlers, so the request the
 * orchestrator actually sends is validated against the generated client.
 */
const API_BASE = "https://flow-sso.test.invalid";

const GOOGLE = { id: "idp_01GOOGLE", name: "Google", template: "google" };
const ACME = { id: "idp_01ACME", name: "Acme SSO", template: "oidc-generic" };

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
  applySsoProviders([GOOGLE, ACME]);
});

afterEach(() => {
  clearSsoProviders();
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

describe("<zitadel-login> with identity providers", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  async function mountLogin(): Promise<ZitadelLogin> {
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.project = testProject;
    host.appendChild(element);
    await waitFor(() => element.shadowRoot?.querySelector("zl-sso-providers"));
    return element;
  }

  function providerAtom(element: ZitadelLogin): ZlSsoProviders {
    return element.shadowRoot?.querySelector("zl-sso-providers") as ZlSsoProviders;
  }

  /** Stub navigation for the duration of `run`, returning the calls made. */
  async function withStubbedNavigation(run: () => Promise<void>): Promise<string[]> {
    const assign = vi.fn();
    const { location } = window;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...location, assign },
    });
    try {
      await run();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: location });
    }
    return assign.mock.calls.map((call) => String(call[0]));
  }

  it("renders a button for every provider the step offers", async () => {
    const element = await mountLogin();
    const atom = providerAtom(element);
    await atom.updateComplete;

    const labels = Array.from(atom.shadowRoot?.querySelectorAll("zl-button") ?? []).map((b) =>
      b.getAttribute("label"),
    );
    expect(labels).toEqual(["Continue with Google", "Continue with Acme SSO"]);
  });

  it("submits the reserved sso action with the chosen connection id", async () => {
    const element = await mountLogin();
    const atom = providerAtom(element);
    await atom.updateComplete;

    await withStubbedNavigation(async () => {
      atom.shadowRoot?.querySelectorAll("zl-button")[0]?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true }),
      );
      await waitFor(() =>
        mock.getCaptured().some((entry) => entry.kind === "submitFlowStep") ? true : null,
      );
    });

    const submits = mock
      .getCaptured()
      .filter((entry): entry is Extract<typeof entry, { kind: "submitFlowStep" }> =>
        entry.kind === "submitFlowStep",
      );
    expect(submits).toHaveLength(1);
    expect(submits[0]?.body.action).toBe("sso");
    expect(submits[0]?.body.sso_provider_id).toBe(GOOGLE.id);
  });

  it("hands the browser to the provider's authorize URL", async () => {
    const element = await mountLogin();
    const atom = providerAtom(element);
    await atom.updateComplete;

    const navigations = await withStubbedNavigation(async () => {
      atom.shadowRoot?.querySelectorAll("zl-button")[0]?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    expect(navigations).toEqual(["https://idp.mock.invalid/authorize"]);
  });

  it("emits zitadel-flow-redirect rather than flow-complete on the way out", async () => {
    // A host listening for completion must not treat leaving for the provider
    // as a finished sign-in: the flow resumes at the callback.
    const element = await mountLogin();
    const atom = providerAtom(element);
    await atom.updateComplete;
    const redirects: CustomEvent[] = [];
    const completes: CustomEvent[] = [];
    element.addEventListener("zitadel-flow-redirect", (e) => redirects.push(e as CustomEvent));
    element.addEventListener("zitadel-flow-complete", (e) => completes.push(e as CustomEvent));

    await withStubbedNavigation(async () => {
      atom.shadowRoot?.querySelectorAll("zl-button")[0]?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true }),
      );
      await waitFor(() => (redirects.length > 0 ? redirects : null));
    });

    expect(redirects[0]?.detail.redirect_url).toBe("https://idp.mock.invalid/authorize");
    expect(completes).toHaveLength(0);
  });

  it("does not paint the redirect step it is navigating away from", async () => {
    const element = await mountLogin();
    const atom = providerAtom(element);
    await atom.updateComplete;

    await withStubbedNavigation(async () => {
      atom.shadowRoot?.querySelectorAll("zl-button")[0]?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    expect(element.shadowRoot?.querySelector('slot[name="loader"]')).not.toBeNull();
  });

  it("offers no providers when the project has enabled none", async () => {
    clearSsoProviders();
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.project = testProject;
    host.appendChild(element);
    await waitFor(() => element.shadowRoot?.querySelector("zl-field"));

    expect(element.shadowRoot?.querySelector("zl-sso-providers")).toBeNull();
  });
});
