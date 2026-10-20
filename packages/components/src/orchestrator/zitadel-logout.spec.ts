import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";

import "./zitadel-logout.js";
import type { ZitadelLogout } from "./zitadel-logout.js";

/**
 * jsdom-friendly behaviour for `<zitadel-logout>`. Identity is fetched from
 * `GET /sessions/me` (the same source as `<zitadel-session>`, so both signed-in
 * surfaces work against the real backend); light-DOM `<template>` projection,
 * aria semantics, and the revoke call all live here. Outside-click and keyboard
 * handling that depend on real focus traversal go in
 * `zitadel-logout.browser.spec.ts`.
 */
const API_BASE = "https://logout.test.invalid";
const requestLog: { url: string; method: string; credentials: string }[] = [];

function sessionBody(display: string, identifier: string, userId: string) {
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
  if (display) user.display = display;
  if (identifier) {
    user.identifier = identifier;
    user.identifier_property = "email";
  }
  body.user = user;
  return body;
}

let currentName = "";
let currentEmail = "";
let currentUserId = "user_test";
let sessionStatus = 200;

const meHandler = http.get(`${API_BASE}/sessions/me`, () => {
  if (sessionStatus !== 200) {
    return new HttpResponse(null, { status: sessionStatus });
  }
  return HttpResponse.json(sessionBody(currentName, currentEmail, currentUserId));
});

const okHandler = http.delete(`${API_BASE}/sessions/me`, ({ request }) => {
  requestLog.push({
    url: request.url,
    method: request.method,
    credentials: request.credentials,
  });
  return new HttpResponse(null, { status: 204 });
});

const server = setupServer(meHandler, okHandler);

beforeAll(() => {
  configureZitadel({ proxyPath: API_BASE, projectId: "test" });
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  requestLog.length = 0;
  currentName = "";
  currentEmail = "";
  currentUserId = "user_test";
  sessionStatus = 200;
  server.resetHandlers(meHandler, okHandler);
});

afterAll(() => {
  server.close();
});

/**
 * Resolves a shadow-DOM element by selector, throwing if either the shadow
 * root or the queried element is missing. Replaces the
 * `(host.shadowRoot?.querySelector("X") as Y).click()` pattern that
 * `no-unsafe-optional-chaining` flags as a `TypeError` waiting to happen.
 */
function shadowQuery<T extends Element>(host: Element, selector: string): T {
  const root = host.shadowRoot;
  if (!root) {
    throw new Error(`shadowQuery: ${host.tagName} has no shadow root`);
  }
  const found = root.querySelector<T>(selector);
  if (!found) {
    throw new Error(`shadowQuery: no element matched ${selector}`);
  }
  return found;
}

/** Waits for the async identity fetch + re-render to settle. */
async function flush(element: ZitadelLogout): Promise<void> {
  await element.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 16));
  await element.updateComplete;
}

describe("<zitadel-logout>", () => {
  let host: HTMLDivElement;

  beforeAll(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.innerHTML = "";
  });

  function mount(markup = "<zitadel-logout></zitadel-logout>"): ZitadelLogout {
    host.innerHTML = markup;
    return host.querySelector("zitadel-logout") as ZitadelLogout;
  }

  it("renders the avatar trigger collapsed by default", async () => {
    currentName = "Alice Liddell";
    currentEmail = "alice@acme.com";
    const element = mount();
    await flush(element);
    const trigger = shadowQuery<HTMLButtonElement>(element, ".trigger");
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent?.trim()).toBe("A");
    expect(element.shadowRoot?.querySelector(".dropdown")).toBeNull();
  });

  it("opens the dropdown and shows the signed-in identity on click", async () => {
    currentName = "Alice Liddell";
    currentEmail = "alice@acme.com";
    const element = mount();
    await flush(element);
    const trigger = shadowQuery<HTMLButtonElement>(element, ".trigger");
    trigger.click();
    await element.updateComplete;
    const name = shadowQuery<HTMLElement>(element, ".preview-name");
    const email = shadowQuery<HTMLElement>(element, ".preview-email");
    expect(name.textContent?.trim()).toBe("Alice Liddell");
    expect(email.textContent?.trim()).toBe("alice@acme.com");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("falls back to the user_id initial when the session has no name/email", async () => {
    currentName = "";
    currentEmail = "";
    currentUserId = "user_01ABC";
    const element = mount();
    await flush(element);
    const trigger = shadowQuery<HTMLButtonElement>(element, ".trigger");
    expect(trigger.textContent?.trim()).toBe("U");
  });

  it("falls back to a placeholder initial when there is no active session", async () => {
    sessionStatus = 401;
    const element = mount();
    await flush(element);
    const trigger = shadowQuery<HTMLButtonElement>(element, ".trigger");
    expect(trigger.textContent?.trim()).toBe("?");
  });

  it("substitutes template tokens and wires data-action='logout' triggers", async () => {
    currentName = "Bob Builder";
    currentEmail = "bob@example.com";
    const element = mount(`
      <zitadel-logout>
        <template>
          <button data-action="logout">Sign out {{display}} ({{identifier}}) [{{initial}}]</button>
        </template>
      </zitadel-logout>
    `);
    await flush(element);
    const button = element.querySelector("button[data-action='logout']") as HTMLButtonElement;
    expect(button.textContent).toBe("Sign out Bob Builder (bob@example.com) [B]");
    expect(element.shadowRoot?.querySelector(".trigger")).toBeNull();
  });

  it("renders identity values containing token-like substrings literally", async () => {
    // A display name that embeds "{{email}}" must not get re-substituted by
    // a later replacement pass — substitution is single-pass by contract.
    currentName = "Evil {{email}} Person";
    currentEmail = "evil@example.com";
    const element = mount(`
      <zitadel-logout>
        <template>
          <button data-action="logout">Sign out {{display}}</button>
        </template>
      </zitadel-logout>
    `);
    await flush(element);
    const button = element.querySelector("button[data-action='logout']") as HTMLButtonElement;
    expect(button.textContent).toBe("Sign out Evil {{email}} Person");
  });

  it("re-projects the template with identity when project is assigned after mount", async () => {
    // No config resolvable at connect: the control still renders, but with a
    // blank identity. When a framework assigns `project` post-mount and the
    // fetch succeeds, the projected markup must update (not stay blank).
    _resetConfigForTesting();
    try {
      currentName = "Carol Danvers";
      currentEmail = "carol@acme.com";
      const element = mount(`
        <zitadel-logout>
          <template>
            <button data-action="logout">Bye {{name}} [{{initial}}]</button>
          </template>
        </zitadel-logout>
      `);
      await element.updateComplete;
      const before = element.querySelector("button[data-action='logout']") as HTMLButtonElement;
      expect(before.textContent).toBe("Bye  [?]");

      element.project = configureZitadel({ proxyPath: API_BASE, projectId: "test" });
      await flush(element);

      const after = element.querySelector("button[data-action='logout']") as HTMLButtonElement;
      expect(after.textContent).toBe("Bye Carol Danvers [C]");
    } finally {
      configureZitadel({ proxyPath: API_BASE, projectId: "test" });
    }
  });

  it("calls DELETE /sessions/me with credentials, fires zitadel-signout", async () => {
    currentName = "Alice Liddell";
    currentEmail = "alice@acme.com";
    const element = mount();
    await flush(element);
    shadowQuery<HTMLButtonElement>(element, ".trigger").click();
    await element.updateComplete;

    const signoutEvents: CustomEvent[] = [];
    element.addEventListener("zitadel-signout", (event: Event) => {
      signoutEvents.push(event as CustomEvent);
    });

    shadowQuery<HTMLButtonElement>(element, ".signout-btn").click();
    await new Promise((resolve) => setTimeout(resolve, 16));
    await element.updateComplete;

    expect(requestLog).toHaveLength(1);
    expect(requestLog[0]?.method).toBe("DELETE");
    expect(requestLog[0]?.url).toBe(`${API_BASE}/sessions/me?project_id=test`);
    expect(requestLog[0]?.credentials).toBe("include");
    expect(signoutEvents).toHaveLength(1);
    expect(signoutEvents[0]?.detail).toEqual({
      display: "Alice Liddell",
      identifier: "alice@acme.com",
    });
  });

  it("navigates to post-sign-out-url after successful revoke", async () => {
    currentName = "Alice";
    currentEmail = "alice@acme.com";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, href: "" },
      writable: true,
    });
    const element = mount();
    element.postSignOutUrl = "https://app.test/done";
    await flush(element);
    shadowQuery<HTMLButtonElement>(element, ".trigger").click();
    await element.updateComplete;
    shadowQuery<HTMLButtonElement>(element, ".signout-btn").click();
    await new Promise((resolve) => setTimeout(resolve, 32));

    expect(requestLog).toHaveLength(1);
    expect(requestLog[0]?.method).toBe("DELETE");
    expect(window.location.href).toBe("https://app.test/done");
  });

  it("signs out using project-id / proxy-path attributes with no global config", async () => {
    // Drop the global so only the declarative attributes can configure the
    // element; restore it afterwards so later tests keep their global config.
    _resetConfigForTesting();
    try {
      const element = mount(
        `<zitadel-logout project-id="test" proxy-path="${API_BASE}"></zitadel-logout>`,
      );
      await flush(element);
      shadowQuery<HTMLButtonElement>(element, ".trigger").click();
      await element.updateComplete;
      shadowQuery<HTMLButtonElement>(element, ".signout-btn").click();
      await new Promise((resolve) => setTimeout(resolve, 32));

      expect(requestLog).toHaveLength(1);
      expect(requestLog[0]?.url).toBe(`${API_BASE}/sessions/me?project_id=test`);
      expect(requestLog[0]?.credentials).toBe("include");
    } finally {
      configureZitadel({ proxyPath: API_BASE, projectId: "test" });
    }
  });

  // A session that ended elsewhere (signed out in another tab, or expired) is
  // refused as no session at all: there is nothing left to sign out of.
  it("completes sign-out when the session is already gone", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, href: "" },
      writable: true,
    });
    const element = mount();
    element.postSignOutUrl = "https://app.test/done";
    await flush(element);
    server.use(
      http.delete(`${API_BASE}/sessions/me`, () =>
        HttpResponse.json(
          { code: "auth.unauthorized", message: "Missing or invalid session token." },
          { status: 401 },
        ),
      ),
    );

    const signoutEvents: Event[] = [];
    element.addEventListener("zitadel-signout", (event: Event) => signoutEvents.push(event));

    shadowQuery<HTMLButtonElement>(element, ".trigger").click();
    await element.updateComplete;
    shadowQuery<HTMLButtonElement>(element, ".signout-btn").click();
    await new Promise((resolve) => setTimeout(resolve, 32));
    await element.updateComplete;

    expect(signoutEvents).toHaveLength(1);
    expect(element.shadowRoot?.querySelector(".error-bar")).toBeNull();
    expect(window.location.href).toBe("https://app.test/done");
  });

  it("surfaces a network error in the dropdown without redirecting", async () => {
    const element = mount();
    await flush(element);
    server.use(http.delete(`${API_BASE}/sessions/me`, () => HttpResponse.error()));

    shadowQuery<HTMLButtonElement>(element, ".trigger").click();
    await element.updateComplete;
    shadowQuery<HTMLButtonElement>(element, ".signout-btn").click();
    await new Promise((resolve) => setTimeout(resolve, 32));
    await element.updateComplete;

    const errorBar = shadowQuery<HTMLElement>(element, ".error-bar");
    expect(errorBar.textContent?.trim().length).toBeGreaterThan(0);
  });
});

describe("<zitadel-logout> unset public properties", () => {
  type Declaration = { attribute?: string | boolean; state?: boolean };
  type Props = Record<string, unknown>;
  const create = () => document.createElement("zitadel-logout");
  const declared = (
    customElements.get("zitadel-logout") as unknown as {
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
