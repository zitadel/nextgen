import { clearBranding, setupMockHandlers, type MockHandle } from "@zitadel/api-mock";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";

/**
 * The card `<zitadel-login>` shows a visitor the page's session already signs
 * in. Driven by the shared mock flow, with overrides for the session
 * endpoints, which the mock answers as signed out.
 */
const API_BASE = "https://signed-in.test.invalid";

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

function query(element: ZitadelLogin, selector: string): HTMLElement | null {
  return element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
}

function attach(host: HTMLElement, configure?: (element: ZitadelLogin) => void): ZitadelLogin {
  const element = document.createElement("zitadel-login") as ZitadelLogin;
  element.purpose = "login";
  element.project = testProject;
  configure?.(element);
  host.appendChild(element);
  return element;
}

async function mount(host: HTMLElement): Promise<ZitadelLogin> {
  const element = attach(host);
  await waitFor(() => query(element, 'zl-field[name="email"]'));
  return element;
}

/** The submit actions the element sent, in order. */
function submittedActions(): string[] {
  return mock
    .getCaptured()
    .flatMap((request) => (request.kind === "submitFlowStep" ? [request.body.action] : []));
}

describe("<zitadel-login> for a signed-in visitor", () => {
  let host: HTMLDivElement;

  beforeAll(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.innerHTML = "";
  });

  describe("a visitor the page's session already signs in", () => {
    const signedIn = () =>
      http.get("*/sessions/me", () =>
        HttpResponse.json({
          session_id: "sess_test",
          project_id: "demo-project",
          state: "active",
          user_id: "user_alice",
          user: {
            user_id: "user_alice",
            identifier: "alice@acme.com",
            identifier_property: "email",
          },
          factors: [],
          assurance_levels: [],
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      );

    it("is offered to continue as that account instead of a second sign-in", async () => {
      server.use(signedIn());
      const element = attach(host, (el) => {
        el.postSignInUrl = "/profile";
      });

      const account = await waitFor(() =>
        query(element, '[data-testid="zitadel-signed-in-account"]'),
      );
      expect(account.textContent).toBe("alice@acme.com");
      expect(query(element, "zl-field")).toBeNull();
      expect(query(element, '[part="attribution"]')).not.toBeNull();
    });

    it("continues to where a sign-in would have gone", async () => {
      server.use(signedIn());
      const assign = vi.fn();
      const { location } = window;
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...location, assign },
      });
      try {
        const element = attach(host, (el) => {
          el.postSignInUrl = "/profile";
        });
        const next = await waitFor(() =>
          query(element, '[data-testid="zitadel-signed-in-continue"]'),
        );
        next.dispatchEvent(new CustomEvent("zl-submit", { bubbles: true, composed: true }));

        expect(assign).toHaveBeenCalledWith("/profile");
        expect(submittedActions()).toEqual([]);
      } finally {
        Object.defineProperty(window, "location", { configurable: true, value: location });
      }
    });

    it("signs out and shows the form of a fresh flow", async () => {
      const revoked: string[] = [];
      server.use(
        signedIn(),
        http.get("*/sessions/me/csrf", () => HttpResponse.json({ csrf_token: "csrf_test" })),
        http.delete("*/sessions/me", ({ request }) => {
          revoked.push(request.headers.get("x-zitadel-csrf") ?? "");
          return new HttpResponse(null, { status: 204 });
        }),
      );
      const element = attach(host, (el) => {
        el.postSignInUrl = "/profile";
      });
      const signOut = await waitFor(() =>
        query(element, '[data-testid="zitadel-signed-in-sign-out"]'),
      );

      signOut.dispatchEvent(new CustomEvent("zl-submit", { bubbles: true, composed: true }));

      await waitFor(() => query(element, 'zl-field[name="email"]'));
      expect(revoked).toEqual(["csrf_test"]);
      const starts = mock.getCaptured().filter((request) => request.kind === "createFlow");
      expect(starts).toHaveLength(2);
      expect(submittedActions()).toEqual([]);
    });

    it("is not looked for without a post-sign-in-url to continue to", async () => {
      const seen: string[] = [];
      const record = ({ request }: { request: Request }) => {
        seen.push(`${request.method} ${new URL(request.url).pathname}`);
      };
      server.use(signedIn());
      server.events.on("request:start", record);
      try {
        const element = await mount(host);
        expect(query(element, '[data-testid="zitadel-signed-in-account"]')).toBeNull();
      } finally {
        server.events.removeListener("request:start", record);
      }
      expect(seen).not.toContain("GET /sessions/me");
    });

    it("shows the form when nobody is signed in", async () => {
      const element = attach(host, (el) => {
        el.postSignInUrl = "/profile";
      });
      await waitFor(() => query(element, 'zl-field[name="email"]'));
      expect(query(element, '[data-testid="zitadel-signed-in-account"]')).toBeNull();
    });
  });
});
