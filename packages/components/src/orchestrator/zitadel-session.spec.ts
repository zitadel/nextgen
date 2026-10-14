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
const OTHER_BASE = "https://other-session.test.invalid";
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

const otherHandler = http.get(`${OTHER_BASE}/sessions/me`, () =>
  HttpResponse.json(sessionBody("bob@other.com", "user_other")),
);

const server = setupServer(getHandler, deleteHandler, otherHandler);

beforeAll(() => {
  configureZitadel({ proxyPath: API_BASE, projectId: "test" });
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  deleteLog.length = 0;
  currentEmail = "alice@acme.com";
  currentUserId = "user_test";
  sessionAnswer = undefined;
  server.resetHandlers(getHandler, deleteHandler, otherHandler);
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

  it("renders nothing and fires zitadel-session-missing for an anonymous session", async () => {
    const anonymous: Record<string, unknown> = {
      ...sessionBody("", ""),
      state: "building",
      user_id: null,
    };
    delete anonymous.user;
    sessionAnswer = () => HttpResponse.json(anonymous);
    const missing: Event[] = [];
    host.addEventListener("zitadel-session-missing", (e) => missing.push(e));
    const element = mount();
    await flush(element);
    expect(element.shadowRoot?.querySelector(".title")).toBeNull();
    expect(missing).toHaveLength(1);
  });

  it("fires zitadel-session-missing, not zitadel-signout, when there is no session", async () => {
    sessionAnswer = unauthorized;
    const missing: CustomEvent[] = [];
    const signouts: Event[] = [];
    host.addEventListener("zitadel-session-missing", (e) => missing.push(e as CustomEvent));
    host.addEventListener("zitadel-signout", (e) => signouts.push(e));
    const element = mount();
    await flush(element);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.bubbles && missing[0]?.composed).toBe(true);
    expect(signouts).toHaveLength(0);
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

  it("neither announces nor navigates once removed before the answer arrives", async () => {
    let answer: () => void = () => undefined;
    server.use(
      http.get(`${API_BASE}/sessions/me`, async () => {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return unauthorized();
      }),
    );
    const loc = stubLocation();
    const missing: Event[] = [];
    const element = mount(
      '<zitadel-session post-sign-out-url="https://app.test/login"></zitadel-session>',
    );
    element.addEventListener("zitadel-session-missing", (e) => missing.push(e));
    await flush(element);

    element.remove();
    answer();
    await flush(element);

    expect(missing).toHaveLength(0);
    expect(loc.current).toBe("");
  });

  it.each([...OUTAGES, ...UNREADABLE_SESSIONS])(
    "keeps the card and shows the error, without announcing or navigating, for %s",
    async (_, answer) => {
      sessionAnswer = answer;
      const loc = stubLocation();
      const missing: Event[] = [];
      host.addEventListener("zitadel-session-missing", (e) => missing.push(e));
      const element = mount(
        '<zitadel-session post-sign-out-url="https://app.test/login"></zitadel-session>',
      );
      await flush(element);
      expect(shadowQuery<HTMLElement>(element, ".title").textContent?.trim()).toBe("Signed in as");
      expect(
        shadowQuery<HTMLElement>(element, ".error").textContent?.trim().length,
      ).toBeGreaterThan(0);
      expect(missing).toHaveLength(0);
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

describe("<zitadel-session> defaults for unset props", () => {
  let host: HTMLDivElement;

  beforeAll(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.innerHTML = "";
  });

  const DEFAULTS = [
    ["heading", "Signed in as"],
    ["logoutLabel", "Sign out"],
    ["variant", "widget"],
    ["theme", ""],
    ["suppressHeader", false],
  ] as const;

  const UNSET = [undefined, null, ""] as const;

  const CASES = DEFAULTS.flatMap(([prop, fallback]) =>
    UNSET.map((value): [(typeof DEFAULTS)[number][0], unknown, unknown] => [prop, value, fallback]),
  );

  it.each(CASES)("reads %s assigned %j as its default %j", async (prop, value, fallback) => {
    const element = document.createElement("zitadel-session") as ZitadelSession;
    (element as unknown as Record<string, unknown>)[prop] = value;
    host.appendChild(element);
    await element.updateComplete;
    expect(element[prop]).toBe(fallback);
  });

  it.each(UNSET)("paints the default heading and label when both are %j", async (value) => {
    const element = document.createElement("zitadel-session") as ZitadelSession;
    element.heading = value as string;
    element.logoutLabel = value as string;
    host.appendChild(element);
    await flush(element);
    expect(shadowQuery<HTMLElement>(element, ".title").textContent?.trim()).toBe("Signed in as");
    expect(
      shadowQuery<HTMLElement>(
        element,
        'zl-button[data-testid="zitadel-session-logout"]',
      ).getAttribute("label"),
    ).toBe("Sign out");
  });

  it("restores the defaults when a set value is cleared", async () => {
    const element = document.createElement("zitadel-session") as ZitadelSession;
    element.heading = "Welcome";
    element.logoutLabel = "Leave";
    host.appendChild(element);
    await flush(element);

    element.heading = undefined as unknown as string;
    element.logoutLabel = undefined as unknown as string;
    await element.updateComplete;

    expect(shadowQuery<HTMLElement>(element, ".title").textContent?.trim()).toBe("Signed in as");
    expect(
      shadowQuery<HTMLElement>(
        element,
        'zl-button[data-testid="zitadel-session-logout"]',
      ).getAttribute("label"),
    ).toBe("Sign out");
  });

  it.each([
    ["heading", "heading", "Welcome", "Signed in as"],
    ["logout-label", "logoutLabel", "Leave", "Sign out"],
    ["variant", "variant", "page", "widget"],
    ["theme", "theme", "light", ""],
  ] as const)(
    "restores %s to its default when the attribute is removed",
    async (attribute, prop, value, fallback) => {
      host.innerHTML = `<zitadel-session ${attribute}="${value}"></zitadel-session>`;
      const element = host.querySelector("zitadel-session") as ZitadelSession;
      await element.updateComplete;
      expect(element[prop]).toBe(value);

      element.removeAttribute(attribute);
      await element.updateComplete;

      expect(element[prop]).toBe(fallback);
    },
  );
});

describe("<zitadel-session> identity lifecycle", () => {
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

  it("renders nothing after signing out without a post-sign-out-url", async () => {
    const element = mount();
    await flush(element);

    activate(shadowQuery(element, 'zl-button[data-testid="zitadel-session-logout"]'));
    await flush(element);

    expect(element.shadowRoot?.querySelector(".title")).toBeNull();
    expect(element.shadowRoot?.querySelector('[data-testid="zitadel-session-logout"]')).toBeNull();
  });

  it("ignores an identity response that arrives after signing out", async () => {
    let answer: () => void = () => undefined;
    server.use(
      http.get(`${API_BASE}/sessions/me`, async () => {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json(sessionBody("alice@acme.com", "user_test"));
      }),
    );
    const element = mount();
    await element.updateComplete;

    activate(shadowQuery(element, 'zl-button[data-testid="zitadel-session-logout"]'));
    await flush(element);
    answer();
    await flush(element);

    expect(element.shadowRoot?.querySelector(".identity")).toBeNull();
    expect(element.shadowRoot?.querySelector(".title")).toBeNull();
  });

  it("still reports the signed-out identity in zitadel-signout", async () => {
    const element = mount();
    await flush(element);
    const events: CustomEvent[] = [];
    element.addEventListener("zitadel-signout", (e) => events.push(e as CustomEvent));

    activate(shadowQuery(element, 'zl-button[data-testid="zitadel-session-logout"]'));
    await flush(element);

    expect(events[0]?.detail).toEqual({ display: "", identifier: "alice@acme.com" });
  });

  it("refetches the identity when the project changes", async () => {
    const element = mount();
    await flush(element);

    element.project = { projectId: "other", proxyPath: OTHER_BASE };
    await flush(element);

    expect(shadowQuery<HTMLElement>(element, ".identity").textContent?.trim()).toBe(
      "bob@other.com",
    );
  });

  it("does not refetch when a framework re-assigns an equal project", async () => {
    let fetches = 0;
    server.use(
      http.get(`${OTHER_BASE}/sessions/me`, () => {
        fetches += 1;
        return HttpResponse.json(sessionBody("bob@other.com", "user_other"));
      }),
    );
    const element = mount();
    element.project = { projectId: "other", proxyPath: OTHER_BASE };
    await flush(element);

    element.project = { projectId: "other", proxyPath: OTHER_BASE };
    await flush(element);

    expect(fetches).toBe(1);
  });

  it("loads the identity once configureZitadel() runs after mount", async () => {
    _resetConfigForTesting();
    try {
      const element = mount();
      await flush(element);
      expect(element.shadowRoot?.querySelector(".identity")).toBeNull();

      configureZitadel({ proxyPath: API_BASE, projectId: "test" });
      await flush(element);

      expect(shadowQuery<HTMLElement>(element, ".identity").textContent?.trim()).toBe(
        "alice@acme.com",
      );
    } finally {
      _resetConfigForTesting();
      configureZitadel({ proxyPath: API_BASE, projectId: "test" });
    }
  });
});
