import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
let sessionAnswer: (() => Response | Promise<Response>) | undefined;

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
  vi.restoreAllMocks();
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

/**
 * Replaces `window.location` with a stub recording `assign()` calls, on
 * `href` when given.
 */
function stubLocation(href = window.location.href, base = href): { current: string } {
  const record = { current: "" };
  Object.defineProperty(document, "baseURI", { configurable: true, value: base });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, href, assign: (url: string) => (record.current = url) },
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

  it("navigates once it is put back when the no-session answer came while it was detached", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    sessionAnswer = async () => {
      await gate;
      return sessionNotFound();
    };
    const loc = stubLocation();
    const element = mount(
      '<zitadel-session post-sign-out-url="https://app.test/login"></zitadel-session>',
    );
    element.remove();
    release();
    await new Promise((resolve) => setTimeout(resolve, 32));
    expect(loc.current).toBe("");

    host.appendChild(element);
    await flush(element);

    expect(loc.current).toBe("https://app.test/login");
  });

  it("does not navigate when there is no session and no post-sign-out-url", async () => {
    sessionAnswer = unauthorized;
    const loc = stubLocation();
    await flush(mount());
    expect(loc.current).toBe("");
  });

  it.each([
    "/account?tab=me",
    "https://app.test/account?tab=me",
    "account?tab=me",
    "/account?tab=me#top",
  ])("renders nothing and stays when post-sign-out-url %j is the page it is on", async (url) => {
    sessionAnswer = unauthorized;
    const loc = stubLocation("https://app.test/account?tab=me");
    const element = mount(`<zitadel-session post-sign-out-url="${url}"></zitadel-session>`);
    await flush(element);
    expect(loc.current).toBe("");
    expect(element.shadowRoot?.querySelector(".title")).toBeNull();
  });

  it.each([
    ["https://app.test/account/", "/account"],
    ["https://app.test/account", "/account/"],
    ["https://app.test/", ""],
    ["https://app.test/account?b=2&a=1", "/account?a=1&b=2"],
  ])("renders nothing and stays on %s when post-sign-out-url is %j", async (href, url) => {
    sessionAnswer = unauthorized;
    const loc = stubLocation(href);
    const element = mount(`<zitadel-session post-sign-out-url="${url || "/"}"></zitadel-session>`);
    await flush(element);
    expect(loc.current).toBe("");
  });

  /** Mounts the card on `href`, arriving from `referrer`, and returns where it went. */
  async function loadPage(href: string, url: string, referrer: string): Promise<string> {
    host.innerHTML = "";
    vi.spyOn(document, "referrer", "get").mockReturnValue(referrer);
    const loc = stubLocation(href);
    const element = mount(`<zitadel-session post-sign-out-url="${url}"></zitadel-session>`);
    await flush(element);
    return loc.current;
  }

  it("does not navigate when the visitor was sent here from the target", async () => {
    sessionAnswer = unauthorized;
    // `/` redirected back to `/account`: the page must stay put.
    expect(await loadPage("https://app.test/account", "/", "https://app.test/")).toBe("");
    expect(host.querySelector("zitadel-session")?.shadowRoot?.querySelector(".title")).toBeNull();
  });

  it("does not navigate when the visitor was sent here from this page", async () => {
    sessionAnswer = unauthorized;
    // The card navigated from `/account` and a redirect brought the visitor back to it.
    expect(await loadPage("https://app.test/account", "/", "https://app.test/account/")).toBe("");
  });

  it("navigates when the visitor arrives from another page", async () => {
    sessionAnswer = unauthorized;
    expect(await loadPage("https://app.test/account", "/", "https://app.test/settings")).toBe("/");
  });

  it("navigates when there is no referrer", async () => {
    sessionAnswer = unauthorized;
    expect(await loadPage("https://app.test/account", "/", "")).toBe("/");
  });

  it("navigates when the referrer cannot be read", async () => {
    sessionAnswer = unauthorized;
    expect(await loadPage("https://app.test/account", "/", "not a url")).toBe("/");
  });

  it("resolves a relative post-sign-out-url against the document base, as navigation does", async () => {
    sessionAnswer = unauthorized;
    const loc = stubLocation("https://app.test/app/account", "https://app.test/");
    const element = mount(`<zitadel-session post-sign-out-url="account"></zitadel-session>`);
    await flush(element);
    expect(loc.current).toBe("account");
  });

  it("stays when a relative post-sign-out-url resolves to the page itself through the document base", async () => {
    sessionAnswer = unauthorized;
    const loc = stubLocation("https://app.test/x/account", "https://app.test/");
    const element = mount(`<zitadel-session post-sign-out-url="x/account"></zitadel-session>`);
    await flush(element);
    expect(loc.current).toBe("");
  });

  it.each([
    ["/account", "/account"],
    ["https://other.test/account?tab=me", "https://other.test/account?tab=me"],
  ])("navigates when post-sign-out-url %j is another page", async (url, expected) => {
    sessionAnswer = unauthorized;
    const loc = stubLocation("https://app.test/account?tab=me");
    const element = mount(`<zitadel-session post-sign-out-url="${url}"></zitadel-session>`);
    await flush(element);
    expect(loc.current).toBe(expected);
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

  it.each([...OUTAGES, ...UNREADABLE_SESSIONS])(
    "fires zitadel-session-error with phase load for %s",
    async (_, answer) => {
      sessionAnswer = answer;
      const errors: CustomEvent[] = [];
      host.addEventListener("zitadel-session-error", (e) => errors.push(e as CustomEvent));
      const element = mount();
      await flush(element);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.bubbles && errors[0]?.composed).toBe(true);
      expect(errors[0]?.detail).toMatchObject({
        phase: "load",
        message: shadowQuery<HTMLElement>(element, ".error").textContent?.trim(),
      });
    },
  );

  it("reports the status and the backend's code in zitadel-session-error", async () => {
    sessionAnswer = () =>
      HttpResponse.json({ code: "internal", message: "Internal error" }, { status: 500 });
    const errors: CustomEvent[] = [];
    host.addEventListener("zitadel-session-error", (e) => errors.push(e as CustomEvent));
    await flush(mount());
    expect(errors[0]?.detail).toMatchObject({ status: 500, code: "internal", phase: "load" });
  });

  it("reports a network error in zitadel-session-error without a status", async () => {
    sessionAnswer = () => HttpResponse.error();
    const errors: CustomEvent[] = [];
    host.addEventListener("zitadel-session-error", (e) => errors.push(e as CustomEvent));
    await flush(mount());
    expect(errors[0]?.detail).not.toHaveProperty("status");
  });

  it.each(NO_SESSION)(
    "fires no zitadel-session-error when the request answers %s",
    async (_, answer) => {
      sessionAnswer = answer;
      const errors: Event[] = [];
      host.addEventListener("zitadel-session-error", (e) => errors.push(e));
      await flush(mount());
      expect(errors).toHaveLength(0);
    },
  );

  it("reports a load failure it missed while removed, once put back", async () => {
    let requests = 0;
    let answer: () => void = () => undefined;
    server.use(
      http.get(`${API_BASE}/sessions/me`, async () => {
        requests += 1;
        if (requests === 1) {
          await new Promise<void>((resolve) => {
            answer = resolve;
          });
        }
        return HttpResponse.json({ code: "internal", message: "Internal error" }, { status: 500 });
      }),
    );
    const errors: Event[] = [];
    const element = mount();
    element.addEventListener("zitadel-session-error", (e) => errors.push(e));
    await flush(element);
    element.remove();
    answer();
    await flush(element);
    expect(errors).toHaveLength(0);

    host.appendChild(element);
    await flush(element);

    expect(requests).toBe(2);
    expect(errors).toHaveLength(1);
  });

  it.each(UNREADABLE_SESSIONS)(
    "reports status 200 in zitadel-session-error for %s",
    async (_, answer) => {
      sessionAnswer = answer;
      const errors: CustomEvent[] = [];
      host.addEventListener("zitadel-session-error", (e) => errors.push(e as CustomEvent));
      await flush(mount());
      expect(errors[0]?.detail).toMatchObject({ status: 200, phase: "load" });
    },
  );

  it("shows no error once a retry after being put back succeeds", async () => {
    let requests = 0;
    let answer: () => void = () => undefined;
    server.use(
      http.get(`${API_BASE}/sessions/me`, async () => {
        requests += 1;
        if (requests === 1) {
          await new Promise<void>((resolve) => {
            answer = resolve;
          });
          return HttpResponse.json(
            { code: "internal", message: "Internal error" },
            { status: 500 },
          );
        }
        return HttpResponse.json(sessionBody(currentEmail, currentUserId));
      }),
    );
    const element = mount();
    await flush(element);
    element.remove();
    answer();
    await flush(element);

    host.appendChild(element);
    await flush(element);

    expect(requests).toBe(2);
    expect(element.shadowRoot?.querySelector(".error")).toBeNull();
    expect(shadowQuery<HTMLElement>(element, ".identity").textContent?.trim()).toBe(currentEmail);
  });

  it("reports a sign-out failure it missed while removed, once put back", async () => {
    const element = mount();
    await flush(element);
    let release: () => void = () => undefined;
    server.use(
      http.delete(`${API_BASE}/sessions/me`, async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json({ code: "internal", message: "Internal error" }, { status: 500 });
      }),
    );
    const errors: CustomEvent[] = [];
    element.addEventListener("zitadel-session-error", (e) => errors.push(e as CustomEvent));

    activate(shadowQuery(element, 'zl-button[data-testid="zitadel-session-logout"]'));
    await new Promise((resolve) => setTimeout(resolve, 16));
    element.remove();
    release();
    await new Promise((resolve) => setTimeout(resolve, 32));
    expect(errors).toHaveLength(0);

    host.appendChild(element);
    await flush(element);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.detail).toMatchObject({ phase: "signout", status: 500, code: "internal" });
  });

  it("reports a sign-out it completed while removed, once put back", async () => {
    const element = mount();
    await flush(element);
    let release: () => void = () => undefined;
    server.use(
      http.delete(`${API_BASE}/sessions/me`, async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const events: CustomEvent[] = [];
    element.addEventListener("zitadel-signout", (e) => events.push(e as CustomEvent));

    activate(shadowQuery(element, 'zl-button[data-testid="zitadel-session-logout"]'));
    await new Promise((resolve) => setTimeout(resolve, 16));
    element.remove();
    release();
    await new Promise((resolve) => setTimeout(resolve, 32));
    expect(events).toHaveLength(0);

    host.appendChild(element);
    await flush(element);

    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toEqual({ display: "", identifier: "alice@acme.com" });
  });

  it("navigates to post-sign-out-url only once put back when the sign-out completed while removed", async () => {
    const loc = stubLocation();
    const element = mount();
    element.postSignOutUrl = "https://app.test/login";
    await flush(element);
    let release: () => void = () => undefined;
    server.use(
      http.delete(`${API_BASE}/sessions/me`, async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );

    activate(shadowQuery(element, 'zl-button[data-testid="zitadel-session-logout"]'));
    await new Promise((resolve) => setTimeout(resolve, 16));
    element.remove();
    release();
    await new Promise((resolve) => setTimeout(resolve, 32));
    expect(loc.current).not.toBe("https://app.test/login");

    host.appendChild(element);
    await flush(element);

    expect(loc.current).toBe("https://app.test/login");
  });

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

  it.each(OUTAGES)(
    "fires zitadel-session-error with phase signout when sign-out gets %s",
    async (_, answer) => {
      const element = mount();
      await flush(element);
      server.use(http.delete(`${API_BASE}/sessions/me`, answer));
      const errors: CustomEvent[] = [];
      element.addEventListener("zitadel-session-error", (e) => errors.push(e as CustomEvent));

      activate(shadowQuery(element, 'zl-button[data-testid="zitadel-session-logout"]'));
      await new Promise((resolve) => setTimeout(resolve, 32));
      await element.updateComplete;

      expect(errors).toHaveLength(1);
      expect(errors[0]?.detail).toMatchObject({
        phase: "signout",
        message: shadowQuery<HTMLElement>(element, ".error").textContent?.trim(),
      });
    },
  );

  it.each(NO_SESSION)("fires no zitadel-session-error when sign-out gets %s", async (_, answer) => {
    const element = mount();
    await flush(element);
    server.use(http.delete(`${API_BASE}/sessions/me`, answer));
    const errors: Event[] = [];
    element.addEventListener("zitadel-session-error", (e) => errors.push(e));

    activate(shadowQuery(element, 'zl-button[data-testid="zitadel-session-logout"]'));
    await new Promise((resolve) => setTimeout(resolve, 32));

    expect(errors).toHaveLength(0);
  });
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
