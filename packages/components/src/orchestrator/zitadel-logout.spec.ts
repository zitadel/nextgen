import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { configureZitadel, _resetConfigForTesting } from "@zitadel-nextgen/api/config";

import "./zitadel-logout.js";
import type { ZitadelLogout } from "./zitadel-logout.js";

/**
 * jsdom-friendly behaviour for `<zitadel-logout>`. Cookie parsing, light-DOM
 * `<template>` projection, aria semantics, and the network call all live
 * here. Outside-click and keyboard handling that depend on real focus
 * traversal go in `zitadel-logout.browser.spec.ts`.
 */
const API_BASE = "https://logout.test.invalid";
const requestLog: { url: string; method: string; credentials: string }[] = [];

const okHandler = http.get(`${API_BASE}/auth/end-session`, ({ request }) => {
  requestLog.push({
    url: request.url,
    method: request.method,
    credentials: request.credentials,
  });
  return new HttpResponse(null, { status: 204 });
});

const server = setupServer(okHandler);

beforeAll(() => {
  configureZitadel({ proxyPath: API_BASE, projectId: "test" });
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  requestLog.length = 0;
  server.resetHandlers(okHandler);
});

afterAll(() => {
  server.close();
});

function setDisplayCookie(name: string, email: string): void {
  const value = btoa(JSON.stringify({ name, email }));
  document.cookie = `__nextgen_display=${value}; path=/`;
}

function clearDisplayCookie(): void {
  document.cookie = "__nextgen_display=; path=/; max-age=0";
}

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

describe("<zitadel-logout>", () => {
  let host: HTMLDivElement;

  beforeAll(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.innerHTML = "";
    clearDisplayCookie();
  });

  function mount(markup = "<zitadel-logout></zitadel-logout>"): ZitadelLogout {
    host.innerHTML = markup;
    return host.querySelector("zitadel-logout") as ZitadelLogout;
  }

  it("renders the avatar trigger collapsed by default", async () => {
    setDisplayCookie("Alice Liddell", "alice@acme.com");
    const element = mount();
    await element.updateComplete;
    const trigger = shadowQuery<HTMLButtonElement>(element, ".trigger");
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent?.trim()).toBe("A");
    expect(element.shadowRoot?.querySelector(".dropdown")).toBeNull();
  });

  it("opens the dropdown and shows the signed-in identity on click", async () => {
    setDisplayCookie("Alice Liddell", "alice@acme.com");
    const element = mount();
    await element.updateComplete;
    const trigger = shadowQuery<HTMLButtonElement>(element, ".trigger");
    trigger.click();
    await element.updateComplete;
    const name = shadowQuery<HTMLElement>(element, ".preview-name");
    const email = shadowQuery<HTMLElement>(element, ".preview-email");
    expect(name.textContent?.trim()).toBe("Alice Liddell");
    expect(email.textContent?.trim()).toBe("alice@acme.com");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("falls back to a placeholder initial when no display cookie is set", async () => {
    const element = mount();
    await element.updateComplete;
    const trigger = shadowQuery<HTMLButtonElement>(element, ".trigger");
    expect(trigger.textContent?.trim()).toBe("?");
  });

  it("ignores a malformed display cookie without throwing", async () => {
    document.cookie = "__nextgen_display=not-base64; path=/";
    const element = mount();
    await element.updateComplete;
    const trigger = shadowQuery<HTMLButtonElement>(element, ".trigger");
    expect(trigger.textContent?.trim()).toBe("?");
  });

  it("substitutes template tokens and wires data-action='logout' triggers", async () => {
    setDisplayCookie("Bob Builder", "bob@example.com");
    const element = mount(`
      <zitadel-logout>
        <template>
          <button data-action="logout">Sign out {{name}} ({{email}}) [{{initial}}]</button>
        </template>
      </zitadel-logout>
    `);
    await element.updateComplete;
    const button = element.querySelector("button[data-action='logout']") as HTMLButtonElement;
    expect(button.textContent).toBe("Sign out Bob Builder (bob@example.com) [B]");
    expect(element.shadowRoot?.querySelector(".trigger")).toBeNull();
  });

  it("calls the typed end-session operation, fires zitadel-signout", async () => {
    setDisplayCookie("Alice Liddell", "alice@acme.com");
    const element = mount();
    await element.updateComplete;
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
    expect(requestLog[0]?.method).toBe("GET");
    expect(requestLog[0]?.url).toBe(`${API_BASE}/auth/end-session`);
    expect(requestLog[0]?.credentials).toBe("include");
    expect(signoutEvents).toHaveLength(1);
    expect(signoutEvents[0]?.detail).toEqual({
      name: "Alice Liddell",
      email: "alice@acme.com",
    });
  });

  it("forwards client-id and post-sign-out-url as end-session query params", async () => {
    setDisplayCookie("Alice", "alice@acme.com");
    const element = mount();
    element.clientId = "console-app";
    element.postSignOutUrl = "https://app.test/done";
    await element.updateComplete;
    shadowQuery<HTMLButtonElement>(element, ".trigger").click();
    await element.updateComplete;
    shadowQuery<HTMLButtonElement>(element, ".signout-btn").click();
    await new Promise((resolve) => setTimeout(resolve, 16));

    expect(requestLog).toHaveLength(1);
    const first = requestLog[0];
    if (!first) throw new Error("expected at least one captured request");
    const url = new URL(first.url);
    expect(url.searchParams.get("client_id")).toBe("console-app");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(
      "https://app.test/done",
    );
  });

  it("surfaces a network error in the dropdown without redirecting", async () => {
    setDisplayCookie("Alice", "alice@acme.com");
    server.use(http.get(`${API_BASE}/auth/end-session`, () => HttpResponse.error()));

    const element = mount();
    await element.updateComplete;
    shadowQuery<HTMLButtonElement>(element, ".trigger").click();
    await element.updateComplete;
    shadowQuery<HTMLButtonElement>(element, ".signout-btn").click();
    await new Promise((resolve) => setTimeout(resolve, 32));
    await element.updateComplete;

    const errorBar = shadowQuery<HTMLElement>(element, ".error-bar");
    expect(errorBar.textContent?.trim().length).toBeGreaterThan(0);
  });
});
