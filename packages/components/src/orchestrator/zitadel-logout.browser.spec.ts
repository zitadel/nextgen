import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-logout.js";
import type { ZitadelLogout } from "./zitadel-logout.js";

/**
 * Real-browser checks for `<zitadel-logout>`. Outside-click + Escape close
 * behaviour and focus restoration depend on a real platform; the unit spec
 * covers cookie parsing, template-slot mode, and aria attributes.
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
 * root or the queried element is missing. Avoids the
 * `(host.shadowRoot?.querySelector("X") as Y).click()` pattern that lints as
 * unsafe optional chaining.
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

async function waitFor<T>(probe: () => T | null | undefined, timeout = 1500): Promise<T> {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error("waitFor timed out");
}

describe("<zitadel-logout> open/close (chromium)", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    setDisplayCookie("Alice Liddell", "alice@acme.com");
  });

  afterEach(() => {
    host.remove();
    clearDisplayCookie();
  });

  async function mount(): Promise<ZitadelLogout> {
    host.innerHTML = `<zitadel-logout proxy-base="/__nextgen"></zitadel-logout>`;
    const element = host.querySelector("zitadel-logout") as ZitadelLogout;
    await waitFor(() => element.shadowRoot?.querySelector(".trigger"));
    return element;
  }

  it("closes when a click lands outside the element", async () => {
    const element = await mount();
    const trigger = shadowQuery<HTMLButtonElement>(element, ".trigger");
    trigger.click();
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector(".dropdown")).toBeTruthy();

    document.body.click();
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector(".dropdown")).toBeNull();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const element = await mount();
    const trigger = shadowQuery<HTMLButtonElement>(element, ".trigger");
    trigger.click();
    await element.updateComplete;

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector(".dropdown")).toBeNull();
    expect(element.shadowRoot?.activeElement).toBe(trigger);
  });

  it("calls the configured fetch and respects post-sign-out-url", async () => {
    const element = await mount();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    element.fetchImpl = fetchMock as unknown as typeof fetch;
    element.postSignOutUrl = "";

    shadowQuery<HTMLButtonElement>(element, ".trigger").click();
    await element.updateComplete;
    shadowQuery<HTMLButtonElement>(element, ".signout-btn").click();
    await waitFor(() => (fetchMock.mock.calls.length > 0 ? fetchMock : null));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/__nextgen/v1/logout");
  });
});
