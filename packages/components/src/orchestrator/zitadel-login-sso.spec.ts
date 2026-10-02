import {
  applySsoProviders,
  clearBranding,
  clearSsoProviders,
  setupMockHandlers,
  type MockHandle,
} from "@zitadel/api-mock";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import { http, HttpResponse } from "msw";
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

const GOOGLE = { id: "google", name: "Google", template: "google" };
const ACME = { id: "acme-sso", name: "Acme SSO", template: "oidc-generic" };

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

    // Slotted, not the button's `label` attribute — see the atom.
    const labels = Array.from(atom.shadowRoot?.querySelectorAll("zl-button") ?? []).map((b) =>
      b.textContent?.trim(),
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

  it("sends the page URL with this flow's id as the return target", async () => {
    const { href } = window.location;
    window.history.replaceState(null, "", "/login?tab=sso#top");
    try {
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

      const submit = mock
        .getCaptured()
        .find((entry): entry is Extract<typeof entry, { kind: "submitFlowStep" }> =>
          entry.kind === "submitFlowStep",
        );
      const target = new URL(submit?.body.return_target ?? "");
      expect(target.searchParams.get("flow")).toBe(submit?.flowId);
      expect(target.origin + target.pathname).toBe(`${window.location.origin}/login`);
      expect(target.searchParams.get("tab")).toBe("sso");
      expect(target.hash).toBe("#top");
    } finally {
      window.history.replaceState(null, "", href);
    }
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

  it("still completes a terminal redirect rather than treating it as a provider hop", async () => {
    // The engine copies the relying party's redirect_uri onto `redirect_url`
    // when a sign-in completes, so a terminal step carries the same field a
    // provider hop does. Reading only that field made every OIDC/SAML
    // sign-in emit flow-redirect and stop calling the host back.
    clearSsoProviders();
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.project = testProject;
    host.appendChild(element);
    await waitFor(() => element.shadowRoot?.querySelector("zl-field"));

    const completes: CustomEvent[] = [];
    const redirects: CustomEvent[] = [];
    element.addEventListener("zitadel-flow-complete", (e) => completes.push(e as CustomEvent));
    element.addEventListener("zitadel-flow-redirect", (e) => redirects.push(e as CustomEvent));

    await withStubbedNavigation(async () => {
      // Drive applyResponse directly: the shared mock has no fixture pairing
      // a terminal step with a redirect_url, which is why this escaped.
      (element as unknown as { applyResponse(wire: unknown): void }).applyResponse({
        id: "flow_terminal",
        session_id: "sess",
        session_token: "tok",
        step: {
          name: "done",
          complete: "redirect",
          redirect_url: "https://rp.example.invalid/cb?code=abc",
          fields: [],
          actions: [],
          gates: {},
        },
        redirect_uri: "https://rp.example.invalid/cb?code=abc",
      });
      await waitFor(() => (completes.length > 0 ? completes : null));
    });

    expect(completes).toHaveLength(1);
    expect(completes[0]?.detail.behavior).toBe("redirect");
    expect(redirects).toHaveLength(0);
  });


  it("resumes the flow a provider callback left in the URL", async () => {
    // The callback finishes by navigating the browser back with `?flow=<id>`.
    // It is a fresh page load, so nothing of the previous document survives:
    // a widget that ignores the parameter starts a new flow, and the user
    // lands on a blank sign-in screen having just signed in.
    const seen: string[] = [];
    const record = ({ request }: { request: Request }) => {
      seen.push(`${request.method} ${new URL(request.url).pathname}`);
    };
    server.events.on("request:start", record);
    const original = window.location.href;
    window.history.replaceState({}, "", "/login?flow=flow_mock");

    try {
      const element = document.createElement("zitadel-login") as ZitadelLogin;
      element.purpose = "login";
      element.project = testProject;
      host.appendChild(element);
      await waitFor(() => element.shadowRoot?.querySelector("zl-field"));
    } finally {
      window.history.replaceState({}, "", original);
      server.events.removeListener("request:start", record);
    }

    expect(seen).toContain("GET /flow/flow_mock");
    expect(seen).not.toContain("POST /flow");
  });

  describe("when the server answers flow.restart_required", () => {
    const restartRequired = () =>
      HttpResponse.json(
        { code: "flow.restart_required", message: "the flow must be restarted" },
        { status: 409 },
      );

    async function resumeStale(): Promise<{ element: ZitadelLogin; seen: string[]; url: string }> {
      const seen: string[] = [];
      const record = ({ request }: { request: Request }) => {
        seen.push(`${request.method} ${new URL(request.url).pathname}`);
      };
      server.events.on("request:start", record);
      const original = window.location.href;
      window.history.replaceState({}, "", "/login?keep=1&flow=flow_stale#top");
      const element = document.createElement("zitadel-login") as ZitadelLogin;
      let url = "";
      try {
        element.purpose = "login";
        element.project = testProject;
        host.appendChild(element);
        await waitFor(() => element.shadowRoot?.querySelector("zl-field, zl-alert"));
        await element.updateComplete;
        url = window.location.search + window.location.hash;
      } finally {
        window.history.replaceState({}, "", original);
        server.events.removeListener("request:start", record);
      }
      return { element, seen, url };
    }

    it("starts a fresh flow and tells the user why", async () => {
      server.use(http.get("*/flow/:id", restartRequired, { once: true }));

      const { element, seen, url } = await resumeStale();
      await waitFor(() => element.shadowRoot?.querySelector("zl-field"));

      expect(seen.filter((r) => r === "POST /flow")).toHaveLength(1);
      // A reload must not resume the refused flow again.
      expect(url).toBe("?keep=1#top");
      expect(element.shadowRoot?.textContent).toContain(
        "Your sign-in could not be continued. Please start again.",
      );
    });

    it("restarts only once when the fresh flow is refused too", async () => {
      server.use(
        http.get("*/flow/:id", restartRequired),
        http.post("*/flow", restartRequired),
      );

      const { element, seen } = await resumeStale();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(seen.filter((r) => r === "POST /flow")).toHaveLength(1);
      expect(element.shadowRoot?.querySelector("zl-alert")).not.toBeNull();
    });

    it("does not carry typed values into the replacement flow", async () => {
      const element = await mountLogin();
      await waitFor(() => element.shadowRoot?.querySelector("zl-field"));
      const submitted: Array<Record<string, unknown>> = [];
      const record = async ({ request }: { request: Request }) => {
        if (request.method === "POST" && new URL(request.url).pathname.endsWith("/submit")) {
          const body = (await request.clone().json()) as { fields?: Record<string, unknown> };
          submitted.push(body.fields ?? {});
        }
      };
      server.events.on("request:start", record);
      try {
        // The typed value is refused together with its flow.
        server.use(http.post("*/flow/:id/submit", restartRequired, { once: true }));
        element.shadowRoot?.dispatchEvent(
          new CustomEvent("zl-input", {
            bubbles: true,
            composed: true,
            detail: { name: "email", value: "typed@example.test" },
          }),
        );
        element.shadowRoot?.dispatchEvent(
          new CustomEvent("zl-submit", { bubbles: true, composed: true, detail: { action: "submit" } }),
        );
        await waitFor(() =>
          element.shadowRoot?.textContent?.includes("Your sign-in could not be continued") ? true : null,
        );
        await element.updateComplete;

        element.shadowRoot?.dispatchEvent(
          new CustomEvent("zl-submit", { bubbles: true, composed: true, detail: { action: "submit" } }),
        );
        await waitFor(() => (submitted.length >= 2 ? true : null));
      } finally {
        server.events.removeListener("request:start", record);
      }

      expect(submitted[0]?.email).toBe("typed@example.test");
      expect(submitted[1]?.email).not.toBe("typed@example.test");
    });
  });

  const notFound = { code: "flow.not_found", message: "flow not found" };
  // What the server answers when the required cookie is absent: the
  // parameter decoder refuses the request before the handler runs.
  const missingCookie = {
    code: "req.invalid",
    message: "The request is invalid and fails base validation.",
    details: { details: { fields: ["_zflow"] } },
  };

  it.each([
    { source: "the URL", status: 400, body: missingCookie, mount: (el: ZitadelLogin) => el },
    { source: "the URL", status: 404, body: notFound, mount: (el: ZitadelLogin) => el },
    { source: "the URL", status: 410, body: notFound, mount: (el: ZitadelLogin) => el },
    {
      source: "resume-flow-id",
      status: 404,
      body: notFound,
      mount: (el: ZitadelLogin) => {
        el.resumeFlowId = "flow_stale";
        return el;
      },
    },
  ])("starts over when the flow from $source answers $status", async ({ source, status, body, mount }) => {
    // The cookie window can close during the external sign-in, and a flow
    // can finish in another tab. The handle then names nothing, and a page
    // stuck on a startup error has no way forward.
    const seen: string[] = [];
    const record = ({ request }: { request: Request }) => {
      seen.push(`${request.method} ${new URL(request.url).pathname}`);
    };
    server.events.on("request:start", record);
    server.use(http.get("*/flow/:id", () => HttpResponse.json(body, { status })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const original = window.location.href;
    if (source === "the URL") window.history.replaceState({}, "", "/login?flow=flow_stale");

    let warned: string[];
    try {
      const element = mount(document.createElement("zitadel-login") as ZitadelLogin);
      element.purpose = "login";
      element.project = testProject;
      host.appendChild(element);
      await waitFor(() => element.shadowRoot?.querySelector("zl-field"));
    } finally {
      window.history.replaceState({}, "", original);
      server.events.removeListener("request:start", record);
      warned = warn.mock.calls.map((call) => String(call[0]));
      warn.mockRestore();
    }

    expect(seen).toContain("GET /flow/flow_stale");
    expect(seen).toContain("POST /flow");
    expect(warned).toEqual([expect.stringContaining("flow_stale")]);
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
