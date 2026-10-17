import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";

import {
  NO_SESSION,
  OUTAGES,
  UNREADABLE_SESSIONS,
  sessionNotFound,
  unauthorized,
} from "./__tests__/session-answers.js";
import "./zitadel-session.js";
import type { ZitadelSession } from "./zitadel-session.js";

/**
 * jsdom-friendly behaviour for `<zitadel-session>`. Identity is fetched from
 * `GET /sessions/me`; the Logout wiring, the revoke call, and emitted events
 * are covered here.
 */
const API_BASE = "https://session.test.invalid";
const deleteLog: { url: string; method: string; credentials: string }[] = [];

function sessionBody(identifier: string, userId: string) {
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
  const user: Record<string, string> = { user_id: userId };
  if (identifier) {
    user.identifier = identifier;
    user.identifier_property = "email";
  }
  body.user = user;
  return body;
}

let currentEmail = "alice@acme.com";
let currentUserId = "user_test";
// Replaces the signed-in answer to `GET /sessions/me` when set.
let sessionAnswer: (() => Response) | undefined;

const getHandler = http.get(`${API_BASE}/sessions/me`, () =>
  sessionAnswer ? sessionAnswer() : HttpResponse.json(sessionBody(currentEmail, currentUserId)),
);

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
  sessionAnswer = undefined;
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

  it("renders the heading and the resolved identifier fetched from GET /sessions/me", async () => {
    currentEmail = "alice@acme.com";
    const element = mount();
    await flush(element);
    expect(shadowQuery<HTMLElement>(element, ".title").textContent?.trim()).toBe("Signed in as");
    expect(shadowQuery<HTMLElement>(element, ".identity").textContent?.trim()).toBe(
      "alice@acme.com",
    );
  });

  it("falls back to user_id when the session ref carries no identifier", async () => {
    currentEmail = "";
    currentUserId = "user_01ABC";
    const element = mount();
    await flush(element);
    expect(shadowQuery<HTMLElement>(element, ".identity").textContent?.trim()).toBe("user_01ABC");
  });

  it.each(NO_SESSION)("renders nothing when the session request answers %s", async (_, answer) => {
    sessionAnswer = answer;
    const element = mount();
    await flush(element);
    expect(element.shadowRoot?.querySelector(".title")).toBeNull();
    expect(element.shadowRoot?.querySelector('[data-testid="zitadel-session-logout"]')).toBeNull();
  });

  it("renders nothing for an anonymous session", async () => {
    const anonymous: Record<string, unknown> = {
      ...sessionBody("", ""),
      state: "building",
      user_id: null,
    };
    delete anonymous.user;
    sessionAnswer = () => HttpResponse.json(anonymous);
    const element = mount();
    await flush(element);
    expect(element.shadowRoot?.querySelector(".title")).toBeNull();
  });

  it("navigates to post-sign-out-url when there is no session", async () => {
    sessionAnswer = sessionNotFound;
    const loc = stubLocation();
    const element = mount(
      '<zitadel-session post-sign-out-url="https://app.test/login"></zitadel-session>',
    );
    await flush(element);
    expect(loc.current).toBe("https://app.test/login");
  });

  it("does not navigate when there is no session and no post-sign-out-url", async () => {
    sessionAnswer = unauthorized;
    const loc = stubLocation();
    await flush(mount());
    expect(loc.current).toBe("");
  });

  it.each([...OUTAGES, ...UNREADABLE_SESSIONS])(
    "keeps the card and shows the error, without navigating, for %s",
    async (_, answer) => {
      sessionAnswer = answer;
      const loc = stubLocation();
      const element = mount(
        '<zitadel-session post-sign-out-url="https://app.test/login"></zitadel-session>',
      );
      await flush(element);
      expect(shadowQuery<HTMLElement>(element, ".title").textContent?.trim()).toBe("Signed in as");
      expect(
        shadowQuery<HTMLElement>(element, ".error").textContent?.trim().length,
      ).toBeGreaterThan(0);
      expect(loc.current).toBe("");
    },
  );

  it("suppress-header visually hides the heading but keeps it accessible", async () => {
    currentEmail = "alice@acme.com";
    const element = mount("<zitadel-session suppress-header></zitadel-session>");
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
    const identity = shadowQuery<HTMLElement>(element, ".identity");
    expect(identity.classList.contains("sr-only")).toBe(false);
    expect(identity.hasAttribute("slot")).toBe(false);
  });

  it("renders the heading normally without suppress-header", async () => {
    currentEmail = "alice@acme.com";
    const element = mount();
    await flush(element);
    expect(element.suppressHeader).toBe(false);
    expect(shadowQuery<HTMLElement>(element, ".title").classList.contains("sr-only")).toBe(false);
    expect(shadowQuery<HTMLElement>(element, ".identity").getAttribute("slot")).toBe("header");
  });

  it("renders a single primary Sign out action", async () => {
    const element = mount();
    await flush(element);
    const out = shadowQuery<HTMLElement>(
      element,
      'zl-button[data-testid="zitadel-session-logout"]',
    );
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
    expect(events[0]?.detail).toEqual({ display: "", identifier: "alice@acme.com" });
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

    expect(shadowQuery<HTMLElement>(element, ".error").textContent?.trim().length).toBeGreaterThan(
      0,
    );
    expect(loc.current).toBe("");
  });

  it.each(NO_SESSION)(
    "treats %s from the sign-out request as signed out and navigates",
    async (_, answer) => {
      const loc = stubLocation();
      const element = mount();
      element.postSignOutUrl = "https://app.test/login";
      await flush(element);
      server.use(http.delete(`${API_BASE}/sessions/me`, answer));
      const events: CustomEvent[] = [];
      element.addEventListener("zitadel-signout", (e) => events.push(e as CustomEvent));

      activate(shadowQuery(element, 'zl-button[data-testid="zitadel-session-logout"]'));
      await new Promise((resolve) => setTimeout(resolve, 32));

      expect(events).toHaveLength(1);
      expect(loc.current).toBe("https://app.test/login");
      expect(element.shadowRoot?.querySelector(".error")).toBeNull();
    },
  );

  it.each(OUTAGES)(
    "shows the error and neither signs out nor navigates when sign-out gets %s",
    async (_, answer) => {
      const loc = stubLocation();
      const element = mount();
      element.postSignOutUrl = "https://app.test/login";
      await flush(element);
      server.use(http.delete(`${API_BASE}/sessions/me`, answer));
      const events: Event[] = [];
      element.addEventListener("zitadel-signout", (e) => events.push(e));

      activate(shadowQuery(element, 'zl-button[data-testid="zitadel-session-logout"]'));
      await new Promise((resolve) => setTimeout(resolve, 32));
      await element.updateComplete;

      expect(
        shadowQuery<HTMLElement>(element, ".error").textContent?.trim().length,
      ).toBeGreaterThan(0);
      expect(events).toHaveLength(0);
      expect(loc.current).toBe("");
    },
  );
});

describe("<zitadel-session> unset public properties", () => {
  type Declaration = { attribute?: string | boolean; state?: boolean };
  type Props = Record<string, unknown>;
  const create = () => document.createElement("zitadel-session");
  const declared = (
    customElements.get("zitadel-session") as unknown as {
      elementProperties: Map<string, Declaration>;
    }
  ).elementProperties;
  // Every public property that has a declared default, read off a fresh element so a
  // property added later is covered without touching this list.
  const defaulted = [...declared]
    .filter(([name, options]) => !options.state && (create() as unknown as Props)[name] != null)
    .map(([name, options]) => ({
      name,
      attribute:
        typeof options.attribute === "string"
          ? options.attribute
          : options.attribute === false
            ? undefined
            : name.toLowerCase(),
      fallback: (create() as unknown as Props)[name],
    }));
  const other = (fallback: unknown) => (typeof fallback === "boolean" ? !fallback : "other");

  it("covers the element's defaulted properties", () => {
    expect(defaulted.length).toBeGreaterThan(0);
  });

  it.each(defaulted)(
    "keeps the default of $name when it is assigned undefined",
    ({ name, fallback }) => {
      const element = create() as unknown as Props;
      element[name] = undefined;
      expect(element[name]).toEqual(fallback);
    },
  );

  it.each(defaulted)(
    "keeps the default of $name when it is assigned null",
    ({ name, fallback }) => {
      const element = create() as unknown as Props;
      element[name] = null;
      expect(element[name]).toEqual(fallback);
    },
  );

  it.each(defaulted)(
    "restores the default of $name when a set value is cleared",
    ({ name, fallback }) => {
      const element = create() as unknown as Props;
      element[name] = other(fallback);
      expect(element[name]).toEqual(other(fallback));
      element[name] = undefined;
      expect(element[name]).toEqual(fallback);
    },
  );

  it.each(defaulted)("keeps a supplied value of $name", ({ name, fallback }) => {
    const element = create() as unknown as Props;
    element[name] = other(fallback);
    expect(element[name]).toEqual(other(fallback));
  });

  it.each(defaulted.filter(({ attribute }) => attribute !== undefined))(
    "restores the default of $name when its attribute is removed",
    ({ name, attribute, fallback }) => {
      const element = create();
      element.setAttribute(attribute as string, typeof fallback === "boolean" ? "" : "other");
      expect((element as unknown as Props)[name]).toEqual(other(fallback));
      element.removeAttribute(attribute as string);
      expect((element as unknown as Props)[name]).toEqual(fallback);
    },
  );
});
