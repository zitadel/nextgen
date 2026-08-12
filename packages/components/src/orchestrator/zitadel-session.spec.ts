import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";

import "./zitadel-session.js";
import type { ZitadelSession } from "./zitadel-session.js";

/**
 * jsdom-friendly behaviour for `<zitadel-session>`. Identity is fetched from
 * `GET /sessions/me`; the Logout wiring, the revoke call, and emitted events
 * are covered here.
 */
const API_BASE = "https://session.test.invalid";
const deleteLog: { url: string; method: string; credentials: string }[] = [];

function sessionBody(email: string, userId: string) {
  const body: Record<string, unknown> = {
    session_id: "sess_test",
    project_id: "test",
    state: "active",
    user_id: userId,
    factors: [],
    assurance_levels: [],
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  };
  if (email) body.email = email;
  return body;
}

let currentEmail = "alice@acme.com";
let currentUserId = "user_test";
let sessionStatus = 200;

const getHandler = http.get(`${API_BASE}/sessions/me`, () => {
  if (sessionStatus !== 200) {
    return new HttpResponse(null, { status: sessionStatus });
  }
  return HttpResponse.json(sessionBody(currentEmail, currentUserId));
});

const deleteHandler = http.delete(`${API_BASE}/sessions/me`, ({ request }) => {
  deleteLog.push({
    url: request.url,
    method: request.method,
    credentials: request.credentials,
  });
  return new HttpResponse(null, { status: 204 });
});

const server = setupServer(getHandler, deleteHandler);

beforeAll(() => {
  configureZitadel({ proxyPath: API_BASE, projectId: "test" });
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  deleteLog.length = 0;
  currentEmail = "alice@acme.com";
  currentUserId = "user_test";
  sessionStatus = 200;
  server.resetHandlers(getHandler, deleteHandler);
});

afterAll(() => {
  server.close();
});

function shadowQuery<T extends Element>(host: Element, selector: string): T {
  const root = host.shadowRoot;
  if (!root) throw new Error(`shadowQuery: ${host.tagName} has no shadow root`);
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`shadowQuery: no element matched ${selector}`);
  return found;
}

/** Fires the atom-level `zl-submit` event a real `<zl-button>` click emits. */
function activate(button: Element): void {
  button.dispatchEvent(new CustomEvent("zl-submit", { bubbles: true, composed: true }));
}

/** Replaces `window.location` with a stub recording `assign()` calls. */
function stubLocation(): { current: string } {
  const record = { current: "" };
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign: (url: string) => (record.current = url) },
    writable: true,
  });
  return record;
}

async function flush(element: ZitadelSession): Promise<void> {
  await element.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 16));
  await element.updateComplete;
}

describe("<zitadel-session>", () => {
  let host: HTMLDivElement;

  beforeAll(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.innerHTML = "";
  });

  function mount(markup = "<zitadel-session></zitadel-session>"): ZitadelSession {
    host.innerHTML = markup;
    return host.querySelector("zitadel-session") as ZitadelSession;
  }

  it("renders the heading and the email fetched from GET /sessions/me", async () => {
    currentEmail = "alice@acme.com";
    const element = mount();
    await flush(element);
    expect(shadowQuery<HTMLElement>(element, ".title").textContent?.trim()).toBe("Signed in as");
    expect(shadowQuery<HTMLElement>(element, ".identity").textContent?.trim()).toBe("alice@acme.com");
  });

  it("falls back to user_id when the session response has no email", async () => {
    currentEmail = "";
    currentUserId = "user_01ABC";
    const element = mount();
    await flush(element);
    expect(shadowQuery<HTMLElement>(element, ".identity").textContent?.trim()).toBe("user_01ABC");
  });

  it("omits the identity line when the session request is unauthenticated", async () => {
    sessionStatus = 401;
    const element = mount();
    await flush(element);
    expect(element.shadowRoot?.querySelector(".identity")).toBeNull();
  });

  it("suppress-header visually hides the heading but keeps it accessible", async () => {
    currentEmail = "alice@acme.com";
    const element = mount('<zitadel-session suppress-header></zitadel-session>');
    await flush(element);
    // Boolean attribute reflects into the property (and back — reflect
    // keeps DOM assertions honest under React 19's property-first binding).
    expect(element.suppressHeader).toBe(true);
    expect(element.hasAttribute("suppress-header")).toBe(true);
    const title = shadowQuery<HTMLElement>(element, ".title");
    // sr-only, not removed: the card keeps its accessible name.
    expect(title.classList.contains("sr-only")).toBe(true);
    expect(title.textContent?.trim()).toBe("Signed in as");
    // The identity line is content, not header — it stays visible.
    expect(shadowQuery<HTMLElement>(element, ".identity").classList.contains("sr-only")).toBe(false);
  });

  it("renders the heading normally without suppress-header", async () => {
    currentEmail = "alice@acme.com";
    const element = mount();
    await flush(element);
    expect(element.suppressHeader).toBe(false);
    expect(
      shadowQuery<HTMLElement>(element, ".title").classList.contains("sr-only"),
    ).toBe(false);
  });

  it("renders a single primary Sign out action", async () => {
    const element = mount();
    await flush(element);
    const out = shadowQuery<HTMLElement>(element, 'zl-button[data-testid="zitadel-session-logout"]');
    expect(out.getAttribute("hierarchy")).toBe("primary");
    expect(
      element.shadowRoot?.querySelector('zl-button[data-testid="zitadel-session-continue"]'),
    ).toBeNull();
  });

  it("calls DELETE /sessions/me with credentials and fires zitadel-signout on Sign out", async () => {
    const element = mount();
    await flush(element);

    const events: CustomEvent[] = [];
    element.addEventListener("zitadel-signout", (e) => events.push(e as CustomEvent));

    activate(shadowQuery(element, 'zl-button[data-testid="zitadel-session-logout"]'));
    await new Promise((resolve) => setTimeout(resolve, 16));
    await element.updateComplete;

    expect(deleteLog).toHaveLength(1);
    expect(deleteLog[0]?.method).toBe("DELETE");
    expect(deleteLog[0]?.url).toBe(`${API_BASE}/sessions/me`);
    expect(deleteLog[0]?.credentials).toBe("include");
    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toEqual({ name: "", email: "alice@acme.com" });
  });

  it("navigates to post-sign-out-url after a successful revoke", async () => {
    const loc = stubLocation();
    const element = mount();
    element.postSignOutUrl = "https://app.test/login";
    await flush(element);

    activate(shadowQuery(element, 'zl-button[data-testid="zitadel-session-logout"]'));
    await new Promise((resolve) => setTimeout(resolve, 32));

    expect(deleteLog).toHaveLength(1);
    expect(loc.current).toBe("https://app.test/login");
  });

  it("signs out using project-id / proxy-path attributes with no global config", async () => {
    _resetConfigForTesting();
    try {
      const element = mount(
        `<zitadel-session project-id="test" proxy-path="${API_BASE}"></zitadel-session>`,
      );
      await flush(element);
      activate(shadowQuery(element, 'zl-button[data-testid="zitadel-session-logout"]'));
      await new Promise((resolve) => setTimeout(resolve, 32));

      expect(deleteLog).toHaveLength(1);
      expect(deleteLog[0]?.url).toBe(`${API_BASE}/sessions/me`);
      expect(deleteLog[0]?.credentials).toBe("include");
    } finally {
      configureZitadel({ proxyPath: API_BASE, projectId: "test" });
    }
  });

  it("surfaces a network error inline without redirecting", async () => {
    const loc = stubLocation();
    const element = mount();
    element.postSignOutUrl = "https://app.test/login";
    await flush(element);
    server.use(http.delete(`${API_BASE}/sessions/me`, () => HttpResponse.error()));

    activate(shadowQuery(element, 'zl-button[data-testid="zitadel-session-logout"]'));
    await new Promise((resolve) => setTimeout(resolve, 32));
    await element.updateComplete;

    expect(shadowQuery<HTMLElement>(element, ".error").textContent?.trim().length).toBeGreaterThan(0);
    expect(loc.current).toBe("");
  });
});
