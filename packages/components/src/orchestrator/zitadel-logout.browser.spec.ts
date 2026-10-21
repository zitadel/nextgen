import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { configureZitadel } from "@zitadel/api/config";

import "./zitadel-logout.js";
import type { ZitadelLogout } from "./zitadel-logout.js";

/**
 * Real-browser checks for `<zitadel-logout>`. Outside-click + Escape close
 * behaviour and focus restoration depend on a real platform; the unit spec
 * covers identity fetching, template-slot mode, and aria attributes.
 *
 * Network calls go through the typed `revokeMySession` operation in
 * `@zitadel/api` (`DELETE /sessions/me`). We swap `globalThis.fetch` for a
 * lightweight stub (rather than running `msw/browser`) because vitest's
 * browser provider does not register a service worker out of the box. The
 * one-shot `GET /sessions/me` identity fetch runs against the unreachable
 * `API_BASE` and fails silently, which is fine — these tests don't assert
 * identity.
 */
const API_BASE = "https://logout.test.invalid";

beforeAll(() => {
  configureZitadel({ proxyPath: API_BASE, projectId: "test" });
});

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
  let originalFetch: typeof fetch;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    host.remove();
    globalThis.fetch = originalFetch;
  });

  async function mount(): Promise<ZitadelLogout> {
    host.innerHTML = `<zitadel-logout></zitadel-logout>`;
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

  it("calls DELETE /sessions/me with credentials and the session's CSRF token", async () => {
    const element = await mount();
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("/sessions/me/csrf")
        ? Response.json({ csrf_token: "csrf_test" })
        : new Response(null, { status: 204 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    element.postSignOutUrl = "";

    shadowQuery<HTMLButtonElement>(element, ".trigger").click();
    await element.updateComplete;
    shadowQuery<HTMLButtonElement>(element, ".signout-btn").click();
    await waitFor(() => (fetchMock.mock.calls.length > 1 ? fetchMock : null));
    const [tokenUrl] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(tokenUrl).startsWith(`${API_BASE}/sessions/me/csrf`)).toBe(true);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(String(url).startsWith(`${API_BASE}/sessions/me`)).toBe(true);
    expect(init.method).toBe("DELETE");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("X-Zitadel-CSRF")).toBe("csrf_test");
  });
});

describe("<zitadel-logout> without a session (chromium)", () => {
  let host: HTMLDivElement;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      Response.json(
        { code: "auth.unauthorized", message: "Missing or invalid session token." },
        { status: 401 },
      ),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    host.remove();
    globalThis.fetch = originalFetch;
  });

  it("shows no avatar and no projected template", async () => {
    host.innerHTML = `
      <zitadel-logout></zitadel-logout>
      <zitadel-logout>
        <template><button data-action="logout">Sign out</button></template>
      </zitadel-logout>
    `;
    const [avatar, templated] = host.querySelectorAll("zitadel-logout");
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await (avatar as ZitadelLogout).updateComplete;

    expect(avatar?.shadowRoot?.querySelector(".trigger")).toBeNull();
    expect(templated?.querySelector("button[data-action='logout']")).toBeNull();
    expect(avatar?.getBoundingClientRect().width).toBe(0);
  });
});
