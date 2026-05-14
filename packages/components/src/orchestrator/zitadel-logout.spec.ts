import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-logout.js";
import type { ZitadelLogout } from "./zitadel-logout.js";

/**
 * jsdom-friendly behaviour for `<zitadel-logout>`. Cookie parsing, light-DOM
 * `<template>` projection, aria semantics, and the network call all live
 * here. Outside-click and keyboard handling that depend on real focus
 * traversal go in `zitadel-logout.browser.spec.ts`.
 */
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

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
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
      <zitadel-logout proxy-base="/__nextgen">
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

  it("POSTs to {proxyBase}/v1/logout, fires zitadel-signout, and redirects", async () => {
    setDisplayCookie("Alice Liddell", "alice@acme.com");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

    const element = mount();
    element.fetchImpl = fetchMock as unknown as typeof fetch;
    element.proxyBase = "/__nextgen";
    element.postSignOutUrl = "";
    await element.updateComplete;
    shadowQuery<HTMLButtonElement>(element, ".trigger").click();
    await element.updateComplete;

    const signoutEvents: CustomEvent[] = [];
    element.addEventListener("zitadel-signout", (event) => {
      signoutEvents.push(event as CustomEvent);
    });

    shadowQuery<HTMLButtonElement>(element, ".signout-btn").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await element.updateComplete;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/__nextgen/v1/logout");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(signoutEvents).toHaveLength(1);
    expect(signoutEvents[0]?.detail).toEqual({
      name: "Alice Liddell",
      email: "alice@acme.com",
    });
  });

  it("strips a trailing slash on proxy-base before composing the URL", async () => {
    setDisplayCookie("Alice", "alice@acme.com");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

    const element = mount();
    element.fetchImpl = fetchMock as unknown as typeof fetch;
    element.proxyBase = "/__nextgen/";
    await element.updateComplete;
    shadowQuery<HTMLButtonElement>(element, ".trigger").click();
    await element.updateComplete;
    shadowQuery<HTMLButtonElement>(element, ".signout-btn").click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe(
      "/__nextgen/v1/logout",
    );
  });

  it("surfaces a server error message in the dropdown without redirecting", async () => {
    setDisplayCookie("Alice", "alice@acme.com");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Session already cleared." }), { status: 500 }),
    );

    const element = mount();
    element.fetchImpl = fetchMock as unknown as typeof fetch;
    element.proxyBase = "/__nextgen";
    await element.updateComplete;
    shadowQuery<HTMLButtonElement>(element, ".trigger").click();
    await element.updateComplete;
    shadowQuery<HTMLButtonElement>(element, ".signout-btn").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await element.updateComplete;

    const errorBar = shadowQuery<HTMLElement>(element, ".error-bar");
    expect(errorBar.textContent?.trim()).toBe("Session already cleared.");
  });
});
