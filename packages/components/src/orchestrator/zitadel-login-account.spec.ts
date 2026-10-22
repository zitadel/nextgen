import { clearBranding, setupMockHandlers, type MockHandle } from "@zitadel/api-mock";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";

/**
 * What `<zitadel-login>` shows around the step itself: the account a step
 * signs in to and the way to change it, and progress on the one control
 * that was used. Driven by the shared mock flow.
 */
const API_BASE = "https://account.test.invalid";

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

describe("<zitadel-login> around the step", () => {
  let host: HTMLDivElement;

  beforeAll(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.innerHTML = "";
  });

  describe("the account a step signs in to", () => {
    it("names it on the password step, with its avatar", async () => {
      const element = await mount(host);
      type(element, "email", "Alice@Acme.com");
      submit(element);

      const account = await waitFor(() => query(element, '[data-testid="zitadel-account"]'));
      expect(account.getAttribute("identifier")).toBe("Alice@Acme.com");
      expect(account.hasAttribute("avatar")).toBe(true);
    });

    it("changes it by going back to the step that collects it", async () => {
      const element = await mount(host);
      type(element, "email", "alice@acme.com");
      submit(element);
      const account = await waitFor(() => query(element, '[data-testid="zitadel-account"]'));
      await (account as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

      account.shadowRoot?.querySelector("a")?.click();

      await waitFor(() => query(element, 'zl-field[name="email"]'));
      expect(submittedActions()).toEqual(["submit", "back"]);
      expect(query(element, '[data-testid="zitadel-account"]')).toBeNull();
    });

    it("is not shown on a step that collects the identifier itself", async () => {
      const element = await mount(host);
      expect(query(element, '[data-testid="zitadel-account"]')).toBeNull();
    });
  });

  describe("progress", () => {
    it("shows none on the primary button when a link was used", async () => {
      const element = await mount(host);
      const link = query(element, '[data-testid="zitadel-action-register-link"]');
      expect(link).not.toBeNull();

      link?.click();
      await element.updateComplete;

      expect(element.getAttribute("aria-busy")).toBe("true");
      expect(query(element, 'zl-button[action="submit"]')?.hasAttribute("loading")).toBe(false);
    });

    it("shows on the primary button when it submitted", async () => {
      const element = await mount(host);
      type(element, "email", "alice@acme.com");

      submit(element);
      await element.updateComplete;

      expect(query(element, 'zl-button[action="submit"]')?.hasAttribute("loading")).toBe(true);
    });
  });
});
